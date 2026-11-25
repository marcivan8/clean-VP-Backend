// scripts/test_market_interfaces.mjs — R100: VIBED Market has three interfaces
// (buyer, talent, admin), report-a-problem on both sides, and a Trust desk that
// moves money honestly.
//
// Executes the real opsMath, the real zustand store and the real market routes
// (Supabase + auth stubbed); static checks only for the migration and wiring.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);

const M = await imp('client/src/market/opsMath.js');

console.log('\n§1 the money and the clocks match the screens');
{
    const s = M.splitDispute({ buyerPaid: 995.40, talentPayout: 718.90, talentPct: 0.7 });
    ok(s.toTalent === 503.23 && s.refunded === 298.62, `70% split: €${s.toTalent} to Nour, €${s.refunded} refunded (screen 28)`);
    const zero = M.splitDispute({ buyerPaid: 995.40, talentPayout: 718.90, talentPct: 0 });
    ok(zero.toTalent === 0 && zero.refunded === 995.40, 'talent 0%: full refund, nothing paid out');
    const full = M.splitDispute({ buyerPaid: 995.40, talentPayout: 718.90, talentPct: 1 });
    ok(full.toTalent === 718.90 && full.refunded === 0, 'talent 100%: normal payout, no refund');
    const odd = M.splitDispute({ buyerPaid: 100, talentPayout: 80, talentPct: 7 });
    ok(odd.pct === 1, 'a share outside 0..1 is clamped');
    ok([0, 0.25, 0.7, 0.33].every((p) => { const x = M.splitDispute({ buyerPaid: 995.40, talentPayout: 718.90, talentPct: p }); return x.toTalent + x.refunded <= 995.40 + 0.001; }), 'a split never moves more than the buyer paid');

    const cases = [[69, 72, 'urgent'], [31, 72, 'warning'], [19, 24, 'warning'], [6, 24, 'neutral'], [2, 24, 'neutral'], [80, 72, 'breach']];
    ok(cases.every(([w, t, want]) => M.clockState(w, t) === want), 'clock colours: 69/72 red, 31/72 amber, 19 h amber, 6 h and 2 h grey (screen 27)');
    ok(M.isBreachingToday(69, 72) && !M.isBreachingToday(31, 72), '"breaching today" = under a day left on a long clock');
}

console.log('\n§2 rules are versioned rows, bookings keep their terms');
{
    const rule = { key: 'k', label: 'Cap', versions: [{ value: '€120', at: 1000, by: 'system' }] };
    const same = M.withRuleVersion(rule, '€120', { at: 2000, by: 'marc' });
    ok(same === rule, 'saving the same value adds no version');
    const next = M.withRuleVersion(rule, '€150', { at: 2000, by: 'marc' });
    ok(next !== rule && next.versions.length === 2 && rule.versions.length === 1, 'a change appends a version, the old row is untouched');
    ok(M.currentRuleValue(next) === '€150', 'new bookings get the new value');
    ok(M.ruleValueAt(next, 1500) === '€120' && M.ruleValueAt(next, 2500) === '€150', 'a booking made before the change keeps the old terms');
    ok(M.ruleValueAt(next, 10) === '€120', 'a booking older than every version gets the first one');
}

console.log('\n§3 payouts and deposits');
{
    ok(M.needsSecondApproval(2480, 2000) && !M.needsSecondApproval(2000, 2000), 'above €2,000 needs a second person; exactly €2,000 does not');
    ok(!M.canApprovePayout({ amount: 2480, state: 'needs_check', requestedBy: 'marc' }, 'marc', 2000).ok, 'the person who started a large payout cannot approve it');
    ok(M.canApprovePayout({ amount: 2480, state: 'needs_check', requestedBy: 'finance' }, 'marc', 2000).ok, 'a second person can');
    ok(!M.canApprovePayout({ amount: 10, state: 'held', requestedBy: 'x' }, 'marc', 2000).ok, 'a held payout cannot be approved');
    const c = M.capDamageClaim(500, 300);
    ok(c.amount === 300 && c.capped, 'a damage claim is capped at the deposit held (screen 29)');
    ok(M.capDamageClaim(180, 300).amount === 180 && !M.capDamageClaim(180, 300).capped, 'a claim under the hold is not capped');
    ok(M.REPORT_REASONS.find((r) => r.id === 'behaviour').freezes === false, 'a behaviour report does not freeze money');
}

