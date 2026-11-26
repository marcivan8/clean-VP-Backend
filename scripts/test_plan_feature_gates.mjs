// scripts/test_plan_feature_gates.mjs — R104: Design Studio and social
// publishing are Pro features, refused by the SERVER (requirePlan) and locked in
// the browser. Runs the real gate against a stubbed profiles table.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';
delete process.env.BYPASS_USAGE_GATE;

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

// Stub the profiles lookup: the user id IS the plan, '' = no row, 'boom' = error.
const plans = { u_free: 'free', u_creator: 'creator', u_pro: 'pro', u_weird: 'enterprise' };
const dbPath = require.resolve('../config/database.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
    from: () => ({ select: () => ({ eq: (_c, id) => ({ single: async () => {
        if (id === 'u_boom') throw new Error('db down');
        return plans[id] ? { data: { plan: plans[id] }, error: null } : { data: null, error: { message: 'no row' } };
    } }) }) }),
} } };
const { requirePlan } = require('../middleware/usageGate.js');

async function run(gate, user) {
    let status = 200, body = null, nexted = false;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    await gate({ user }, res, () => { nexted = true; });
    return { status, body, nexted };
}

console.log('\n§1 the server gate');
const pro = requirePlan('pro', { code: 'DESIGN_STUDIO_PRO', feature: 'Design Studio' });
const creator = requirePlan('creator', { feature: 'X' });
for (const [u, want] of [['u_free', false], ['u_creator', false], ['u_pro', true], ['u_weird', false], ['u_missing', false], ['u_boom', false]]) {
    const r = await run(pro, { id: u });
    ok(r.nexted === want && (want || (r.status === 402 && r.body.upgradeRequired === 'pro' && r.body.error === 'DESIGN_STUDIO_PRO')),
        `pro gate: ${u} ${want ? 'passes' : 'gets 402 upgradeRequired=pro'}`);
}
ok((await run(pro, undefined)).status === 401, 'no user is 401, not a pass');
ok((await run(creator, { id: 'u_creator' })).nexted && !(await run(creator, { id: 'u_free' })).nexted, 'a creator gate admits Creator and refuses Free');
ok(/Pro plan/.test((await run(pro, { id: 'u_free' })).body.message), 'the refusal says which plan unlocks it');
let threw = false; try { requirePlan('gold'); } catch { threw = true; }
ok(threw, 'an unknown plan name is a programming error, not a silent pass');

console.log('\n§2 the routes carry it, before aiGate');
const ai = code('../routes/aiRoutes.js');
ok(/router\.post\('\/design-copilot',\s*authenticateUser,\s*designStudioGate,\s*aiGate,/.test(ai), 'design-copilot: auth → Pro gate → aiGate (a refusal uses no AI operation)');
ok(/designStudioGate = requirePlan\('pro'/.test(ai), 'Design Studio requires Pro');
const social = code('../routes/socialRoutes.js');
ok(/socialGate = requirePlan\('pro'/.test(social), 'social publishing requires Pro');
for (const r of [
    "post('/copy/generate', authenticateUser, socialGate, aiGate",
    "get('/analytics', authenticateUser, socialGate",
    "post('/analytics/recommendations/generate', authenticateUser, socialGate, aiGate",
    "patch('/analytics/recommendations/:id', authenticateUser, socialGate",
    "post('/publications', authenticateUser, socialGate",
    "post('/:provider/connect', authenticateUser, socialGate",
]) ok(social.includes(`router.${r}`), `gated: ${r.split(',')[0]}`);
for (const r of ["get('/publications', authenticateUser, async", "delete('/publications/:id', authenticateUser, async", "get('/accounts', authenticateUser, async", "delete('/:provider', authenticateUser, async"]) {
    ok(social.includes(`router.${r}`), `left open so a former Pro user can see and clean up: ${r.split(',')[0]}`);
}

console.log('\n§3 the browser shows the lock');
const ds = code('../client/src/pages/DesignStudioPage.jsx');
ok(/if \(plan !== 'pro'\) return <ProFeatureLock feature="designStudio"/.test(ds) && /return <DesignProjectGate \/>/.test(ds), 'Design Studio renders the lock for every plan but Pro');
const shorts = code('../client/src/components/ShortsPanel.jsx');
ok(/canPublish = plan === 'pro'/.test(shorts) && /\{canPublish && <SocialPublisher/.test(shorts) && /canPublish \? <SocialPerformancePanel/.test(shorts), 'Shorts panel hides publishing and analytics below Pro');
const share = code('../client/src/components/ShareDestinations.jsx');
ok(/canConnect = plan === 'pro'/.test(share) && /clickable = d\.configured && \(connected \|\| canConnect\)/.test(share), 'Publish-to rows cannot start a connection below Pro, but can still disconnect');

console.log('\n§4 the landing and the plan cards say the same thing');
for (const l of ['en', 'fr']) {
    const land = JSON.parse(read(`../client/src/locales/${l}/landing.json`));
    const p = land.pricing.plans;
    ok(!p.creator.features.some((f) => /Design Studio|Reels|TikTok|publi/i.test(f)), `${l}: Creator no longer lists Design Studio or publishing`);
    ok(p.pro.features.some((f) => /Design Studio/.test(f)) && p.pro.features.some((f) => /TikTok/.test(f)), `${l}: Pro lists Design Studio and publishing`);
    ok(p.free.locked.some((f) => /Design Studio/.test(f)), `${l}: the free card shows Design Studio as locked`);
    const d = land.v2.design;
    ok(d && d.title && d.lead && Array.isArray(d.layers) && ['a', 'b', 'c'].every((k) => d.cards[k].title && d.cards[k].body), `${l}: the Design Studio section has its copy`);
    ok(!/—/.test(JSON.stringify(d) + JSON.stringify(p)), `${l}: no em dash in the new copy`);
    const c = JSON.parse(read(`../client/src/locales/${l}/common.json`)).planLock;
    ok(c && c.cta.includes('{{plan}}') && c.designStudio.title && c.social.title, `${l}: lock copy exists`);
}
ok(/<DesignStudioShowcase \/>/.test(read('../client/src/pages/HomePage.jsx')), 'the Design Studio section is on the landing page');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
