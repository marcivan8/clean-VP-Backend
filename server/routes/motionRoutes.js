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

You may also add raw "animations" when no verb fits: {"startTime": s, "anchor": "in"|"out", "easing": name, "keyframes": [{"time": s from the animation start, "properties": {...}, "easing": optional}]}.
Animatable properties: x and y (offset in % of the frame, -120..120), scale (multiplier, 0..6), rotation (degrees), opacity (0..1), blur (px, 0..60), glow (px, 0..60), reveal (0..1, text type-on).
Easings: linear, easeOutCubic, easeInOutSine, easeOutExpo, easeInExpo, backOut, backIn, spring, springGentle, springWobbly, springStiff, springSnappy, springSlow, "cubic-bezier(a,b,c,d)", "spring(stiffness,damping)", "steps(n)".

Design rules:
- Every layer gets ONE entrance at 0, and an exit unless it is shorter than 1 s.
- Emphasis beats land on meaning (the key word, a number), not at random.
- Vary the motion between layers so the edit does not feel templated, but keep one visual language.
- Respect the brief's energy. "subtle" or "elegant" means small values and sine or gentle springs; "punchy" means fast entrances, springSnappy and overshoot.
- Keep everything inside each layer's duration.

Reply with JSON only: {"layers": {"<layer id>": {"beats": [...], "animations": [...]}}, "notes": "one short sentence on the motion idea"}`;
}

router.post('/compose', authenticateUser, async (req, res) => {
    // Rate limiter: mounted under aiLimiter in index.js (LLM call).
    const { brief, layers, editingStyle } = req.body || {};
    const cleanBrief = String(brief || '').trim().slice(0, MAX_BRIEF);
    const list = cleanLayers(layers);
    if (list.length === 0) return res.status(400).json({ error: 'layers is required (at least one {id, kind, duration})' });

    try {
        const composer = await loadComposer();
        const style = sanitizeEditingStyle(editingStyle);
        const fallbackFor = l => composer.planMotionFromBrief(cleanBrief || 'animate it', { duration: l.duration });
        const rulesScripts = () => Object.fromEntries(list.map(l => [l.id, fallbackFor(l)]));

        if (!isAIConfigured() || !cleanBrief) {
            return res.json({ source: 'rules', layers: rulesScripts(), notes: null });
        }

        let parsed = null;
        try {
            const ai = getAIClient({ timeout: 45_000 });
            const completion = await ai.chat.completions.create({
                model: resolveModel('gpt-4o', 'chat'),
                messages: [{ role: 'user', content: buildMotionPrompt({ brief: cleanBrief, layers: list, catalog: composer.verbCatalog(), editingStyle: style }) }],
                response_format: { type: 'json_object' },
                temperature: 0.6,
                max_tokens: 2500,
            });
            const raw = completion?.choices?.[0]?.message?.content;
            parsed = raw ? JSON.parse(raw) : null;
        } catch (aiErr) {
            console.warn('[motionRoutes /compose] LLM failed, using rules:', aiErr.message);
        }

        const out = {};
        let usedLLM = 0;
        for (const l of list) {
            const script = parsed?.layers?.[l.id];
            const kind = l.kind === 'caption' ? 'caption' : l.kind;
            const check = script ? composer.composeMotion(script, { duration: l.duration, kind }) : null;
            if (check && check.animations.length > 0) {
                out[l.id] = { beats: script.beats || [], animations: script.animations || [] };
                usedLLM += 1;
            } else {
                out[l.id] = fallbackFor(l);
            }
        }
        return res.json({
            source: usedLLM === list.length ? 'llm' : usedLLM > 0 ? 'mixed' : 'rules',
            layers: out,
            notes: typeof parsed?.notes === 'string' ? parsed.notes.slice(0, 200) : null,
        });
    } catch (err) {
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

module.exports = router;
module.exports.buildShortPlanPrompt = buildShortPlanPrompt;
module.exports.cleanShortPlan = cleanShortPlan;
module.exports.buildMotionPrompt = buildMotionPrompt;
module.exports.cleanLayers = cleanLayers;
module.exports.loadComposer = loadComposer;