console.log('\n§4 the store: every action changes something or says why not');
{
    const { default: store, initialMarketOpsState } = await imp('client/src/store/useMarketOpsStore.js');
    const S = () => store.getState();
    store.setState(initialMarketOpsState());

    const seed = S();
    ok(seed.idChecks.length === 7 && seed.certifications.length === 4 && seed.moderation.length === 3 && seed.disputes.length === 2, 'seed queue counts match the sidebar (7 / 4 / 3 / 2)');

    let r = S().decideDispute('bk_8821', 0.7, 'too short');
    ok(!r.ok && /reason/i.test(r.error), 'a decision without a real written reason is refused');
    const before = S().escrow;
    r = S().decideDispute('bk_8821', 0.7, 'The boom track is clean and was delivered, so the shoot is not unusable.');
    ok(r.ok && r.split.toTalent === 503.23, 'deciding with a reason moves the money');
    ok(S().escrow.frozen === Math.round((before.frozen - 995.40) * 100) / 100 && S().escrow.held < before.held, 'the frozen and held balances drop by the disputed amount');
    ok(S().ledger.length === 2 && S().ledger.some((e) => e.kind === 'refund' && e.amount === 298.62), 'two append-only ledger entries: release and refund');
    ok(/split bk_8821 70\/30/.test(S().audit[0].text) && S().audit[0].who === 'Marc', 'the audit log names who decided');
    ok(!S().decideDispute('bk_8821', 1, 'A second decision on the same booking would double-pay.').ok, 'a decided dispute cannot be decided twice');

    const frozenBefore = S().escrow.frozen;
    r = S().reportProblem({ side: 'buyer', reasonId: 'not_as_agreed', words: 'Audio clipped.' });
    ok(r.ok && S().escrow.frozen === Math.round((frozenBefore + 995.40) * 100) / 100, 'reporting freezes the booking amount');
    ok(!S().reportProblem({ side: 'buyer', reasonId: 'not_as_agreed' }).ok, 'a second open report on the same booking is refused');
    ok(S().withdrawReport(r.report.id).ok && S().escrow.frozen === frozenBefore, 'withdrawing unfreezes the money');
    const f2 = S().escrow.frozen;
    ok(S().reportProblem({ side: 'talent', reasonId: 'behaviour' }).ok && S().escrow.frozen === f2, 'a behaviour report goes to moderation without freezing');

    ok(!S().approvePayout('po_8830').ok, 'an already approved payout is not "approved" again');
    ok(S().approvePayout('po_rive').ok && S().payouts.find((p) => p.id === 'po_rive').state === 'approved', 'a second person approves the €2,480 payout');
    store.setState({ payouts: S().payouts.map((p) => (p.id === 'po_rive' ? { ...p, state: 'needs_check', requestedBy: 'marc' } : p)) });
    ok(!S().approvePayout('po_rive').ok, 'Marc cannot approve a large payout Marc started');

    ok(!S().updateRule('trust_decision', '72 h').ok, 'saving a rule unchanged is refused, not logged');
    ok(S().updateRule('trust_decision', '96 h').ok && S().rules.trust_decision.versions.length === 2, 'changing a rule adds a version');
    ok(/trust desk decision 72 h → 96 h/.test(S().audit[0].text), 'and the change is in the audit log, before → after');

    const ines = S().certifications.find((c) => c.id === 'cert_ines');
    ok(!S().grantCertification(ines.id).ok, 'a level cannot be granted while the markers disagree (4.8 vs 3.1)');
    ok(S().requestThirdMarker(ines.id).ok && !S().requestThirdMarker(ines.id).ok, 'a third marker is asked for once');
    ok(!S().grantCertification('cert_theo').ok, 'no level without valid insurance');
    ok(S().grantCertification('cert_nour').ok && !S().certifications.some((c) => c.id === 'cert_nour'), 'agreeing marks + valid insurance: granted, leaves the queue');

    r = S().resolveIdCheck('idc_4471', 'approve');
    ok(r.ok && JSON.stringify(Object.keys(r.record)) === JSON.stringify(['result', 'level', 'date']), 'an approved ID check stores {result, level, date} and nothing else');
    ok(!S().idChecks.some((c) => c.id === 'idc_4471'), 'and leaves the queue');

    r = S().claimDeposit(500);
    ok(r.ok && r.amount === 300 && S().reportable.host.claimed === 300, 'a host claim of €500 is claimed as the €300 held');
    ok(!S().releaseDeposit().ok, 'a deposit already claimed cannot also be released');

    ok(!S().publishListing().ok, 'a listing cannot go live without payouts and a lead item');
    S().setListingFlag('payoutsConnected'); S().setListingFlag('leadItem');
    ok(S().publishListing().ok && S().listing.published, 'with both, it publishes');

    ok(S().respondToRequest('accept').ok && !S().respondToRequest('decline').ok, 'a job request is answered once');
    const shot = S().onSet.shots.find((x) => !x.done);
    ok(S().toggleShot(shot.id).ok && S().onSet.shots.find((x) => x.id === shot.id).done, 'ticking a shot works');
    ok(S().applyToBrief('br_cream').ok && !S().applyToBrief('br_cream').ok, 'applying to a brief happens once');
}

