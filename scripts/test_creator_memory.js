/**
 * scripts/test_creator_memory.js
 *
 *   node scripts/test_creator_memory.js
 *
 * Pins that the Creator Memory (editing-profile) learning loop is actually
 * CONNECTED end to end, and that skill inference understands the vocabulary the
 * real pipeline speaks.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every piece of this feature existed and looked healthy in isolation:
 * UserProfileEngine, PatternLearner, all four Supabase tables (applied in
 * prod), the /profile + /reset + /export endpoints, and a fully built
 * UserStylePage. What did NOT exist was the wiring between them, in three
 * places at once — and none of it was visible from any single file:
 *
 *   1. `updateFromCommand()` only ran when `engineResult?.success === true`,
 *      which happens ONLY in Orchestrator PHASE 5, reachable ONLY via
 *      POST /api/brain/command. The client deliberately stopped calling that
 *      route (it double-interpreted commands with a second GPT-4o pass —
 *      correctly removed), and the learning hook silently went with it. Prod
 *      showed the damage: 2 of 7 profiles had any common_commands at all, and
 *      those were stale rows predating the change.
 *   2. `inferSkillLevel()` had ZERO callers, so skill_level was written once at
 *      row creation and never again — all 7 prod profiles sat at 'beginner'.
 *   3. `UserStylePage.jsx` had no <Route>, so the page — including its GDPR
 *      reset/export controls — was unreachable.
 *
 * The failure mode is the dangerous kind: nothing errors, nothing 500s, the
 * feature simply never learns. Static wiring checks are the only way to catch
 * a disconnection like this, since each component passes its own unit tests.
 *
 * Part static analysis of the real source, part EXECUTION of the real
 * inferSkillLevel implementation.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

// ── 1. The learning endpoint exists and is GPT-free ──────────────────────────
const brainRoutes = read('server/routes/brainRoutes.js');

console.log('\n── /api/brain/observe-command exists and stays cheap ──');

check('the observe-command route is declared',
    /router\.post\(\s*'\/observe-command'/.test(brainRoutes),
    'Without this endpoint the real pipeline has nowhere to report executed commands.');

check('it is behind authenticateUser',
    /router\.post\(\s*'\/observe-command',\s*authenticateUser/.test(brainRoutes),
    'Profile writes are per-user — an unauthenticated caller must not reach this.');

// Isolate the handler body so the assertions below can't match other routes.
const observeBody = (() => {
    const start = brainRoutes.indexOf("router.post('/observe-command'");
    if (start === -1) return '';
    const end = brainRoutes.indexOf('\nrouter.', start + 10);
    return brainRoutes.slice(start, end === -1 ? brainRoutes.length : end);
})();

check('it calls updateFromCommand (the hook that was orphaned)',
    /profileEngine\s*\.\s*updateFromCommand\(/.test(observeBody),
    'This is the entire point of the endpoint.');

check('it does NOT invoke the orchestrator / any model call',
    !/orchestrator\.process\(/.test(observeBody),
    'This route must stay learning-only — routing it through the Brain reintroduces the '
    + 'second GPT interpretation that was deliberately removed.');

check('it validates the command argument',
    /typeof command !== 'string'/.test(observeBody));

check('only successful commands train the profile',
    /success === true/.test(observeBody),
    'A failed command says nothing about what the user prefers.');

check('it never returns a hard error to a fire-and-forget caller',
    /catch\s*\(\s*err\s*\)[\s\S]*return res\.json\(\{ ok: true \}\)/.test(observeBody),
    'The caller ignores the response by design; a rejected promise would surface as noise.');

// ── 2. The client actually calls it, on the real success path ────────────────
const workflow = read('client/src/agent/WorkflowController.js');

console.log('\n── WorkflowController reports executed commands to the server ──');

check('WorkflowController calls /api/brain/observe-command',
    /observe-command/.test(workflow),
    'recordEdit() alone only writes the CLIENT-side ledger — the server profile stays frozen.');

// The call must sit next to recordEdit, i.e. on the success branch — not, say,
// in an error handler or a place that runs for advisory triggers too.
const recordEditIdx = workflow.indexOf('recordEdit?.(');
const observeIdx    = workflow.indexOf('observe-command');
check('the call sits on the same success path as recordEdit',
    recordEditIdx !== -1 && observeIdx !== -1 && observeIdx > recordEditIdx
        && (observeIdx - recordEditIdx) < 2500,
    'Learning must fire exactly where an edit is known to have succeeded.');

check('it sends the resolved operation, not raw user text',
    /command:\s*result\.operation/.test(workflow),
    'Sending raw text would require the server to re-interpret it — the exact thing this design avoids.');

check('the call is wrapped so it cannot break the edit',
    /profile learning skipped/.test(workflow),
    'Telemetry for a preference model must never surface into the edit path.');

// ── 3. Skill inference is wired AND speaks the pipeline's vocabulary ─────────
const profileEngineSrc = read('server/brain/UserProfileEngine.js');

console.log('\n── skill_level is actually recomputed ──');

check('inferSkillLevel has a caller inside updateFromCommand',
    /skill_level:\s*this\.inferSkillLevel\(/.test(profileEngineSrc),
    'With zero callers the field is written once at row creation and never changes.');

check('it infers from the FULL accumulated vocabulary, not just this one command',
    /this\.inferSkillLevel\(Object\.keys\(nextCommands\)\)/.test(profileEngineSrc),
    'Judging skill from a single command would make the level flap on every edit.');

// Execute the real implementation — the keyword-matching bug below is invisible
// to static analysis and was live in the original code.
//
// UserProfileEngine requires config/database.js, which THROWS at require-time on
// missing Supabase env vars. inferSkillLevel is a pure function that never
// touches the client, so stub the vars just enough to let the module load. These
// are deliberately obvious non-secrets; no request is ever made with them.
for (const [k, v] of Object.entries({
    SUPABASE_URL:              'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    SUPABASE_ANON_KEY:         'test-anon-key',
})) {
    if (!process.env[k]) process.env[k] = v;
}

const { UserProfileEngine } = require('../server/brain/UserProfileEngine');
const engine = new UserProfileEngine();

console.log('\n── inferSkillLevel understands real command ids (not just prose) ──');

const CASES = [
    [[],                                        'beginner',     'no history'],
    [['silence_removal', 'auto_captions'],       'beginner',     'classic beginner workflow'],
    [['queue_export', 'split_clip', 'trim'],     'beginner',     'basic editing only'],
    [['color_grade'],                            'advanced',     'underscore form of an advanced op'],
    [['color grade'],                            'advanced',     'prose form still works'],
    [['macro_multicam'],                         'advanced',     'multicam is advanced'],
    [['split_by_speaker', 'auto_captions'],      'advanced',     'one advanced op dominates'],
    [['organize_clips', 'silence_removal'],      'intermediate', 'mixed / unclassified'],
];

for (const [history, expected, label] of CASES) {
    const got = engine.inferSkillLevel(history);
    check(`${label}: [${history.join(', ') || '(empty)'}] → ${expected}`,
        got === expected,
        `Got '${got}' instead. Command ids use underscores; prose keywords use spaces — `
        + `both must normalise to the same thing.`);
}

// The specific regression: 'color_grade'.includes('color grade') is false.
check('an underscored id is not defeated by a spaced keyword',
    engine.inferSkillLevel(['color_grade']) === 'advanced',
    'This is the original bug — the single most clearly-advanced command scored as not-advanced.');

// ── 4. The page the profile feeds is reachable ───────────────────────────────
const app = read('client/src/App.jsx');

console.log('\n── UserStylePage is routed and reachable ──');

check('UserStylePage is imported in App.jsx',
    /import UserStylePage from/.test(app));

check('a route renders it',
    /<Route[^>]*element=\{<UserStylePage\s*\/>\}/.test(app),
    'The page was fully built but unroutable — including its GDPR reset/export controls.');

const dashboard = read('client/src/pages/DashboardPage.jsx');
check('something navigates to it (not just a reachable URL)',
    /navigate\('\/style'\)/.test(dashboard),
    'A route with no entry point is only marginally better than no route.');

// i18n parity — a missing key renders the raw key string to the user.
const en = JSON.parse(read('client/src/locales/en/dashboard.json'));
const fr = JSON.parse(read('client/src/locales/fr/dashboard.json'));
for (const key of ['yourStyle', 'yourStyleShort']) {
    check(`dashboard.${key} exists in en + fr`,
        typeof en[key] === 'string' && typeof fr[key] === 'string');
}

// ── 5. media_assets rows are actually CREATED, not just updated ──────────────
// Every write in MediaIntelligencePipeline was `.update()`, which matches zero
// rows and reports NO error when the row doesn't exist — and nothing anywhere
// INSERTed. Analysis ran, logged "✓ analyzed", and wrote nothing; the table sat
// at 0 rows in prod while the pipeline looked healthy. See CLAUDE.md R38.
const pipelineSrc = read('server/brain/media/MediaIntelligencePipeline.js');

console.log('\n── media_assets rows get created before they are updated ──');

check('a row-creation helper exists',
    /_ensureAssetRow\s*\(/.test(pipelineSrc),
    'Without an INSERT, every .update() on media_assets is a silent no-op.');

check('it upserts into media_assets',
    /\.from\('media_assets'\)[\s\S]{0,200}\.upsert\(/.test(pipelineSrc),
    'Row creation must be an insert/upsert — .update() cannot create the row.');

check('re-analysis cannot clobber existing results',
    /ignoreDuplicates:\s*true/.test(pipelineSrc),
    'A second job for the same asset must not blank out the first job\'s findings.');

check('analyzeAsset creates the row before marking it processing',
    (() => {
        const ensureIdx = pipelineSrc.indexOf('await this._ensureAssetRow(');
        // The status value is a shared constant, not a literal (see
        // server/brain/media/analysisStatus.js) — match the call, not the string.
        const statusIdx = pipelineSrc.search(
            /await this\._updateAssetStatus\(assetId,\s*ASSET_ANALYSIS_PROCESSING\)/);
        return ensureIdx !== -1 && statusIdx !== -1 && ensureIdx < statusIdx;
    })(),
    'Marking status first would itself be a no-op on a missing row.');

// ── 6. The analyzers receive a LOCAL file, not a GCS key ─────────────────────
// AudioClassifier.classify() and VisualAnalyzer.analyze() both start with
// fs.existsSync() and bail to an 'unknown' result. They were handed the GCS key
// (`raw/{userId}/{file}`), so BOTH silently degraded on every single asset.
console.log('\n── the GCS key is resolved to a real local file first ──');

check('a resolver exists',
    /_resolveToLocalFile\s*\(/.test(pipelineSrc));

check('it downloads from the GCS bucket when there is no local file',
    /storageConfig\.bucket\.file\([\s\S]{0,120}\.download\(/.test(pipelineSrc),
    'Without this the analyzers fs.existsSync() a GCS key and always return unknown.');

check('analyzers are called with the resolved local path',
    /this\.audioClassifier\.classify\(localPath\)/.test(pipelineSrc)
    && /this\.visualAnalyzer\.analyze\(localPath,/.test(pipelineSrc),
    'Passing the original filePath straight through reintroduces the bug.');

check('an unresolvable file is recorded as failed, not written as "unknown"',
    /if \(!localPath\)[\s\S]{0,400}_updateAssetStatus\(assetId, ASSET_ANALYSIS_FAILED\)/.test(pipelineSrc),
    'A row full of "unknown" is indistinguishable from a real (bad) analysis result.');

check('only downloaded temp files are deleted',
    /cleanupPath/.test(pipelineSrc) && /finally\s*\{[\s\S]{0,300}cleanupPath/.test(pipelineSrc),
    'Deleting a pre-existing local upload would destroy user content.');

// The asset name has to survive route -> job -> pipeline, or the Brain can only
// refer to footage by opaque id (R22 wants it to speak in real clip names).
console.log('\n── the asset name reaches the row ──');
check('the route accepts/derives a name',
    /const \{ assetId, gcsPath, projectId, name \}/.test(brainRoutes));
check('the worker forwards the name to analyzeAsset',
    /analyzeAsset\(assetId, filePath, projectId, userId, name/.test(read('worker.js')));
check('the client sends the real filename',
    /name:\s*file\.name/.test(read('client/src/layouts/IDELayout.jsx')));

// ── 7. The learned profile actually shapes the Brain's advice ────────────────
// The profile block was rendered into the prompt but no rule told the model what
// to DO with the habits — the data was visible and inert.
const brainSrc = read('server/brain/EditorialBrain.js');

console.log('\n── the profile is actionable in the prompt, not just displayed ──');

check('skill_level governs how much is explained',
    /skill_level drives HOW MUCH you explain/.test(brainSrc));

check('learned habits are treated as established, not pitched as new',
    /established habit/.test(brainSrc));

check('an already-satisfied habit is not re-suggested',
    /ALREADY satisfied on this timeline must not be suggested again/.test(brainSrc));

check('the profile can be overridden by what the footage needs',
    /tendencies, not rules/.test(brainSrc));

check('an empty profile is read as NEW, not unskilled',
    /means this user is NEW, not that they are unskilled/.test(brainSrc),
    'Otherwise a first-time user gets advice inferred from absent data.');

// Execute the real prompt builder — a template-literal error here would only
// surface at runtime, inside a route that swallows errors.
{
    for (const [k, v] of Object.entries({
        SUPABASE_URL: 'http://localhost:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        SUPABASE_ANON_KEY: 'test-anon-key',
    })) { if (!process.env[k]) process.env[k] = v; }

    const { EditorialBrain } = require('../server/brain/EditorialBrain');
    const brain = new EditorialBrain();

    const built = brain.buildSystemPrompt(
        { duration: 120, detectedSpeakers: 2 },
        {
            skill_level: 'advanced',
            common_commands: { silence_removal: 12, color_grade: 7 },
            permanently_hidden: ['add_music'],
            typically_removes_silences: true,
        },
        'tiktok',
        null
    );

    check('buildSystemPrompt renders a populated profile',
        built.includes('advanced') && built.includes('silence_removal(12)'),
        'Learned values must reach the prompt text itself.');

    check('permanently_hidden items are named in the prompt',
        built.includes('add_music'));

    // Empty/missing profiles must not throw — every new user hits this path.
    for (const [label, prof] of [['empty', {}], ['null', null]]) {
        let ok = true;
        try { brain.buildSystemPrompt({}, prof, 'tiktok', null); } catch { ok = false; }
        check(`a ${label} profile builds without throwing`, ok);
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// R49 · A PostgREST query builder is thenable, NOT a Promise.
//
// `.eq(...).catch(fn)` throws `TypeError: .catch is not a function`
// SYNCHRONOUSLY, before the query is sent — so the write never happens at all.
// Both bin-classification updates were written that way and had never once
// executed; the outer try/catch turned it into a single log line that read like
// a failure inside the query rather than a query that never ran.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── supabase writes never use .catch() on the builder ──');
{
    const files = [
        'server/brain/media/MediaIntelligencePipeline.js',
        'server/brain/ProjectIntelligence.js',
        'server/brain/UserProfileEngine.js',
        'routes/polarWebhook.js',
    ];

    for (const rel of files) {
        let raw;
        try { raw = require('fs').readFileSync(require('path').resolve(__dirname, '..', rel), 'utf8'); }
        catch { continue; }

        // Strip comments first — the comment in MediaIntelligencePipeline that
        // EXPLAINS this bug contains the offending pattern verbatim, so a naive
        // grep reports the very thing it is warning about.
        const src = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

        // A .catch() chained directly onto a builder terminator (.eq/.select/
        // .single/.maybeSingle) is the dangerous shape. Awaiting the builder and
        // inspecting `error` is the correct one.
        const bad = src.match(/\.(eq|select|single|maybeSingle|upsert|insert)\([^)]*\)\s*\n?\s*\.catch\(/g);
        check(`${rel.split('/').pop()} has no .catch() on a query builder`,
            !bad,
            bad ? bad.join(' | ') : '');
    }

    const pipeSrc = require('fs').readFileSync(
        require('path').resolve(__dirname, '../server/brain/media/MediaIntelligencePipeline.js'), 'utf8');

    check('bin classification inspects the returned error instead',
        /const \{ error: assetErr \} = await supabaseAdmin/.test(pipeSrc)
        && /if \(assetErr\)/.test(pipeSrc));
    check('it reports how many assets were actually persisted',
        /Bin classification persisted for \$\{classified\}/.test(pipeSrc),
        'a count is the only proof the write landed (R38)');
}

// ── R50 · Whisper's 25 MB limit is enforced before the upload ────────────────
// _transcribe() streamed the file straight in with no size check, so a long
// clip failed outright with
//   "413: Maximum content size limit (26214400) exceeded (26368000 bytes read)"
// jobs/audioProcessor.js has always had a WHISPER_LIMIT guard; the Brain's own
// transcription path never did.
console.log('\n── transcription respects the Whisper size limit ──');
{
    const pipe = read('server/brain/media/MediaIntelligencePipeline.js');

    check('a size limit is declared',
        /WHISPER_LIMIT\s*=\s*25 \* 1024 \* 1024/.test(pipe));
    check('the file size is measured before upload',
        /fs\.statSync\(filePath\)/.test(pipe));
    check('oversized audio is compressed, not blindly uploaded',
        /_compressForWhisper\(/.test(pipe));
    check('compression targets mono 16 kHz (what Whisper wants)',
        /'-ac', '1'/.test(pipe) && /'-ar', '16000'/.test(pipe));
    check('video is never decoded for a transcript',
        /'-vn'/.test(pipe),
        'decoding video to get audio is the R36 waste all over again');
    check('a still-too-large file is skipped rather than 413ing',
        /still \$\{\(compressed/.test(pipe));
    check('the temp file is always cleaned up',
        /finally \{[\s\S]{0,200}unlinkSync\(tempPath\)/.test(pipe));
    check('transcription uses the audio capability (stays on the real API)',
        /getAIClient\(\{ capability: 'audio' \}\)/.test(pipe),
        'Ollama has no audio API — R45');
}

// ── R50 · The waveform route is called WITH auth ─────────────────────────────
// optionalAuth does not fail on a missing header — it just leaves req.user
// undefined, and the route then wrote every user's peaks to a shared
// `waveforms/anonymous/` prefix.
console.log('\n── waveform extraction is called with credentials ──');
{
    const engine = read('client/src/services/WaveformEngine.js');

    check('WaveformEngine imports authFetch',
        /import \{ authFetch \}/.test(engine));
    check('the extract call uses authFetch, not bare fetch',
        /authFetch\('\/api\/waveform\/extract'/.test(engine),
        'bare fetch sends no Authorization header — peaks land under anonymous/');
    check('it no longer hand-sets Content-Type (authFetch owns that)',
        !/authFetch\('\/api\/waveform\/extract'[\s\S]{0,200}'Content-Type'/.test(engine));
}

console.log(
    failures === 0
        ? '\nALL CREATOR MEMORY TESTS PASSED\n'
        : `\n${failures} CREATOR MEMORY TEST(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
