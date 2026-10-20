/**
 * server/routes/motionRoutes.js
 *
 * R92: POST /api/motion/compose. An LLM writes the motion.
 *
 * Before R92 the LLM could only choose one of 26 preset ids. Here it writes a
 * MOTION SCRIPT per layer: beats from the verb vocabulary (slam-in, punch,
 * float, whip-out…), plus raw keyframes when no verb fits. Vocabulary and
 * validation both come from client/src/motion/MotionComposer.js, loaded with
 * import() the same way TemplateRenderer loads TemplateGraphics.js. The prompt,
 * the server check and the client renderer therefore use one vocabulary.
 *
 * Works with no AI at all: with no provider configured, or on any LLM failure,
 * the deterministic director (planMotionFromBrief) answers and the response
 * says `source: 'rules'`. The command never fails because the LLM is down.
 */

const express = require('express');
const path = require('path');
const { pathToFileURL } = require('url');
const { authenticateUser } = require('../../middleware/auth.js');
const { getAIClient, isAIConfigured, resolveModel } = require('../../services/AIProvider');
const { sanitizeEditingStyle, isCalmStyle } = require('../brain/editingStyles');
const { generateScenePlan, generateMotionScript } = require('../../services/motionProvider.js');
// R103 — the Motion Design Knowledge Base. Retrieval is deterministic and
// local (see MotionTechniqueIndex.js on why it is not the asset search engine
// yet), so an unreachable AI provider or an empty shortlist costs nothing:
// every path below treats a technique as a hint that may be absent.
const {
    findTechniques,
    shortlistForPlan,
    techniqueByName,
    motionForTechnique,
    promptLines,
} = require('../audio-engine/library/MotionTechniqueIndex.js');

const router = express.Router();

const COMPOSER_PATH = path.join(__dirname, '..', '..', 'client', 'src', 'motion', 'MotionComposer.js');
let composerPromise = null;
function loadComposer() {
    if (!composerPromise) composerPromise = import(pathToFileURL(COMPOSER_PATH).href);
    return composerPromise;
}

const MAX_LAYERS = 12;
const MAX_BRIEF = 600;

/** Sanitise the request's layer list. */
function cleanLayers(layers) {
    if (!Array.isArray(layers)) return [];
    return layers.slice(0, MAX_LAYERS).map(l => ({
        id: String(l?.id || '').slice(0, 80),
        kind: ['text', 'caption', 'image', 'sticker', 'video', 'shape'].includes(l?.kind) ? l.kind : 'text',
        content: String(l?.content || '').slice(0, 120),
        duration: Math.max(0.2, Math.min(600, Number(l?.duration) || 3)),
    })).filter(l => l.id);
}

/**
 * Build the LLM prompt. PURE, so the regression can assert on what the model
 * is told (vocabulary, limits, style rules).
 */
