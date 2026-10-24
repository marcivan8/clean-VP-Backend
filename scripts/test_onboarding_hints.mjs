// scripts/test_onboarding_hints.mjs
//
// R105 — the walkthrough rewrite and the first-run hint system.
//
// The behaviour these pin is mostly about RESTRAINT. An onboarding surface
// that fires twice, fires during a tour, fires while its own state is still
// loading, or fires at a control that is not on screen does more damage than
// one that never fires at all: it trains the user to dismiss things.
//
// Context for the rewrite: roughly three quarters of new users create a
// project and about one in fourteen ever signs in again. The old four-step
// tour pointed at the media panel, chat, timeline and export button — it
// taught where the furniture was, never what the product does that another
// editor does not. The steps now walk the path to a finished video.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const log = console.log;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
const PROGRESS = await import('../client/src/services/onboardingProgress.js');
console.log = log;

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

log('\n── 1. Progress: per user, and never teaches twice ──');

await check('nothing is offered until progress has loaded', () => {
    // `hasSeen` answers TRUE while unresolved, so every caller stays quiet.
    // The opposite default would flash a tour at a returning user for the
    // few hundred ms before their record arrives — the one person who must
    // never see it again.
    assert.equal(PROGRESS.isProgressReady(), false, 'progress reported ready before loading');
    assert.equal(PROGRESS.hasSeen('tour_v2'), true, 'an unloaded store offered a lesson');
});

await check('it loads, degrades to local storage, and never throws', async () => {
    // No Supabase session in this harness: the catch path is the one under
    // test, and it must resolve rather than reject.
    const state = await PROGRESS.loadOnboardingProgress();
    assert.ok(state && typeof state === 'object');
    assert.equal(state.userId, null, 'a logged-out load claimed a user id');
    assert.equal(PROGRESS.isProgressReady(), true);
    assert.equal(PROGRESS.hasSeen('tour_v2'), false, 'a fresh user was treated as taught');
});

await check('marking is synchronous, so the next render already knows', () => {
    // The network round trip is debounced by 400ms. If `hasSeen` only became
    // true after the flush, a hint dismissed at t=0 could reappear at t=200.
    PROGRESS.markSeen('hint_probe');
    assert.equal(PROGRESS.hasSeen('hint_probe'), true, 'the cache lagged behind the write');
});

await check('a second mark of the same key is a no-op', () => {
    const before = PROGRESS.hasSeen('hint_probe');
    PROGRESS.markSeen('hint_probe');
    assert.equal(PROGRESS.hasSeen('hint_probe'), before);
});

await check('junk keys are ignored rather than stored', () => {
    for (const junk of [null, undefined, '', 0, {}, []]) PROGRESS.markSeen(junk);
    assert.equal(PROGRESS.hasSeen(''), false);
});

await check('the old browser-local tour key counts as taught', () => {
    // Someone who completed the four-step tour in this browser is not a new
    // user. Re-running a rewritten walkthrough at them is exactly the
    // interruption this whole module exists to avoid.
    const src = read('client/src/services/onboardingProgress.js');
    assert.match(src, /vp_onboarding_tour_seen/, 'the legacy key is no longer honoured');
    assert.match(src, /tour_v1/, 'the legacy tour is not mapped to a version key');
});

await check('a write merges usage_data instead of replacing it', () => {
    // `usage_data` is shared with usage counters. A blind update would wipe
    // them, and nothing would report the loss.
    const src = read('client/src/services/onboardingProgress.js');
    assert.match(src, /\.\.\.current,/, 'the write does not spread the existing usage_data');
    assert.match(src, /onboarding: \{ \.\.\.\(current\.onboarding \|\| \{\}\), \.\.\.batch \}/, 'the onboarding key is not merged');
});

log('\n── 2. The walkthrough teaches the path, not the furniture ──');

await check('the steps are the route to a finished video', () => {
    const src = read('client/src/components/OnboardingTour.jsx');
    const steps = [...src.matchAll(/key: '([a-z]+)'/g)].map(m => m[1]);
    assert.deepEqual(steps, ['import', 'say', 'auto', 'shorts', 'export'],
        `steps are ${JSON.stringify(steps)}`);
    // The old tour's panel-naming keys must not survive.
    for (const dead of ["key: 'media'", "key: 'assistant'", "key: 'timeline'"]) {
        assert.ok(!src.includes(dead), `${dead} is still a step`);
    }
});

await check('the key is versioned, and v1 completers are left alone', () => {
    const src = read('client/src/components/OnboardingTour.jsx');
    assert.match(src, /TOUR_KEY = 'tour_v2'/, 'the tour key is not versioned');
    assert.match(src, /hasSeen\(TOUR_KEY\) && !hasSeen\('tour_v1'\)/, 'v1 completers would be re-taught');
});