console.log('\n§5 server: one role per account, admin is a server decision');
{
    const Module = require('module');
    const profiles = { u_new: { id: 'u_new', market_role: null, is_admin: false }, u_buyer: { id: 'u_buyer', market_role: 'buyer', is_admin: false }, u_admin: { id: 'u_admin', market_role: null, is_admin: true } };
    const calls = [];
    const supabaseAdmin = {
        from: () => {
            const q = { filters: {}, isNull: null };
            const b = {
                update(v) { q.update = v; return b; },
                select() { return b; },
                eq(k, v) { q.filters[k] = v; return b; },
                is(k, v) { q.isNull = [k, v]; return b; },
                maybeSingle() { return Promise.resolve({ data: profiles[q.filters.id] || null, error: null }); },
                then(res) {
                    calls.push(q);
                    const p = profiles[q.filters.id];
                    if (q.update && p && (!q.isNull || p[q.isNull[0]] === null)) { Object.assign(p, q.update); return Promise.resolve({ data: [{ market_role: p.market_role }], error: null }).then(res); }
                    return Promise.resolve({ data: [], error: null }).then(res);
                },
            };
            return b;
        },
    };
    const stubs = {
        [path.join(root, 'config/database.js')]: { supabaseAdmin },
        [path.join(root, 'middleware/auth.js')]: {
            authenticateUser: (req, res, next) => {
                const id = (req.headers.authorization || '').replace('Bearer ', '');
                if (!profiles[id]) return res.status(401).json({ error: 'no' });
                req.user = { id, profile: { ...profiles[id] } };
                next();
            },
            optionalAuth: (req, res, next) => next(),
        },
    };
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        let resolved; try { resolved = Module._resolveFilename(request, parent, isMain); } catch { return origLoad.apply(this, arguments); }
        return stubs[resolved] || origLoad.apply(this, arguments);
    };
    const express = require('express');
    delete require.cache[path.join(root, 'routes/marketRoutes.js')];
    const app = express(); app.use(express.json()); app.use('/api/market', require(path.join(root, 'routes/marketRoutes.js')));
    Module._load = origLoad;
    const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, user, body) => {
        const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${user}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, json: await res.json().catch(() => null) };
    };

    let r = await call('GET', '/api/market/me', 'u_new');
    ok(r.status === 200 && r.json.role === null && r.json.isAdmin === false, 'a new account has no role yet (→ chooses once)');
    ok((await call('GET', '/api/market/me')).status === 401, 'signed out is refused');
    ok((await call('POST', '/api/market/role', 'u_new', { role: 'admin' })).status === 400, 'only buyer or talent can be chosen (never admin)');
    r = await call('POST', '/api/market/role', 'u_new', { role: 'talent' });
    ok(r.status === 200 && profiles.u_new.market_role === 'talent', 'choosing talent saves it');
    ok(calls.some((q) => q.update && q.isNull && q.isNull[0] === 'market_role' && q.isNull[1] === null), 'the write only matches a row with no role yet (race-safe)');
    r = await call('POST', '/api/market/role', 'u_buyer', { role: 'talent' });
    ok(r.status === 409 && r.json.role === 'buyer' && profiles.u_buyer.market_role === 'buyer', 'a buyer account cannot become talent (separate accounts)');
    ok((await call('POST', '/api/market/role', 'u_buyer', { role: 'buyer' })).status === 200, 'choosing the same role again is harmless');
    ok((await call('GET', '/api/market/admin/check', 'u_buyer')).status === 404, 'the Trust desk answers "not found" to a non-admin');
    ok((await call('GET', '/api/market/admin/check', 'u_admin')).status === 200, 'and opens for is_admin');
    ok((await call('GET', '/api/market/me', 'u_admin')).json.isAdmin === true, '/me tells the client it is an admin');
    server.close();
}

