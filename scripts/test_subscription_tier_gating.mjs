// scripts/test_subscription_tier_gating.mjs
// Verifies:
// 1. Free tier AI ops limit is 3 across backend gate, frontend limits, and meter.
// 2. Editing styles and "auto" mode are accessible only in paid subscriptions.
// 3. Free tier defaults to no style and manual mode.
// 4. Locales contain upgrade copies without em dashes.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';

import assert from 'assert/strict';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// stockGate calls getUserPlan(), which normally reads Supabase. Keep this
// contract test fully local and deterministic: the project URL above is a
// placeholder, not a test database, and must never trigger a real request.
const require = createRequire(import.meta.url);
const databasePath = require.resolve('../config/database.js');
const testDatabase = {
    supabaseAdmin: {
        from() {
            return {
                select() {
                    return {
                        eq() {
                            return { single: async () => ({ data: { plan: 'free' }, error: null }) };
                        },
                    };
                },
            };
        },
    },
};
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: testDatabase,
};

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

console.log('── 1. Plan limits & AI commands quota (free = 3) ──');
const gateCode = read('../middleware/usageGate.js');
const planLimitsCode = read('../client/src/lib/planLimits.js');

// Backend usageGate limits
assert.match(gateCode, /free:\s*\{\s*ai_ops:\s*3\b/, 'usageGate PLAN_LIMITS.free.ai_ops must be 3');
assert.match(gateCode, /creator:\s*\{\s*ai_ops:\s*100\b/, 'usageGate PLAN_LIMITS.creator.ai_ops must be 100');
assert.match(gateCode, /pro:\s*\{\s*ai_ops:\s*-1\b/, 'usageGate PLAN_LIMITS.pro.ai_ops must be -1');

// Frontend planLimits.js
assert.match(planLimitsCode, /free:\s*3\b/, 'planLimits AI_OPS_LIMITS.free must be 3');
assert.match(planLimitsCode, /creator:\s*100\b/, 'planLimits AI_OPS_LIMITS.creator must be 100');

const { AI_OPS_LIMITS, getAiOpsLimit, aiOpsMeter } = await import('../client/src/lib/planLimits.js');
assert.equal(AI_OPS_LIMITS.free, 3);
const { FREE_TRIAL_AUTO_RUNS } = require('../middleware/usageGate.js');
const CLIENT_FREE_TRIAL_AUTO_RUNS = /export const FREE_TRIAL_AUTO_RUNS = (\d+)/.exec(planLimitsCode)?.[1] * 1;
assert.equal(getAiOpsLimit('free'), 3);
assert.equal(getAiOpsLimit('unknown'), 3);

// Meter behavior at free = 3
const meter2 = aiOpsMeter(2, 'free');
assert.equal(meter2.exhausted, false);
assert.equal(meter2.used, 2);
assert.equal(meter2.limit, 3);
assert.equal(meter2.ratio, 2 / 3);

const meter3 = aiOpsMeter(3, 'free');
assert.equal(meter3.exhausted, true);
assert.equal(meter3.ratio, 1);

console.log('  ok  Free tier quota is strictly 3 AI operations');

console.log('── 2. Backend gate: free tier capability ──');
// R148 changed this deliberately. The gate used to rewrite editingMode 'auto'
// to 'normal' and blank editingStyle for every free user, so the request
// succeeded while quietly becoming a different edit than the one asked for.
// It now refuses instead, and a brand new account gets FREE_TRIAL_AUTO_RUNS
// Auto runs with the capability intact. The published free plan is unchanged:
// once the trial is spent, styles and Auto are still not available.
// Behaviour is covered by scripts/test_usage_runs.mjs; these pin the contract.
assert.match(gateCode, /req\.userPlan\s*=\s*plan/, 'aiGate sets req.userPlan');
const gateNoComments = gateCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/req\.body\.editingStyle\s*=\s*null/.test(gateNoComments), 'aiGate must NOT blank editingStyle any more: it refuses instead');
assert.ok(!/req\.body\.editingMode\s*=\s*'normal'/.test(gateNoComments), 'aiGate must NOT force normal mode any more: it refuses instead');
assert.match(gateCode, /AUTO_TRIAL_SPENT/, 'aiGate refuses a spent trial explicitly');
assert.match(gateCode, /FREE_TRIAL_AUTO_RUNS/, 'aiGate grants a trial');
assert.equal(FREE_TRIAL_AUTO_RUNS, 3, 'the trial is 3 Auto runs');
assert.equal(CLIENT_FREE_TRIAL_AUTO_RUNS, FREE_TRIAL_AUTO_RUNS, 'the client copy constant must match the server');

console.log('  ok  aiGate refuses a spent trial rather than silently downgrading the edit');

console.log('── 3. AI Agent controller enforcement ──');
const aiCtrl = read('../controllers/aiAgentController.js');
// The controller strips independently of the gate, so a trial run has to reach
// it as well or the capability would be taken back after the gate allowed it.
assert.match(aiCtrl, /const styleAndAutoAllowed = req\.userPlan !== 'free' \|\| req\.autoTrialActive === true/, 'aiAgentController honours the trial flag');
assert.match(aiCtrl, /editingMode: styleAndAutoAllowed \? proj\.editingMode : 'normal'/, 'aiAgentController still forces normal mode outside the trial');
assert.match(aiCtrl, /\.\.\.\(styleAndAutoAllowed && proj\.editingStyle && EDITING_STYLE_IDS\.includes\(proj\.editingStyle\.id\)/, 'aiAgentController still omits editingStyle outside the trial');

console.log('  ok  aiAgentController allows a trial run and still strips outside it');

console.log('── 4. EditingStylePicker UI gating & defaults ──');
const picker = read('../client/src/components/Assistant/EditingStylePicker.jsx');
assert.match(picker, /useUserPlan/, 'EditingStylePicker imports and uses useUserPlan');
assert.match(picker, /plan === 'creator' \|\| plan === 'pro'/, 'EditingStylePicker checks paid plan status');
assert.match(picker, /!isPaid && id !== null/, 'EditingStylePicker blocks selecting non-null styles for free users');
assert.match(picker, /!isPaid && m === 'auto'/, 'EditingStylePicker blocks selecting auto mode for free users');
assert.match(picker, /EVENT_TYPES\.QUOTA_EXCEEDED/, 'EditingStylePicker fires QUOTA_EXCEEDED event on blocked clicks');
assert.match(picker, /reason:\s*'paid_feature'/, 'EditingStylePicker uses paid_feature reason');
assert.match(picker, /Lock/, 'EditingStylePicker imports and renders Lock indicator');

console.log('  ok  EditingStylePicker enforces paid-only access to styles and auto mode');

console.log('── 5. Modal and PlanSheet support for paid_feature ──');
const upgradeModal = read('../client/src/components/UpgradeModal.jsx');
assert.match(upgradeModal, /reason\s*=\s*'ai_ops'/, 'UpgradeModal accepts reason prop');
assert.match(upgradeModal, /reason === 'paid_feature'/, 'UpgradeModal checks for paid_feature');

const planSheet = read('../client/src/components/PlanSheet.jsx');
assert.match(planSheet, /reason === 'paid_feature'/, 'PlanSheet checks for paid_feature');

const ideLayout = read('../client/src/layouts/IDELayout.jsx');
assert.match(ideLayout, /reason:\s*payload\?\.reason \|\| 'ai_ops'/, 'IDELayout stores reason from quota exceeded event');
assert.match(ideLayout, /reason=\{quotaModal\.reason\}/, 'IDELayout passes reason to UpgradeModal');

console.log('  ok  UpgradeModal and PlanSheet handle paid_feature upgrade flow');

console.log('── 6. Locales and copy integrity (no em dashes) ──');
for (const lang of ['en', 'fr']) {
    const editorJson = JSON.parse(read(`../client/src/locales/${lang}/editor.json`));
    const landingJson = JSON.parse(read(`../client/src/locales/${lang}/landing.json`));
    const termsJson = JSON.parse(read(`../client/src/locales/${lang}/terms.json`));
    const commonJson = JSON.parse(read(`../client/src/locales/${lang}/common.json`));

    // editor.json
    assert.ok(editorJson.editingStyles.styleUpgradeRequired, `${lang} styleUpgradeRequired missing`);
    assert.ok(editorJson.editingStyles.autoUpgradeRequired, `${lang} autoUpgradeRequired missing`);
    assert.ok(!/—/.test(editorJson.editingStyles.styleUpgradeRequired), `${lang} styleUpgradeRequired has em dash`);
    assert.ok(!/—/.test(editorJson.editingStyles.autoUpgradeRequired), `${lang} autoUpgradeRequired has em dash`);

    // landing.json free features
    const freeFeatures = landingJson.pricing.plans.free.features.join(' ');
    assert.match(freeFeatures, /3\s*(AI operations|opérations IA)/, `${lang} landing free plan must state 3 AI operations`);
    assert.ok(landingJson.pricing.plans.free.locked.some(s => /style/i.test(s)), `${lang} free locked list must include styles`);

    // terms.json
    const plansSection = termsJson.sections.find(s => s.id === 'plans');
    const tableBlock = plansSection.blocks.find(b => b && b.table);
    const freeRow = tableBlock.table.rows.find(r => r[0] === 'Free');
    assert.match(freeRow[2], /3\s*(AI operations|opérations IA)/, `${lang} terms free row must state 3 AI operations`);

    // common.json planSheet
    assert.ok(commonJson.planSheet.paidFeatureTitle, `${lang} planSheet.paidFeatureTitle missing`);
    assert.ok(commonJson.planSheet.paidFeatureBody, `${lang} planSheet.paidFeatureBody missing`);

    // editor.json shortsPanel & assetPanel locked copy
    assert.ok(editorJson.shortsPanel.lockedTitle, `${lang} shortsPanel.lockedTitle missing`);
    assert.ok(editorJson.shortsPanel.lockedDescription, `${lang} shortsPanel.lockedDescription missing`);
    assert.ok(editorJson.assetPanel.stockLockedTitle, `${lang} assetPanel.stockLockedTitle missing`);
    assert.ok(editorJson.assetPanel.stockLockedDescription, `${lang} assetPanel.stockLockedDescription missing`);
    assert.ok(!/—/.test(editorJson.shortsPanel.lockedTitle), `${lang} shortsPanel.lockedTitle has em dash`);
    assert.ok(!/—/.test(editorJson.shortsPanel.lockedDescription), `${lang} shortsPanel.lockedDescription has em dash`);
    assert.ok(!/—/.test(editorJson.assetPanel.stockLockedTitle), `${lang} assetPanel.stockLockedTitle has em dash`);
    assert.ok(!/—/.test(editorJson.assetPanel.stockLockedDescription), `${lang} assetPanel.stockLockedDescription has em dash`);

    // landing.json free locked list contains shorts & stock
    assert.ok(landingJson.pricing.plans.free.locked.some(s => /shorts/i.test(s) && /stock/i.test(s)), `${lang} free locked list must include shorts and stock`);
}

console.log('  ok  Locales correctly updated without em dashes');

console.log('── 7. Stock media gate & route integration ──');
const { stockGate } = await import('../middleware/usageGate.js');
assert.equal(typeof stockGate, 'function', 'stockGate must be an exported function');

// Test stockGate unit behavior
let stockStatus = null;
let stockJson = null;
let stockNextCalled = false;
const mockRes = {
    status(code) { stockStatus = code; return this; },
    json(data) { stockJson = data; return this; },
};

// 1. Free tier gets 402 STOCK_MEDIA_PAID
await stockGate({ user: { id: 'mock-free-user' } }, mockRes, () => { stockNextCalled = true; });
assert.equal(stockStatus, 402);
assert.equal(stockJson?.error, 'STOCK_MEDIA_PAID');
assert.equal(stockJson?.upgradeRequired, 'creator');
assert.equal(stockNextCalled, false);

// Verify stockMediaRoutes.js applies stockGate
const stockRoutesCode = read('../routes/stockMediaRoutes.js');
assert.match(stockRoutesCode, /const\s*\{\s*stockGate\s*\}\s*=\s*require\('\.\.\/middleware\/usageGate'\)/, 'stockMediaRoutes imports stockGate');
assert.match(stockRoutesCode, /router\.get\('\/search',\s*stockLimiter,\s*authMiddleware,\s*stockGate/, 'stockMediaRoutes applies stockGate to /search');
assert.match(stockRoutesCode, /router\.post\('\/suggest-broll',\s*stockLimiter,\s*authMiddleware,\s*stockGate/, 'stockMediaRoutes applies stockGate to /suggest-broll');

console.log('  ok  stockGate restricts stock media endpoints to paid users');

console.log('── 8. Shorts & Stock frontend panel gating ──');
const shortsPanelCode = read('../client/src/components/ShortsPanel.jsx');
assert.match(shortsPanelCode, /useUserPlan/, 'ShortsPanel imports useUserPlan');
assert.match(shortsPanelCode, /plan === 'free'/, 'ShortsPanel checks for free plan');
assert.match(shortsPanelCode, /reason:\s*'paid_feature'/, 'ShortsPanel emits paid_feature on gated actions');
assert.match(shortsPanelCode, /Lock/, 'ShortsPanel renders lock indicator');

const assetPanelCode = read('../client/src/components/AssetPanel.jsx');
assert.match(assetPanelCode, /useUserPlan/, 'AssetPanel imports useUserPlan');
assert.match(assetPanelCode, /isPaid:\s*true/, 'AssetPanel marks stock tab as isPaid');
assert.match(assetPanelCode, /tab === 'stock' && isFree/, 'AssetPanel checks stock tab on free plan');
assert.match(assetPanelCode, /stockLockedTitle/, 'AssetPanel renders locked view for free plan');

const ideLayoutCode = read('../client/src/layouts/IDELayout.jsx');
assert.match(ideLayoutCode, /tab === 'shorts' && isFree/, 'IDELayout gates shorts tab for free users');
assert.doesNotMatch(ideLayoutCode, /setAssetInitialTab\('stock'\)/, 'IDELayout no longer exposes the removed Stock shortcut');
assert.match(ideLayoutCode, /<AssetPanel onClose=.*initialTab=\{assetInitialTab\}/, 'IDELayout forwards initialTab to AssetPanel');

const toolsCode = read('../client/src/agent/VideoEditorTools.js');
assert.match(toolsCode, /if \(response\.status === 402\)/, 'VideoEditorTools checks for 402 paid feature on stock search');

console.log('  ok  Shorts and Stock panels strictly gated across UI, engine, and layout');

// ── R163: a plan may not SELL what is not built ─────────────────────────────
//
// The Oct GDPR audit found Pro advertising "2 team seats" and a "priority
// processing queue" with no code behind either, and R163 found a third:
// "Virality scoring + performance analysis" — viralEngine/ has seven modules
// and no caller, and ViralIntelligencePanel.jsx has no importer.
//
// The guard is deliberately shaped so it fails in BOTH directions. A claim on
// this list must not appear in any plan's `features` (that is the
// over-promise), and it must still appear in `soon` (so the fix cannot be
// "quietly delete the row and tell nobody"). When one of these is genuinely
// built, remove it from UNBUILT here in the same change that ships it — that
// is the point at which it may move back into `features`.
const UNBUILT_CLAIMS = [
    { en: 'Priority processing queue',                  fr: 'File de traitement prioritaire',
      why: 'no queue-priority code in jobs/ or services/' },
    { en: '2 team seats',                               fr: "2 sièges d'équipe",
      why: 'no organizations/organization_members model, no seat billing' },
    { en: 'Virality scoring + performance analysis',    fr: 'Score de viralité + analyse de performance',
      why: 'viralEngine/ has no caller; ViralIntelligencePanel.jsx has no importer' },
];

for (const lang of ['en', 'fr']) {
    const landingJson = JSON.parse(read(`../client/src/locales/${lang}/landing.json`));
    const plans = landingJson.pricing.plans;

    for (const claim of UNBUILT_CLAIMS) {
        const text = claim[lang];
        for (const [planKey, plan] of Object.entries(plans)) {
            assert.ok(!(plan.features || []).includes(text),
                `${lang} ${planKey}.features sells "${text}" but it is not built (${claim.why}). ` +
                'Move it to the plan\'s `soon` list, or remove it from UNBUILT_CLAIMS in this test ' +
                'if the change that ships it is this one.');
            assert.ok(!(plan.locked || []).includes(text),
                `${lang} ${planKey}.locked lists "${text}", which reads as "not in this plan" ` +
                'rather than "not built". It belongs in `soon`.');
        }
        assert.ok((plans.pro.soon || []).includes(text),
            `${lang} pro.soon must still carry "${text}" so an unbuilt promise stays visible ` +
            'rather than being silently dropped.');
    }

    // The Pro tagline carried the seats promise in prose ("Bring your team").
    assert.ok(!/bring your team|invitez votre équipe/i.test(plans.pro.tagline),
        `${lang} pro.tagline still promises team seats in prose: "${plans.pro.tagline}"`);

    assert.ok(landingJson.v2.pricing.soonLabel,
        `${lang} v2.pricing.soonLabel missing — the soon list would render unlabelled`);
    assert.ok(!/—/.test(landingJson.v2.pricing.soonLabel), `${lang} soonLabel has em dash`);
}

// The pricing card must actually render the list, with its label.
const closingCode = read('../client/src/pages/landing/Closing.jsx');
assert.match(closingCode, /const soon = data\.soon \|\| \[\]/, 'PricingV2 must read the soon list');
assert.match(closingCode, /soon\.map\(/, 'PricingV2 must render the soon list');
assert.match(closingCode, /v2\.pricing\.soonLabel/, 'PricingV2 must label the soon list');

console.log('  ok  No plan sells an unbuilt feature; the three known ones render as not-yet-built');

console.log('\nALL SUBSCRIPTION TIER GATING TESTS PASSED!');