function buildMotionPrompt({ brief, layers, catalog, editingStyle }) {
    const verbs = catalog.map(v => `- ${v.verb} (${v.group}): ${v.describe}`).join('\n');
    const layerLines = layers.map(l => `- id "${l.id}": ${l.kind}, ${l.duration.toFixed(2)} s${l.content ? `, text "${l.content}"` : ''}`).join('\n');
    const calm = editingStyle && isCalmStyle(editingStyle);
    return `You are a senior motion designer. Write the animation for each layer below.

BRIEF FROM THE EDITOR: "${brief}"
${editingStyle ? `EDITING STYLE: ${editingStyle}.${calm ? ' Keep motion restrained: no slams, whips, glitches or shakes, energy at most 0.4.' : ''}` : ''}

LAYERS:
${layerLines}

VERB VOCABULARY (prefer these, they are tuned with real spring physics):
${verbs}

Each beat: {"verb": string, "at": seconds from the layer start (for "out" verbs: seconds BEFORE the end, usually 0), "duration": seconds (optional), "energy": 0..1, "direction": "up"|"down"|"left"|"right" (optional), "easing": optional}.
"anticipate": true (optional) adds a wind-up AGAINST the move just before it — a crouch before a hop, a lean right before flying left. It applies to emphasis and exit verbs only: an entrance has nothing on screen yet to pull back. Use it to give a move weight, not on every beat.

You may also add raw "animations" when no verb fits: {"startTime": s, "anchor": "in"|"out", "easing": name, "keyframes": [{"time": s from the animation start, "properties": {...}, "easing": optional}]}.
Animatable properties: x and y (offset in % of the frame, -120..120), scale (multiplier, 0..6), rotation (degrees), opacity (0..1), blur (px, 0..60), glow (px, 0..60), reveal (0..1, text type-on).
Easings: linear, easeOutCubic, easeInOutSine, easeOutExpo, easeInExpo, backOut, backIn, spring, springGentle, springWobbly, springStiff, springSnappy, springSlow, "cubic-bezier(a,b,c,d)", "spring(stiffness,damping)", "steps(n)".

Design rules:
- Every layer gets ONE entrance at 0, and an exit unless it is shorter than 1 s.
- Emphasis beats land on meaning (the key word, a number), not at random.
- Vary the motion between layers so the edit does not feel templated, but keep one visual language.
- Follow-through: a stack that arrives one line at a time must LEAVE one line at a time too, in reverse — whatever arrived last goes first. Lines that vanish together on one frame are the clearest sign of machine-made motion.
- Secondary action: when two layers move together, do not give them the same verb at the same instant. A backdrop arrives first and quieter; a decoration lands after the words it punctuates.
- Respect the brief's energy. "subtle" or "elegant" means small values and sine or gentle springs; "punchy" means fast entrances, springSnappy and overshoot.
- Keep everything inside each layer's duration.

Reply with JSON only: {"layers": {"<layer id>": {"beats": [...], "animations": [...]}}, "notes": "one short sentence on the motion idea"}`;
}