console.log('\n§6 migration and wiring');
{
    const sql = read('supabase/migrations/20240012_market_roles.sql');
    ok(/add column if not exists is_admin\s+boolean not null default false/.test(sql) && /market_role text/.test(sql), 'migration adds is_admin and market_role');
    ok(/market_role in \('buyer', 'talent'\)/.test(sql), 'market_role is limited to buyer/talent');
    ok(/security invoker/.test(sql) && !/security definer/.test(sql.replace(/--.*$/gm, '')), 'the guard runs as the caller (SECURITY DEFINER would let everything through)');
    ok(/current_user not in \('authenticated', 'anon'\)/.test(sql), 'browser roles are the ones restricted; server and SQL editor are not');
    ok(['is_admin', 'market_role', 'plan', 'plan_expires_at', 'stripe_customer_id', 'subscription_status', 'email_opt_out'].every((c) => new RegExp(`new\\.${c}\\s+is distinct from old\\.${c}`).test(sql)), 'the browser cannot change is_admin, market_role, plan, billing ids or email opt-out');
    ok(!/new\.usage_data/.test(sql), 'usage_data (the one field the client writes) stays writable');
    ok(/before update on public\.profiles/.test(sql), 'trigger fires before every update');

    const app = read('client/src/App.jsx');
    ok(/'\/marketplace': <MarketGate \/>/.test(app) && /'\/admin\/trust': <MarketAdminGate \/>/.test(app), '/marketplace goes through the role gate, /admin/trust through the admin gate');
    const gate = read('client/src/market/MarketGate.jsx');
    ok(/me\.role === 'talent' \? <TalentApp/.test(gate) && /<MarketplacePage \/>/.test(gate) && /!me\.role\) return <ChooseRole/.test(gate), 'talent → TalentApp, buyer → existing market, no role → choose');
    ok(/state !== 'admin'/.test(gate) && /Page not found/.test(gate), 'a non-admin sees the same page as a missing one');
    const buyer = read('client/src/pages/MarketplacePage.jsx');
    ok(/activeTab === 'report' && \(/.test(buyer) && /<ReportProblem side="buyer"/.test(buyer), 'buyer market has Report a problem');
    ok(!/date: requestedDate/.test(buyer), 'quick-book no longer references the undefined requestedDate');
    ok(/<ReportProblem side="talent"/.test(read('client/src/market/talent/TalentApp.jsx')), 'talent interface has Report a problem');
    ok(/if \(process\.env\.MARKET_ENABLED === 'true'\) \{\s*app\.use\('\/api\/market', require\('\.\/routes\/marketRoutes'\)\);/.test(read('index.js')), 'market routes are mounted only when MARKET_ENABLED is on');
    ok(/useShallow\(\(s\) => \(\{/.test(read('client/src/market/admin/TrustDesk.jsx')), 'the Trust desk count selector is shallow-compared (no render loop)');
}

console.log('\n§7 R101: the review rule values, talent onboarding, location release');
{
    const { default: store, initialMarketOpsState, onboardingProgress } = await imp('client/src/store/useMarketOpsStore.js');
    store.setState(initialMarketOpsState());
    const S = () => store.getState();
    const val = (k) => M.currentRuleValue(S().rules[k]);
    ok(val('counter_rounds') === '2' && val('answer_counter') === '12 h' && val('request_expires') === '24 h', 'counters: 2 rounds a side, 12 h to answer, request dies at 24 h');
    ok(val('verify_buyer') === 'email + valid card' && val('verify_talent') === 'ID via provider', 'buyers: email + card, no ID check; ID is supply-side only');
    ok(val('publish_ratings') === '14 days', 'ratings publish after 14 days');
    ok(val('talent_cancel_over7') === 'reliability hit only' && val('talent_cancel_7d') === '20% of payout, max €150' && val('talent_cancel_48h') === '50% + level drop' && val('talent_third_cancel') === 'suspension', 'talent cancellation ladder: >7 d, <7 d, <48 h, third in 12 months');
    ok(/talent paid 50%/.test(val('no_show_buyer')) && /full refund/.test(val('no_show_talent')) && val('checkin_grace') === '30 min', 'no-show split in two, decided by check-in + 30 min grace');
    ok(val('shoot_proof') === 'talent GPS check-in' && /optional/.test(val('host_confirmation')), "the talent's check-in is the proof; host confirmation is optional");
    ok(/€300/.test(val('damage_cap')) && /24 h of wrap/.test(val('damage_photos')) && /never the host/.test(val('damage_decided_by')), 'damage: capped at the hold, photos within 24 h, Trust desk decides');
    ok(val('ret_id_docs') === 'never stored', 'ID documents are never stored');
    const seed = await imp('client/src/market/marketOpsSeed.js');
    const ruleKeys = new Set(Object.keys(S().rules));
    ok(seed.TALENT_AGREEMENT_RULES.every(([, keys]) => keys.every((k) => ruleKeys.has(k))), 'every rule the onboarding page shows exists in the rules table (no retyped copy)');
    ok(!Object.keys(S().rules).some((k) => /payment_deadline|pay_within/.test(k)), 'no payment deadline after acceptance (authorise at request, capture at acceptance)');

    let p = onboardingProgress(S().onboarding);
    ok(p.done === 0 && !p.complete, 'a new talent starts with nothing done');
    let r = S().runIdCheck();
    ok(r.ok && JSON.stringify(Object.keys(r.record)) === JSON.stringify(['result', 'level', 'date']), 'the ID check keeps {result, level, date} only');
    ok(!S().runIdCheck().ok, 'and is not run twice');
    ok(S().connectOnboardingPayouts().ok && S().listing.payoutsConnected, 'connecting payouts also unblocks the listing');
    ok(!S().signRelease('location').ok, 'a location release cannot be signed before saying you host a place');
    ok(S().signRelease('appearance').ok, 'appearance release signed');
    ok(!onboardingProgress(S().onboarding).steps.releases, 'releases are not done until the hosting question is answered');
    ok(S().setHostsLocations(true).ok && !onboardingProgress(S().onboarding).steps.releases, 'a host still needs the location release');
    ok(S().signRelease('location').ok && onboardingProgress(S().onboarding).steps.releases, 'location release signed → releases done');
    ok(S().setHostsLocations(false).ok && S().onboarding.locationRelease === null && onboardingProgress(S().onboarding).steps.releases, 'not hosting needs no location release (and drops one signed by mistake)');
    ok(S().acceptTalentRules().ok && typeof S().onboarding.rulesAcceptedAt === 'number' && !S().acceptTalentRules().ok, 'accepting the rules records when, once');
    ok(onboardingProgress(S().onboarding).complete, 'all four steps done → ready for the listing');

    const { safeNextPath } = await imp('client/src/utils/safeNextPath.js');
    ok(safeNextPath('/talent/setup') === '/talent/setup', '?next= keeps a path on this site');
    ok(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/javascript:alert(1)', '/a\nb', '', null, 42].every((x) => safeNextPath(x) === '/dashboard'), '?next= refuses other sites, schemes and control characters (no open redirect)');

    const app = read('client/src/App.jsx');
    ok(/'\/talent': <BecomeTalentPage \/>/.test(app) && /'\/talent\/setup': <TalentSetup \/>/.test(app), '/talent and /talent/setup are routed (when the market is on)');
    const home = read('client/src/pages/HomePage.jsx');
    ok((home.match(/MARKET_ENABLED && <button[^\n]*navigate\('\/talent'\)/g) || []).length === 2, '"Become talent" is in the landing nav on desktop and mobile, only when the market is on');
    const homeNav = home.slice(home.indexOf('nav-only-desktop" style={{ gap: 8'));
    ok(homeNav.indexOf("navigate('/talent')") < homeNav.indexOf('{user ? ('), 'the desktop button is outside the signed-in/out switch (always shown)');
    ok(!('becomeTalent' in JSON.parse(read('client/src/locales/en/common.json')).nav) && !('becomeTalent' in JSON.parse(read('client/src/locales/fr/common.json')).nav), 'no market copy left in the locale files while hidden (R102)');
    const auth = read('client/src/pages/AuthPage.jsx');
    ok(/safeNextPath\(/.test(auth) && (auth.match(/navigate\(afterAuth\)/g) || []).length === 2, 'sign-in and sign-up both return to ?next= through the safe check');
    const setup = read('client/src/market/talent/TalentSetup.jsx');
    ok(/me\.role === 'buyer'/.test(setup) && /chooseMarketRole\('talent'\)/.test(setup) && /auth\?next=\$\{encodeURIComponent\(NEXT\)\}/.test(setup), 'setup handles signed out, buyer accounts and new accounts');
    ok(!/useMarketOpsStore\(/.test(setup) && /onboardingStep\(/.test(setup), 'setup reads and saves through the API (R102), not a store selector');
    ok(/talent_cancel_over7/.test(read('client/src/market/marketOpsSeed.js')) && /group="verification"/.test(read('client/src/market/admin/TrustDesk.jsx')) && /group="damage"/.test(read('client/src/market/admin/TrustDesk.jsx')), 'the Trust desk shows and edits the new verification and damage rules');
}

console.log('\n§8 R102: the market is hidden until it runs on real data');
{
    const flag = read('client/src/lib/marketFlag.js');
    ok(/MARKET_ENABLED = import\.meta\.env\.VITE_MARKET_ENABLED === 'true'/.test(flag), 'one switch, off unless explicitly "true"');
    const app = read('client/src/App.jsx');
    ok(/MARKET_ENABLED \? \{/.test(app) && /: <Navigate to="\/" replace \/>/.test(app) && /\['\/marketplace', '\/admin\/trust', '\/talent', '\/talent\/setup'\]/.test(app), 'with the switch off, all four market paths redirect home');
    const dash = read('client/src/pages/DashboardPage.jsx');
    ok(!/navigate\('\/marketplace'\)/.test(dash.replace(/MARKET_ENABLED && <button[\s\S]*?<\/button>\}/g, '').replace(/MARKET_ENABLED \? \(\) => navigate\('\/marketplace'\)/g, '')), 'every dashboard link to the market sits behind the switch');
    ok(/\{onMarketplace && <SheetRow/.test(read('client/src/components/MobileHome.jsx')), 'the mobile account sheet hides the row without a handler');
    ok(!('marketplace' in JSON.parse(read('client/src/locales/en/dashboard.json'))) && !('marketplace' in JSON.parse(read('client/src/locales/fr/dashboard.json'))), 'no "Marketplace" copy in the dashboard locales');
    for (const f of ['client/src/locales/en/landing.json', 'client/src/locales/fr/landing.json', 'client/src/locales/en/common.json', 'client/src/locales/fr/common.json']) {
        if (fs.existsSync(path.join(root, f))) ok(!/marketplace|vibed market|become talent|devenir talent/i.test(read(f)), `no market copy in ${f}`);
    }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