await check('a step behind a paywall says so instead of pretending', () => {
    // Auto, editing styles and Shorts are Creator and Pro only. Showing them
    // to a free user is deliberate; showing them as if they were available
    // is not.
    const src = read('client/src/components/OnboardingTour.jsx');
    assert.match(src, /plan: 'creator'/, 'no step is marked as gated');
    assert.match(src, /needsUpgrade/, 'the gate is never evaluated against the user plan');
    assert.match(src, /creatorBadge/, 'a gated step carries no visible badge');
});

await check('every step and hint string exists in both locales', () => {
    const en = JSON.parse(read('client/src/locales/en/editor.json'));
    const fr = JSON.parse(read('client/src/locales/fr/editor.json'));
    const tourSrc = read('client/src/components/OnboardingTour.jsx');
    const hintSrc = read('client/src/components/FirstRunHint.jsx');

    const stepKeys = [...tourSrc.matchAll(/key: '([a-z]+)'/g)].map(m => m[1]);
    const hintKeys = [...hintSrc.matchAll(/^\s{4}([a-z_]+):\s*\{ anchor/gm)].map(m => m[1]);
    assert.ok(hintKeys.length >= 5, `only found ${hintKeys.length} hints to check`);

    for (const [loc, j] of [['en', en], ['fr', fr]]) {
        for (const k of stepKeys) {
            assert.ok(j.onboardingTour?.[k]?.title, `${loc}: onboardingTour.${k}.title missing`);
            assert.ok(j.onboardingTour?.[k]?.body, `${loc}: onboardingTour.${k}.body missing`);
        }
        for (const k of hintKeys) {
            assert.ok(j.hints?.[k]?.title, `${loc}: hints.${k}.title missing`);
            assert.ok(j.hints?.[k]?.body, `${loc}: hints.${k}.body missing`);
        }
        assert.ok(j.onboardingTour?.creatorBadge, `${loc}: creatorBadge missing`);
        assert.ok(j.hints?.dismiss, `${loc}: hints.dismiss missing`);
    }
});

await check('every gated surface has locked copy, in both locales', () => {
    const en = JSON.parse(read('client/src/locales/en/editor.json'));
    const fr = JSON.parse(read('client/src/locales/fr/editor.json'));
    for (const [loc, j] of [['en', en], ['fr', fr]]) {
        for (const k of ['auto', 'shorts']) {
            assert.ok(j.onboardingTour?.[k]?.locked, `${loc}: onboardingTour.${k}.locked missing`);
        }
        for (const k of ['auto_available', 'shorts_ready']) {
            assert.ok(j.hints?.[k]?.locked, `${loc}: hints.${k}.locked missing`);
        }
    }
});

log('\n── 3. Hints: quiet, anchored, and spent on show ──');

await check('every hint points at an anchor that exists in the markup', () => {
    // A hint whose target is never rendered dismisses itself silently, which
    // looks exactly like a hint that works. This is the check that catches a
    // renamed control before a user does.
    const hintSrc = read('client/src/components/FirstRunHint.jsx');
    const anchors = [...hintSrc.matchAll(/anchor: '([a-z-]+)'/g)].map(m => m[1]);
    assert.ok(anchors.length >= 5, `only ${anchors.length} anchors declared`);

    const markup = [
        'client/src/layouts/IDELayout.jsx',
        'client/src/components/Assistant/ReasoningPanel.jsx',
        'client/src/components/Assistant/EditingStylePicker.jsx',
        // R108 — the desktop panel switcher moved here, and took the tab
        // anchors with it.
        'client/src/components/PanelRail.jsx',
    ].map(read).join('\n');

    const missing = anchors.filter(a => {
        if (markup.includes(`data-hint="${a}"`)) return false;
        // Tab anchors are generated, in both switchers: the mobile strip
        // writes data-hint={`tab-${tab}`}, the desktop rail data-hint={`tab-${id}`}.
        if (/^tab-/.test(a) && /data-hint=\{`tab-\$\{(tab|id)\}`\}/.test(markup)) return false;
        return true;
    });
    assert.deepEqual(missing, [], `hints point at anchors nothing renders: ${missing.join(', ')}`);
});

await check('a hint is recorded when SHOWN, not when dismissed', () => {
    // Closing the tab, navigating away, or ignoring it all have to count.
    // Recording on dismiss would replay the hint on the next session for
    // everyone who did not click the X.
    const src = read('client/src/components/FirstRunHint.jsx');
    const at = src.indexOf('const onHint');
    const block = src.slice(at, at + 900);
    assert.match(block, /markSeen\(key\);[\s\S]{0,120}setActive/, 'the hint is not spent before it renders');
});

await check('two hints never share the screen', () => {
    const src = read('client/src/components/FirstRunHint.jsx');
    assert.match(src, /if \(active\) \{[\s\S]{0,200}queue\.current\.push\(key\)/, 'a second hint replaces the first instead of queueing');
});

await check('there is a per-session teaching budget', () => {
    const src = read('client/src/components/FirstRunHint.jsx');
    assert.match(src, /MAX_PER_SESSION = \d/, 'nothing caps how many hints one session can show');
    assert.match(src, /shownCount\.current >= MAX_PER_SESSION/, 'the cap is declared but never enforced');
});

await check('a hint blocks nothing underneath it', () => {
    // The tour earns an overlay because the user has just arrived. A hint
    // interrupts someone mid-edit, so it must not take the screen, dim it,
    // or swallow a click on the control it is pointing at.
    const src = read('client/src/components/FirstRunHint.jsx');
    assert.ok(!/boxShadow:\s*'0 0 0 9999px/.test(src), 'the hint draws a full-screen scrim');
    assert.ok(!/inset: 0[^}]*zIndex: 3/.test(src), 'the hint covers the viewport');
    assert.match(src, /role="status"/, 'the hint is not announced politely to assistive tech');
    assert.match(src, /aria-live="polite"/, 'the hint would interrupt a screen reader');
});

await check('it retires itself, and acting on it dismisses it early', () => {
    const src = read('client/src/components/FirstRunHint.jsx');
    assert.match(src, /DISMISS_MS = \d+/, 'a hint can stay on screen forever');
    assert.match(src, /setTimeout\(dismiss, SETTLE_MS \+ DISMISS_MS\)/, 'the auto-dismiss is not armed');
    assert.match(src, /addEventListener\('click', onUse, \{ once: true \}\)/, 'using the control does not dismiss the hint');
});

await check('motion is dropped for users who asked for less of it', () => {
    const src = read('client/src/components/FirstRunHint.jsx');
    assert.match(src, /prefers-reduced-motion/, 'the entrance animation ignores the OS setting');
});

log('\n── 4. Reachable from where the state actually changes ──');

await check('the hints are mounted, and never during the tour', () => {
    const ide = read('client/src/layouts/IDELayout.jsx');
    assert.match(ide, /<FirstRunHint plan=\{userPlan\} \/>/, 'FirstRunHint is not mounted');
    assert.match(ide, /\{!showTour && <FirstRunHint/, 'a hint could fire on top of the walkthrough');
    assert.match(ide, /<OnboardingTour onDone=\{[^}]+\} plan=\{userPlan\} \/>/, 'the tour never learns the plan');
});

await check('the tour waits for progress before deciding anything', () => {
    const ide = read('client/src/layouts/IDELayout.jsx');
    assert.match(ide, /loadOnboardingProgress\(\)/, 'progress is never loaded');
    assert.match(ide, /if \(!progressReady \|\| isMobile \|\| !shouldShowOnboardingTour\(\)\)/, 'the tour can run before progress resolves');
});

await check('triggers sit where the state changes, not in one component', () => {
    // The same lesson has to fire whether the edit came from chat, a slash
    // command or the Auto playbook — so the trigger lives at the workflow,
    // not on a button.
    const wf = read('client/src/agent/WorkflowController.js');
    assert.match(wf, /triggerHint\('first_ai_edit'\)/, 'a completed AI edit teaches nothing');
    assert.match(wf, /triggerHint\('auto_available'\)/, 'Auto is never offered after a manual edit');

    const ide = read('client/src/layouts/IDELayout.jsx');
    assert.match(ide, /triggerHint\('first_upload'\)/, 'the first import teaches nothing');
    assert.match(ide, /triggerHint\('shorts_ready'\)/, 'a long take never surfaces repurposing');
    assert.match(ide, /triggerHint\('before_export'\)/, 'export is never preceded by the Pro Finish nudge');
});

await check('triggerHint is cheap and safe to call from a hot path', () => {
    const src = read('client/src/components/FirstRunHint.jsx');
    const at = src.indexOf('export function triggerHint');
    const body = src.slice(at, at + 420);
    assert.match(body, /if \(!HINTS\[key\]\) return;/, 'an unknown key is not rejected');
    assert.match(body, /!isProgressReady\(\) \|\| hasSeen\(key\)/, 'it can fire before progress resolves');
});

log(failures === 0 ? '\n✅ onboarding + hints: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