router.post('/compose', authenticateUser, async (req, res) => {
    // Rate limiter: mounted under aiLimiter in index.js (LLM call).
    const { brief, layers, editingStyle } = req.body || {};
    try {
        const composer = await loadComposer();
        const style = sanitizeEditingStyle(editingStyle);
        const result = await generateMotionScript({
            brief,
            layers,
            editingStyle: style,
            composer,
            buildPrompt: buildMotionPrompt,
            cleanLayers,
        });
        return res.json({
            source: result.source,
            layers: result.layers,
            notes: result.notes,
        });
    } catch (err) {
        if (err.message && err.message.includes('layers is required')) {
            return res.status(400).json({ error: err.message });
        }
        console.error('[motionRoutes /compose] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * R92 round C: the editorial plan for one short (agent/shortPolish.js). The
 * LLM writes the hook headline (what a top creator would put on screen in
 * the first second), the words worth emphasising, and a one-line motion brief
 * for the title. Rules fallback in the client when this fails or no AI is set.
 */
function buildShortPlanPrompt({ text, platform, duration }) {
    return `You are the editor of a top ${platform} account. This is the transcript of a ${Math.round(duration)} s short:
"""${text}"""

Write:
- "headline": the on-screen hook for the first second, 3 to 7 words, no emoji, no hashtags, no quotes, in the transcript's language. It must make a viewer stop scrolling and match what is actually said.
- "keywords": up to 10 single words from the transcript that deserve emphasis in the captions (numbers, results, strong nouns or verbs).
- "titleBrief": one short sentence describing how the headline should move (for example "slams in, punches on the number, whips out").

Reply with JSON only: {"headline": "...", "keywords": ["..."], "titleBrief": "..."}`;
}

function cleanShortPlan(raw) {
    const headline = String(raw?.headline || '').replace(/["#\u{1F300}-\u{1FAFF}]/gu, '').trim().split(/\s+/).slice(0, 8).join(' ').slice(0, 70);
    const keywords = (Array.isArray(raw?.keywords) ? raw.keywords : []).map(k => String(k || '').trim().split(/\s+/)[0]).filter(Boolean).slice(0, 10).map(k => k.slice(0, 30));
    const titleBrief = String(raw?.titleBrief || '').slice(0, 160);
    return headline.split(' ').length >= 2 ? { headline, keywords, titleBrief } : null;
}

/**
 * The vocabulary SceneDirector.js decides from (client/src/motion/
 * SceneDirector.js: BEAT_KINDS, TONES). Mirrored here as plain constants
 * rather than dynamically imported, because cleanScenePlan() below is pure
 * and synchronous — it is unit-tested directly with no server or AI
 * involved — and this vocabulary is small and stable. Keep both lists in
 * sync with SceneDirector.js if either changes.
 */
const BEAT_KINDS = ['intro', 'point', 'stat', 'quote', 'cta', 'outro'];
const TONE_KEYS = ['premium', 'technology', 'viral', 'editorial', 'warm'];

/**
 * R101 — mirrors client/src/motion/MotionComposer.js's VERBS, grouped the
 * same way ('in'/'emphasis'/'out' — 'hold' verbs are for footage, not a
 * beat's text, so they are deliberately left out here). Lets a beat suggest
 * its own motion; SceneComposer.cleanMotionOverride validates it again
 * client-side before it ever reaches composeMotion, so this server-side
 * check only keeps obviously-wrong values out of the plan early.
 */
const ENTER_VERBS = ['fade-in', 'rise-in', 'drop-in', 'slide-in', 'slam-in', 'pop-in', 'zoom-in', 'whip-in', 'swing-in', 'spin-in', 'blur-in', 'typewriter', 'word-reveal', 'glitch-in'];
const EMPHASIS_VERBS = ['punch', 'pulse', 'shake', 'wobble', 'nod', 'flash', 'jiggle', 'bounce'];
const EXIT_VERBS = ['fade-out', 'sink-out', 'fly-out', 'shrink-out', 'blur-out', 'whip-out'];

/**
 * R95 PHASE 4 — the words for a designed sequence.
 *
 * The director (client/src/motion/SceneDirector.js) decides the STRUCTURE
 * from the brief: tone, which beats, how many, their pacing. What it will not
 * do is invent the claims — a brief that asks for "three benefits" without
 * saying what they are gets editable placeholders, because writing marketing
 * copy the user never approved into their video is worse than an empty slot.
 *
 * This route is where those words can come from instead: the brief, plus the
 * transcript when there is one, turned into a title, the points and a call to
 * action. No key configured or the model fails and the client simply keeps its
 * placeholders, so the feature degrades to "structure only" rather than
 * breaking.
 */
function buildScenePlanPrompt({ brief, transcript, beats, tone, platform, techniques = [] }) {
    // R103 — the shortlist retrieved from the knowledge base for THIS brief.
    // Absent (an older caller, or nothing scored) means the block is simply
    // not in the prompt and the model free-forms verbs exactly as before.
    const techLines = Array.isArray(techniques) && techniques.length > 0 ? promptLines(techniques) : [];
    const techBlock = techLines.length > 0
        ? [
            '',
            'These are motion techniques from the library, with the craft reason for each.',
            'Prefer giving a beat a "technique" (its id) over writing your own verbs — the',
            'technique carries timing and energy that have already been judged to work:',
            ...techLines,
            '',
            'Put the id in the beat as "technique": "<id>". Only fall back to writing your own',
            '"motion" object when none of these fits what the beat has to do.',
        ]
        : [];

    const hasStructure = Array.isArray(beats) && beats.length > 0;
    if (hasStructure) {
        // The caller already decided the structure (an explicit tone/beat
        // list) — this is the original, narrower job: just write the words
        // for a sequence whose shape is already fixed.
        const asked = beats.join(', ');
        return [
            'You write on-screen text for motion graphics in a video. Short, concrete, no hype.',
            '',
            `The brief: "${brief}"`,
            tone ? `The tone: ${tone}.` : '',
            platform ? `It will be posted on ${platform}.` : '',
            transcript ? `What is said in the video (use it for the facts, do not quote it at length):\n"""${transcript}"""` : 'There is no transcript, so work from the brief alone.',
            '',
            `The sequence has these beats, in order: ${asked}.`,
            '',
            'Rules:',
            '- A title of 2 to 7 words. No full stop. Never a hashtag or an emoji.',
            '- Each point is 2 to 6 words, a benefit or a fact, each one different.',
            '- A call to action of 2 to 5 words, an instruction.',
            '- A stat beat needs a short value ("+184%", "3x", "12 min") and a label of 2 to 4 words.',
            '- Invent nothing that is not in the brief or the transcript. Leave a field out rather than guess.',
            '',
            ...techBlock,
            '',
            'Reply as JSON only:',
            '{"title":"...","points":["...","..."],"cta":"...","stat":{"value":"...","label":"..."}}',
        ].filter(Boolean).join('\n');
    }
    // R101 PHASE 1 — no structure was handed in: decide the tone AND the
    // ordered beat sequence together with the words, instead of only ever
    // filling in text for a shape SceneDirector's regex already fixed.
    return [
        'You are a motion-graphics director for short social videos. Decide the tone, the ordered sequence of on-screen beats, and write the words for them — all from the brief. Short, concrete, no hype.',
        '',
        `The brief: "${brief}"`,
        platform ? `It will be posted on ${platform}.` : '',
        transcript ? `What is said in the video (use it for the facts, do not quote it at length):\n"""${transcript}"""` : 'There is no transcript, so work from the brief alone.',
        '',
        `Pick ONE tone from: ${TONE_KEYS.join(', ')}.`,
        `Each beat has a "kind", one of: ${BEAT_KINDS.join(', ')}. Typical sequences open with "intro", use "point" for benefits, features or steps, "stat" for one figure worth a callout, "quote" for a testimonial, and close with "cta" when the brief implies a call to action.`,
        'Decide how many beats and which kinds actually fit the brief — do not force a shape it does not ask for.',
        '',
        'A beat MAY also suggest its own "motion" when the tone\'s usual treatment would undersell it (a standout number, the final call to action) — most beats should leave "motion" out and let the tone\'s own default carry them:',
        `  "enter" (required if "motion" is given): one of ${ENTER_VERBS.join(', ')}`,
        `  "emphasis" (optional): one of ${EMPHASIS_VERBS.join(', ')}, or omit it`,
        `  "exit" (optional): one of ${EXIT_VERBS.join(', ')}, or omit it`,
        '  "energy": 0 (subtle) to 1 (maximal), omit for a moderate default',
        '  "anticipate": true (optional) — the beat winds up against its own move just before it, which gives a punch or a whip-out weight. Leave it out for calm treatments, where it reads as a stutter.',
        '',
        'Rules:',
        '- At most 8 beats.',
        '- An "intro", "point" or "quote" beat\'s "text" is 2 to 7 words, a benefit or a fact. Number "point" beats with a two-digit "kicker" ("01", "02"...).',
        '- A "cta" beat\'s "text" is 2 to 5 words, an instruction.',
        '- A "stat" beat needs a short "value" ("+184%", "3x", "12 min") and a "label" of 2 to 4 words.',
        '- No full stops, hashtags or emoji anywhere.',
        '- Invent nothing that is not in the brief or the transcript. Leave a field, or a whole beat\'s "text", out rather than guess — an empty "text" is fine and becomes an editable placeholder.',
        '',
        ...techBlock,
        '',
        'Reply as JSON only:',
        '{"tone":"...","beats":[{"kind":"intro","text":"...","technique":"hook-slam-headline"},{"kind":"point","text":"...","kicker":"01"},{"kind":"cta","text":"...","motion":{"enter":"slam-in","emphasis":"punch","energy":0.8}}]}',
    ].filter(Boolean).join('\n');
}

/** Strip the things a model adds that on-screen text should never carry. */
function cleanLine(value, { maxWords, maxChars = 80 }) {
    // A model that answers with an object or a number is not giving us text:
    // String({}) is "[object Object]", which passes every filter below and
    // would be put on screen as if it were a headline.
    if (typeof value !== 'string') return '';
    let s = value.trim();
    if (!s) return '';
    // Order matters: strip the hashtags and emoji FIRST, then the wrapping
    // quotes, or a quote left behind by "...text" #tag stays on the end.
    s = s.replace(/#\w+/g, '');
    s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^["'“”«»\s]+|["'“”«»\s]+$/g, '');
    // On-screen text carries no trailing punctuation, and no "!!".
    s = s.replace(/[.,;:!?]+$/, '').trim();
    if (s.length < 2) return '';
    if (maxWords) s = s.split(' ').slice(0, maxWords).join(' ');
    return s.slice(0, maxChars).trim();
}

/**
 * Keep only what is usable. Returns null when there is nothing left, so the
 * client keeps its placeholders rather than showing a half-filled sequence.
 */
/**
 * One beat of an AI-decided sequence: {kind, text?, kicker?, value?, label?}.
 * Only `kind` is required — "invent nothing" means a beat the model left
 * wordless (no `text`) is kept as-is, not dropped, so SceneDirector still
 * shows it as an editable placeholder rather than silently losing a beat.
 */
/**
 * R101 — a beat's own motion suggestion, cleaned field by field: a missing
 * or unrecognised entrance means nothing usable here at all (there is no
 * sane beat with no way to arrive), but emphasis/exit are each independently
 * optional — a model that names a good entrance and nothing else still gets
 * that much, rather than the whole suggestion being discarded over one bad
 * field.
 */
function cleanMotion(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const enter = ENTER_VERBS.includes(raw.enter) ? raw.enter : null;
    if (!enter) return null;
    // `null` is kept as an explicit "no emphasis/exit at all" (the client's
    // cleanMotionOverride in SceneComposer.js treats that as deliberate).
    // Anything else invalid is left OUT of the object (not coerced to
    // `null`), so it round-trips through JSON as absent, not as an explicit
    // opt-out — the client then falls back to the look's own value for that
    // field, the same as if the model had never mentioned it.
    const emphasis = raw.emphasis === null ? null : (EMPHASIS_VERBS.includes(raw.emphasis) ? raw.emphasis : undefined);
    const exit = raw.exit === null ? null : (EXIT_VERBS.includes(raw.exit) ? raw.exit : undefined);
    const energy = Number.isFinite(Number(raw.energy)) ? Math.min(1, Math.max(0, Number(raw.energy))) : 0.6;
    // R103 round F — anticipation: a wind-up against the move, just before
    // it. Strictly boolean and defaulting to false, so a model that does not
    // mention it gets exactly today's motion.
    const anticipate = raw.anticipate === true;
    return { enter, emphasis, exit, energy, anticipate };
}

function cleanBeat(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = BEAT_KINDS.includes(raw.kind) ? raw.kind : null;
    if (!kind) return null;
    const text = cleanLine(raw.text, kind === 'cta' ? { maxWords: 5, maxChars: 40 } : { maxWords: 7, maxChars: 70 });
    const kicker = cleanLine(raw.kicker, { maxWords: 2, maxChars: 8 });
    const value = kind === 'stat' ? cleanLine(raw.value, { maxWords: 2, maxChars: 12 }) : '';
    const label = (kind === 'stat' || kind === 'quote') ? cleanLine(raw.label, { maxWords: 4, maxChars: 32 }) : '';
    const explicitMotion = cleanMotion(raw.motion);

    // R103 — a technique id the model picked from the knowledge-base shortlist.
    // Validated against the library, never trusted as a string: an unknown id
    // is dropped entirely rather than passed through, so a hallucinated name
    // leaves the beat with no motion and the look's own motion stands (the
    // same outcome as before techniques existed).
    //
    // An explicit `motion` object WINS over a technique when both are present.
    // That ordering is deliberate: the technique is the library's
    // recommendation, the motion object is the model overriding it for this
    // specific beat, and the more specific instruction should not be silently
    // discarded in favour of the generic one.
    const technique = typeof raw.technique === 'string' && techniqueByName(raw.technique)
        ? raw.technique
        : null;
    const motion = explicitMotion || (technique ? cleanMotion(motionForTechnique(technique)) : null);

    return {
        kind,
        ...(text ? { text } : {}),
        ...(kicker ? { kicker } : {}),
        ...(value ? { value } : {}),
        ...(label ? { label } : {}),
        ...(technique ? { technique } : {}),
        ...(motion ? { motion } : {}),
    };
}

function cleanScenePlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = cleanLine(raw.title, { maxWords: 7, maxChars: 70 });
    const cta = cleanLine(raw.cta, { maxWords: 5, maxChars: 40 });
    const points = (Array.isArray(raw.points) ? raw.points : [])
        .map(p => cleanLine(p, { maxWords: 6, maxChars: 48 }))
        .filter(Boolean)
        .filter((p, i, list) => list.indexOf(p) === i)
        .slice(0, 6);
    const statValue = cleanLine(raw.stat?.value, { maxWords: 2, maxChars: 12 });
    const statLabel = cleanLine(raw.stat?.label, { maxWords: 4, maxChars: 32 });
    const stat = statValue ? { value: statValue, label: statLabel || '' } : null;

    // R101 PHASE 1 — when the model also decided the structure: an ordered
    // beat list and a tone word, both validated against the same vocabulary
    // SceneDirector.js itself uses.
    const beats = Array.isArray(raw.beats) ? raw.beats.slice(0, 8).map(cleanBeat).filter(Boolean) : [];
    const toneRaw = typeof raw.tone === 'string' ? raw.tone.trim().toLowerCase() : '';
    const tone = TONE_KEYS.includes(toneRaw) ? toneRaw : '';

    // A single word is a label, not a title; two words is the floor.
    const usableTitle = title.split(' ').length >= 2 ? title : '';
    if (!usableTitle && points.length === 0 && !cta && !stat && beats.length === 0) return null;
    return {
        title: usableTitle,
        points,
        cta,
        ...(stat ? { stat } : {}),
        ...(beats.length ? { beats } : {}),
        ...(tone ? { tone } : {}),
    };
}

router.post('/short-plan', authenticateUser, async (req, res) => {
    // Rate limiter: mounted under aiLimiter in index.js (LLM call).
    const { text, platform, duration } = req.body || {};
    const cleanText = String(text || '').trim().slice(0, 2000);
    if (!cleanText) return res.status(400).json({ error: 'text is required' });
    const plat = ['tiktok', 'reels', 'shorts'].includes(platform) ? platform : 'tiktok';
    const label = { tiktok: 'TikTok', reels: 'Instagram Reels', shorts: 'YouTube Shorts' }[plat];
    if (!isAIConfigured()) return res.json({ source: 'rules', plan: null });
    try {
        const ai = getAIClient({ timeout: 30_000 });
        const completion = await ai.chat.completions.create({
            model: resolveModel('gpt-4o', 'chat'),
            messages: [{ role: 'user', content: buildShortPlanPrompt({ text: cleanText, platform: label, duration: Number(duration) || 30 }) }],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 400,
        });
        const raw = completion?.choices?.[0]?.message?.content;
        const plan = raw ? cleanShortPlan(JSON.parse(raw)) : null;
        return res.json({ source: plan ? 'llm' : 'rules', plan });
    } catch (err) {
        console.warn('[motionRoutes /short-plan] LLM failed, client uses rules:', err.message);
        return res.json({ source: 'rules', plan: null });
    }
});

router.post('/scene-plan', authenticateUser, async (req, res) => {
    // Rate limiter: mounted under aiLimiter in index.js (LLM call).
    const { brief, transcript, beats, tone, platform } = req.body || {};
    const cleanBrief = String(brief || '').trim().slice(0, 600);
    if (!cleanBrief) return res.status(400).json({ error: 'brief is required' });
    const cleanTranscript = String(transcript || '').trim().slice(0, 3000);
    const beatList = (Array.isArray(beats) ? beats : []).map(b => String(b || '').slice(0, 20)).filter(Boolean).slice(0, 8);

    const cleanTone = tone ? String(tone).slice(0, 40) : '';
    const cleanPlatform = platform ? String(platform).slice(0, 40) : '';

    // R103 — retrieve the knowledge-base shortlist for this brief before the
    // model is asked anything, and hand it to the prompt builder through a
    // closure rather than widening generateScenePlan's signature. The provider
    // calls `buildPrompt({ brief, transcript, beats, tone, platform })` and
    // knows nothing about techniques, which is exactly the point: the KB is a
    // prompt-time input, not a new contract between route and provider.
    //
    // The query is the brief plus the transcript's opening, because the brief
    // from Pro Finish is deliberately generic ("open strong, surface the key
    // point") — the transcript is where the words that should drive retrieval
    // actually live.
    const retrievalQuery = `${cleanBrief} ${cleanTranscript.slice(0, 400)}`.trim();
    let techniques = [];
    try {
        // shortlistForPlan, not findTechniques: the model has not chosen its
        // beats yet, so the shortlist has to cover the kinds it might choose
        // rather than only the best matches for the brief's wording.
        techniques = shortlistForPlan(retrievalQuery, {
            tone: cleanTone,
            platform: cleanPlatform,
            coverBeatKinds: beatList.length > 0 ? beatList : undefined,
            limit: 8,
        });
    } catch (err) {
        // Retrieval is a local, pure scoring pass, so this should not happen —
        // but a KB failure must never cost the caller its scene plan.
        console.warn('[motionRoutes /scene-plan] technique retrieval failed, continuing without a shortlist:', err.message);
        techniques = [];
    }

    try {
        const result = await generateScenePlan({
            brief: cleanBrief,
            transcript: cleanTranscript,
            beats: beatList,
            tone: cleanTone,
            platform: cleanPlatform,
            buildPrompt: (args) => buildScenePlanPrompt({ ...args, techniques }),
            cleanPlan: cleanScenePlan,
        });
        return res.json({
            source: result.source,
            plan: result.plan,
            // What the KB offered, so the client (and the tests) can see the
            // library was consulted even when the model ignored it.
            techniques: techniques.map(t => t.technique.name),
            // R104b — WHY there is no plan. The three rules-fallback paths are
            // completely different problems with identical output: the
            // provider is deliberately set to "rules", the provider is set to
            // a real model but has no credentials, or the model was called and
            // failed. Only the operator can act on the difference, and until
            // now that difference existed only in a server telemetry line.
            // No credentials, keys or prompts are included — just the category
            // and the provider name the operator configured.
            ...(result.plan ? {} : {
                failureCategory: result.failureCategory || 'unknown',
                provider: result.provider || null,
            }),
        });
    } catch (err) {
        console.warn('[motionRoutes /scene-plan] generation failed, falling back to rules:', err.message);
        return res.json({
            source: 'rules',
            plan: null,
            techniques: techniques.map(t => t.technique.name),
            failureCategory: 'route_error',
            provider: null,
        });
    }
});

/**
 * POST /api/motion/techniques
 *
 * Rank the Motion Design Knowledge Base for a request. Read-only, no model
 * call, no database — this is the KB's own entry point, used by the tests and
 * available to the Motion panel for "what would suit this beat" without
 * spending a scene-plan generation to find out.
 *
 * Body: { query, tone?, platform?, beatKind?, eventType?, intents?, emotions?, energy?, limit? }
 *
 * TODO: apply apiLimiter — pure CPU and bounded (the library is 34 rows and
 * scoring is linear over it), so it is far cheaper than the aiLimiter-mounted
 * routes above, but it should still not be unbounded.
 */
router.post('/techniques', authenticateUser, async (req, res) => {
    const { query, tone, platform, beatKind, eventType, intents, emotions, energy, limit } = req.body || {};
    const cleanQuery = String(query || '').trim().slice(0, 600);
    if (!cleanQuery) return res.status(400).json({ error: 'query is required' });

    try {
        const ranked = findTechniques(cleanQuery, {
            tone: tone ? String(tone).slice(0, 40) : '',
            platform: platform ? String(platform).slice(0, 40) : '',
            beatKind: beatKind ? String(beatKind).slice(0, 20) : '',
            eventType: eventType ? String(eventType).slice(0, 40) : '',
            intents: Array.isArray(intents) ? intents.slice(0, 12).map(i => String(i).slice(0, 40)) : [],
            emotions: Array.isArray(emotions) ? emotions.slice(0, 12).map(e => String(e).slice(0, 40)) : [],
            energy: Number.isFinite(Number(energy)) ? Number(energy) : undefined,
            limit: Number.isFinite(Number(limit)) ? Number(limit) : 6,
        });
        return res.json({
            techniques: ranked.map(({ technique, score, reasons }) => ({
                name: technique.name,
                displayName: technique.displayName,
                description: technique.description,
                note: technique.note,
                motion: technique.motion,
                mood: technique.mood,
                component: technique.component || null,
                preset: technique.preset || null,
                stagger: technique.stagger,
                beatKinds: technique.beatKinds,
                energyLevel: technique.energyLevel,
                score,
                reasons,
            })),
        });
    } catch (err) {
        console.error('[motionRoutes /techniques] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.buildShortPlanPrompt = buildShortPlanPrompt;
module.exports.cleanShortPlan = cleanShortPlan;
module.exports.buildScenePlanPrompt = buildScenePlanPrompt;
module.exports.cleanScenePlan = cleanScenePlan;
module.exports.buildMotionPrompt = buildMotionPrompt;
module.exports.cleanLayers = cleanLayers;
module.exports.loadComposer = loadComposer;
