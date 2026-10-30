/**
 * client/src/agent/CommandRegistry.js
 *
 * SINGLE SOURCE OF TRUTH for what the assistant can do.
 *
 * WHY THIS EXISTS
 * ---------------
 * Adding a command used to mean editing five files (EXT1 in CLAUDE.md):
 * IntentParser, FallbackParser, EditPlanner, CommandCompiler, VideoEditorTools.
 * Vocabulary lived in several hand-maintained keyword lists with no way to see
 * overlaps between them — which is how `'crop'` ended up registered as a synonym
 * for trim/shorten. Typing "crop the speaker to 200%" matched that list and ran
 * SILENCE REMOVAL: not a model hallucination, a vocabulary collision plus a
 * missing command (no spatial crop existed at all).
 *
 * Every command is declared ONCE here. Parsers score against `phrases`,
 * `negative` blocks a match outright, and `findCollisions()` makes overlapping
 * vocabulary a detectable error instead of a silent mis-route.
 *
 * ATOMIC BY DEFAULT
 * -----------------
 * Commands do ONE thing so they can be chained and re-run individually.
 * Multi-stage flows are declared as `macro: [ ...ids ]` — a macro is only ever
 * sugar for running atomic steps in order, never a hidden fourth behaviour.
 *
 * ADDING A COMMAND
 *   1. Add an entry here (id, phrases, params, category)
 *   2. Implement the case in MediaExecutionEngine (or point `store` at an
 *      existing store action)
 *   3. Run `node scripts/test_command_registry.js` — it fails on collisions
 *      and on entries with no executor.
 */

/** @typedef {'edit'|'analysis'|'transform'|'audio'|'text'|'asset'|'timeline'|'export'|'macro'} CommandCategory */

/**
 * Param types the parser knows how to extract from free text.
 *  percent  — "200%", "to 150 percent"        → number (1.0 = 100%)
 *  seconds  — "3s", "2.5 seconds"             → number
 *  speaker  — "speaker 00", "the woman"       → string
 *  target   — "this clip", "all clips"        → 'clip'|'all'|'selection'
 *  text     — free text remainder
 *  enum     — one of `values`
 */

export const COMMANDS = [
    // ── Cleanup / cutting ────────────────────────────────────────────────────
    {
        id: 'silence_removal',
        category: 'edit',
        label: 'Remove silences',
        summary: 'Cuts dead air between words, keeping intentional pauses.',
        // NOTE: 'crop' deliberately NOT here — it means a spatial crop (see crop_clip).
        phrases: ['remove silence', 'remove silences', 'cut silence', 'cut the silence',
                  'remove dead air', 'trim silence', 'tighten the pauses', 'clean up the pauses',
                  'remove pauses', 'cut dead air', 'tighten up'],
        negative: ['crop', 'zoom', 'angle', 'filler'],
        destructive: true,
        requires: ['transcript'],
    },
    {
        id: 'remove_filler_words',
        category: 'edit',
        label: 'Remove filler words',
        summary: 'Cuts ums, uhs and hesitations.',
        phrases: ['remove filler', 'remove fillers', 'remove filler words', 'cut the ums',
                  'remove ums', 'remove uhs', 'cut filler', 'clean up my delivery'],
        negative: ['silence', 'crop', 'zoom'],
        destructive: true,
        requires: ['transcript'],
    },
    {
        id: 'remove_repetition',
        category: 'edit',
        label: 'Remove repetition',
        summary: 'Cuts repeated takes and restated points.',
        phrases: ['remove repetition', 'remove repeated', 'cut repeated takes',
                  'remove duplicate takes', 'cut the repeats', 'remove redundant',
                  // R92: plural and everyday phrasings used to miss the registry
                  'remove repetitions', 'remove the repetitions', 'cut repetitions', 'cut the repetitions',
                  'remove repeats', 'remove the repeats', 'remove retakes', 'cut the retakes', 'remove false starts',
                  'clean up repetition', 'clean up repetitions', 'remove what i repeated', 'remove repeated parts',
                  'supprime les repetitions', 'enleve les repetitions', 'coupe les repetitions',
                  // Single word & everyday shorthand
                  'repetition', 'repetitions', 'cut repetition',
                  // French infinitives and variants (accents are folded by scoreCommand)
                  'supprimer les repetitions', 'enlever les repetitions', 'couper les repetitions', 'retirer les repetitions',
                  'supprimer repetitions', 'enlever repetitions', 'couper repetitions', 'retirer repetitions',
                  'retire les repetitions', 'retire repetitions',
                  'supprime repetition', 'enleve repetition', 'coupe repetition',
                  'coupe les retakes', 'supprime les retakes', 'enleve les retakes',
                  'repeated takes', 'retakes', 'false starts'],
        destructive: true,
        requires: ['transcript'],
    },

    // ── Spatial transform (the family that was missing entirely) ─────────────
    {
        id: 'crop_clip',
        executes: 'crop_clip',
        category: 'transform',
        label: 'Crop / punch in',
        summary: 'Crops the frame in (spatially) on a clip, speaker or the whole timeline.',
        // The literal request that used to mis-route into silence removal.
        phrases: ['crop', 'crop to', 'punch in', 'punch in on', 'zoom in on', 'crop in on',
                  'crop the frame', 'reframe', 'blow up the shot', 'tighten the framing'],
        negative: ['silence', 'dead air', 'filler'],
        params: [
            { name: 'amount',  type: 'percent', default: 1.5, description: 'Crop strength — 200% = 2× punch in' },
            { name: 'speaker', type: 'speaker', optional: true, description: 'Only clips where this speaker talks' },
            { name: 'target',  type: 'target',  default: 'all', description: 'clip | all | selection' },
        ],
        destructive: false,
    },
    {
        id: 'reset_crop',
        executes: 'reset_crop',
        category: 'transform',
        label: 'Reset framing',
        summary: 'Clears any crop/zoom back to the full frame.',
        phrases: ['reset crop', 'remove crop', 'clear the crop', 'back to full frame',
                  'reset framing', 'undo the zoom', 'remove the zoom'],
        destructive: false,
    },

    // ── Multicam, decomposed into atomic stages ─────────────────────────────
    {
        id: 'detect_speakers',
        executes: 'detect_speakers',
        category: 'analysis',
        label: 'Detect speakers',
        summary: 'Runs diarization and stores who speaks when. Changes nothing on the timeline.',
        phrases: ['detect speakers', 'who is speaking', 'identify speakers', 'run diarization',
                  'find the speakers', 'analyze speakers'],
        destructive: false,
    },
    {
        id: 'detect_scene',
        executes: 'detect_scene',
        category: 'analysis',
        label: 'Analyse framing',
        summary: 'Vision pass: where faces are, how many people are on camera. Changes nothing.',
        phrases: ['analyze the shot', 'analyse the shot', 'detect faces', 'check the framing',
                  'analyze the framing', 'what is in the shot'],
        destructive: false,
    },
    {
        id: 'split_by_speaker',
        executes: 'split_speakers',
        category: 'edit',
        label: 'Split at speaker turns',
        summary: 'Cuts clips at speaker changes. No angles applied.',
        phrases: ['split by speaker', 'split at speaker changes', 'cut at speaker turns',
                  'split speakers', 'separate the speakers'],
        destructive: true,
        requires: ['diarization'],
    },
    {
        id: 'apply_angle',
        executes: 'apply_angle',
        category: 'transform',
        label: 'Apply camera angles',
        summary: 'Assigns wide/mid/close (or per-speaker) framing to existing clips.',
        phrases: ['apply angles', 'apply camera angles', 'add camera angles', 'assign angles',
                  'set the angles', 'interview angles'],
        params: [
            { name: 'mode', type: 'enum', values: ['auto', 'solo', 'duo'], default: 'auto' },
        ],
        destructive: false,
        requires: ['diarization'],
    },

    // ── Motion ───────────────────────────────────────────────────────────────
    {
        id: 'rhythm_zoom',
        category: 'transform',
        label: 'Add zoom rhythm',
        summary: 'Push-ins and punch-ins timed to emphasised words.',
        phrases: ['make it more dynamic', 'add dynamic zoom', 'zoom rhythm', 'add movement',
                  'make it punchy', 'add energy', 'dynamic zooms'],
        destructive: false,
        requires: ['transcript'],
    },

    // ── AI Animation Intelligence (R68) ─────────────────────────────────────
    // "Brain chooses animations. Users don't." — one explicit command runs
    // detection (TimelineEventDetector.js) + resolution (AnimationKnowledgeGraph.js)
    // + application (MediaExecutionEngine.js `animate_automatically`) as one
    // undoable pass. Deliberately NOT automatic on upload — see CLAUDE.md R68.
    {
        id: 'animate_automatically',
        executes: 'animate_automatically',
        category: 'transform',
        label: 'Animate automatically',
        summary: 'Detects reveal/punchline/emphasis/emotional-beat moments and applies animations + SFX — no manual picks.',
        phrases: ['animate this automatically', 'animate automatically', 'auto animate',
                  'animate this for me', 'add animations automatically', 'automatically animate this',
                  'add motion graphics', 'add animations and motion graphics', 'add some motion graphics',
                  'graphic motion', 'graphic motions', 'advanced graphic motion', 'advanced graphic motions',
                  'advanced motion graphics', 'advanced animations', 'advanced animation', 'advanced motion',
                  'animate the interesting parts', 'animate the best moments', 'animate the highlights',
                  'bring it to life', 'bring this to life', 'make it come alive',
                  'illustrate this', 'illustrate the video', 'add some animation', 'add animation',
                  'animate', 'animate it', 'animate my video', 'add animations', 'add some animations',
                  // French (the tokenizer drops accents, so phrases avoid them)
                  'anime', 'anime la', 'animer', 'ajoute des animations', 'ajouter des animations',
                  'mets des animations', 'rajoute des animations', 'ajoute de l animation'],
        // R123: 'illustrate this'/'illustrate the video' are legitimate
        // animate_automatically phrasing on their own, but when the request is
        // actually about b-roll/stock footage ("illustrate this with b-roll"),
        // that sentence used to be hijacked here before b-roll placement ever
        // got a chance to match — nothing got placed, because this command only
        // animates existing clips. Veto on those terms so the b-roll-specific
        // phrasing in sync_cutaways (below) wins instead.
        negative: ['crop', 'silence', 'filler', 'roll', 'broll', 'footage', 'stock', 'cutaway', 'cutaways'],
        destructive: false,
    },

    // ── R92: motion written by the AI (motion/MotionComposer.js) ───────────
    // "animate the title so it slams in", "elegant animation on the text".
    // The plain "animate it" stays animate_automatically: every phrase here
    // needs a target word or a named motion.
    {
        id: 'compose_motion',
        category: 'transform',
        label: 'Design the motion',
        summary: 'Writes custom motion for titles, captions and graphics from a description (slam in, float, glitch, elegant…).',
        phrases: ['animate title', 'animate titles', 'animate text', 'animate captions', 'animate subtitles',
                  'animate selected', 'animate selection', 'animate sticker', 'animate stickers', 'animate logo',
                  'animate graphics', 'custom animation', 'custom motion', 'design motion', 'motion design',
                  'text animation', 'title animation', 'caption animation',
                  'slam in', 'slams in', 'pop in', 'pops in', 'slide in', 'slides in', 'drop in', 'drops in',
                  'whip in', 'swing in', 'spin in', 'blur in', 'glitch in', 'fly out', 'flies out', 'shrink out',
                  'sink out', 'whip out', 'typewriter', 'typing effect', 'type writer', 'title fade', 'text fade',
                  'text bounce', 'title bounce', 'text shake', 'title shake', 'text float', 'title float',
                  'elegant animation', 'cinematic animation', 'punchy animation', 'smooth animation',
                  'playful animation', 'glitch animation', 'subtle animation',
                  'anime le titre', 'anime le texte', 'anime les sous titres', 'animation du titre', 'animation du texte'],
        negative: ['crop', 'silence', 'filler', 'remove', 'clear', 'enleve', 'supprime', 'transition'],
        destructive: false,
    },

    // ── R92: free background removal (vision/MatteBaker.js) ────────────────
    {
        id: 'remove_background',
        category: 'transform',
        label: 'Remove the background',
        summary: 'Blurs, darkens or replaces the background behind the person, with a free on-device model.',
        phrases: ['remove the background', 'remove background', 'blur the background', 'blur background',
                  'background blur', 'replace the background', 'change the background', 'green screen',
                  'background removal', 'cut out the background', 'dim the background', 'darken the background',
                  'black background', 'white background', 'background color', 'background colour',
                  'rack focus', 'rack focus background', 'focus pull', 'reveal background', 'spotlight background',
                  'enleve le fond', 'supprime le fond', 'floute le fond', 'flou d arriere plan', 'change le fond',
                  'remplace le fond', 'fond noir', 'fond flou'],
        // "remove the background music / noise" is audio, not the picture.
        negative: ['music', 'noise', 'audio', 'sound', 'hum', 'musique', 'bruit', 'son'],
        destructive: false,
    },
    {
        id: 'sandwich_text',
        category: 'transform',
        label: 'Place text behind speaker',
        summary: 'Sandwiches animated text or titles behind the speaker in a depth layer.',
        phrases: ['put text behind speaker', 'text behind speaker', 'sandwich text', 'sandwich layer',
                  'put text behind me', 'title behind speaker', 'words behind speaker', 'text behind subject',
                  'texte derriere la personne', 'titre derriere moi'],
        destructive: false,
    },
    {
        id: 'zoom_speaker',
        category: 'transform',
        label: 'Zoom to the speaker',
        summary: 'Frames the person with one steady crop (finds them with the free background model).',
        phrases: ['zoom to the speaker', 'zoom on the speaker', 'zoom into the speaker', 'frame the speaker',
                  'crop to the speaker', 'centre the speaker', 'center the speaker', 'cadre sur la personne'],
        destructive: false,
    },
    {
        id: 'track_speaker',
        category: 'transform',
        label: 'Track the speaker',
        summary: 'Keeps the person framed as they move, re-centring the crop when they drift.',
        phrases: ['track the speaker', 'follow the speaker', 'keep the speaker centered', 'keep the speaker centred',
                  'speaker tracking', 'suis la personne', 'suivre la personne'],
        destructive: false,
    },

    // ── Text / captions ──────────────────────────────────────────────────────
    {
        id: 'auto_captions',
        category: 'text',
        label: 'Add captions',
        summary: 'Transcribes and adds word-timed captions.',
        phrases: ['add captions', 'add subtitles', 'caption this', 'generate captions',
                  'burn in captions', 'transcribe'],
        destructive: false,
    },
    {
        // R88 (to-do A2) — keyword emphasis. Free JS rules first, LLM only for
        // the captions the rules cannot settle (utils/captionEmphasis.js).
        id: 'emphasize_keywords',
        category: 'text',
        label: 'Highlight key words',
        summary: 'Picks the key word of each caption and emphasises it in the caption style.',
        phrases: ['highlight key words', 'highlight the key words', 'highlight keywords', 'emphasize key words',
                  'emphasise key words', 'emphasize keywords', 'emphasise keywords', 'highlight important words',
                  'make the key words pop', 'color the key words', 'colour the key words',
                  'mets en valeur les mots cles', 'mettre en valeur les mots cles', 'surligne les mots cles',
                  'mots cles en couleur', 'mets les mots cles en avant'],
        negative: ['remove', 'clear', 'enleve', 'retire', 'supprime'],
        destructive: false,
    },
    {
        id: 'clear_keywords',
        category: 'text',
        label: 'Remove key word highlights',
        summary: 'Removes keyword emphasis from every caption.',
        phrases: ['remove key word highlights', 'remove keyword highlights', 'clear key words', 'clear keywords',
                  'remove the key word highlights', 'stop highlighting key words',
                  'enleve les mots cles', 'retire les mots cles', 'supprime les mots cles'],
        destructive: false,
    },
    {
        // R88 (to-do A1) — layout presets for the overlay clip under the
        // playhead (or the selected one). Geometry: motion/LayoutPresets.js.
        id: 'layout_split_screen',
        category: 'transform',
        label: 'Split screen',
        summary: 'Speaker in the top half, the b-roll or screen recording in the bottom half.',
        phrases: ['split screen', 'split the screen', 'split screen layout', 'speaker on top', 'face on top',
                  'ecran partage', 'ecran scinde', 'coupe l ecran en deux'],
        negative: ['remove', 'undo', 'enleve', 'retire'],
        destructive: false,
    },
    {
        id: 'layout_picture_in_picture',
        category: 'transform',
        label: 'Picture in picture',
        summary: 'Puts the b-roll small in a corner over the speaker.',
        phrases: ['picture in picture', 'pip', 'in a corner', 'small in the corner', 'incrustation', 'dans un coin'],
        negative: ['remove', 'undo', 'enleve', 'retire'],
        destructive: false,
    },
    {
        id: 'layout_fullscreen',
        category: 'transform',
        label: 'Full-screen cutaway',
        summary: 'Makes the b-roll cover the whole frame.',
        // No hyphens: the matcher tokenizes "b-roll" as "b" + "roll".
        phrases: ['full screen b roll', 'full screen broll', 'fullscreen b roll', 'make the b roll full screen',
                  'full screen cutaway', 'b roll plein ecran', 'broll plein ecran', 'mets le b roll en plein ecran'],
        negative: ['remove', 'undo', 'enleve', 'retire'],
        destructive: false,
    },
    {
        // R90 (to-do A6) — b-roll on the exact word it illustrates, number pops on spoken numbers.
        id: 'sync_cutaways',
        category: 'edit',
        label: 'Sync cutaways to the words',
        summary: 'Places b-roll on the words it illustrates and number pops on spoken prices and figures.',
        phrases: ['sync the b roll', 'sync b roll to the words', 'cutaways on the words', 'place b roll on the words',
                  'beat sync', 'add number pops', 'pop the numbers', 'show the prices', 'b roll on key moments',
                  // R123: natural "illustrate ... with b-roll/footage/stock" phrasing, plus
                  // bare "insert/add b-roll or stock footage" requests that previously matched
                  // nothing in either the registry or IntentParser's NLP_MAP.
                  'illustrate this with b roll', 'illustrate the video with b roll', 'illustrate it with b roll',
                  'illustrate this with footage', 'illustrate the video with footage',
                  'illustrate this with stock footage', 'illustrate the video with stock footage',
                  'illustrate this with cutaways', 'illustrate with b roll', 'illustrate with footage',
                  'illustrate with stock footage', 'add stock footage', 'add some stock footage',
                  'insert b roll', 'insert some b roll', 'insert stock footage', 'add stock b roll',
                  'add b roll footage', 'add footage to illustrate', 'add footage to match the dialogue',
                  'synchronise les plans de coupe', 'plans de coupe sur les mots', 'affiche les prix', 'affiche les chiffres'],
        negative: ['remove', 'clear', 'enleve', 'retire', 'supprime'],
        destructive: false,
    },
    {
        // R92 round C: the pro short finish on the main edit (agent/shortPolish.js).
        id: 'polish_short',
        category: 'transform',
        label: 'Pro short finish',
        summary: 'AI hook title with motion, platform captions with key words, camera punch-ins, number pops, transitions and sound effects.',
        phrases: ['pro finish', 'finish it like a pro', 'make it look pro', 'make it look professional', 'polish the short',
                  'finish the short', 'add a hook title', 'hook title', 'add a hook on screen', 'make it viral', 'make it pop',
                  'finish it for tiktok', 'finish it for reels', 'finish it for shorts',
                  // R96: "pro grade", not just "look pro" — a near-miss on the
                  // old wording (Marc's "make it pro grade looking" matched
                  // NOTHING, so the whole multi-layer finish lost to a single
                  // unrelated "add captions" match on the rest of the sentence).
                  'pro grade', 'pro grade looking', 'make it pro grade', 'make it pro grade looking',
                  'professional looking', 'professional grade', 'looking pro',
                  'finition pro', 'rends le pro', 'ajoute un titre accrocheur', 'titre d accroche'],
        negative: ['remove', 'supprime', 'enleve'],
        destructive: false,
    },
    {
        // R92 round B: several shorts, one per platform, main edit untouched (Shorts tab).
        id: 'repurpose_shorts',
        category: 'edit',
        label: 'Repurpose into shorts',
        summary: 'Finds the strongest moments and makes several shorts -- more for a longer video -- across platforms (TikTok, Reels, YouTube Shorts) without changing the main edit.',
        phrases: ['repurpose into shorts', 'repurpose this video', 'repurpose the video', 'repurpose it', 'repurpose for social',
                  'repurpose for socials', 'repurpose into short videos', 'repurpose into short videos for socials',
                  'repurpose long video into short videos for socials', 'repurpose a long video into short videos for socials',
                  'repurpose long video into short videos', 'repurpose long video into shorts', 'repurpose long video',
                  'repurposing of a long video into short videos for socials', 'repurposing into shorts',
                  'make shorts', 'make some shorts', 'make 3 shorts', 'make three shorts', 'turn it into shorts', 'turn this into shorts',
                  'cut it into shorts', 'cut long video into shorts', 'turn long video into shorts',
                  'find the best clips', 'find shorts', 'clips for tiktok', 'shorts for tiktok', 'shorts for socials', 'short videos for socials',
                  'create shorts for socials', 'generate shorts for socials',
                  'for tiktok reels and shorts', 'tiktok reels and shorts', 'one for each platform',
                  'fais des shorts', 'decoupe en shorts', 'transforme en shorts', 'recycle la video',
                  'i want shorts', 'i want some shorts', 'i want reels', 'i want some reels',
                  'i want several shorts', 'i want a few shorts', 'give me shorts', 'give me reels'],
        negative: ['caption', 'sous titre', 'remove', 'supprime'],
        destructive: false,
    },
    {
        // R91 — Reel style: keep the strongest 15-60 s of a longer talk (agent/shortPicker.js).
        id: 'extract_short',
        category: 'edit',
        label: 'Extract a short',
        summary: 'Keeps the strongest 15-60 s of the talk, starting on a hook, and cuts the rest.',
        phrases: ['extract a short', 'make a short', 'make it a short', 'cut a short', 'turn it into a short',
                  'turn this into a reel', 'make a reel', 'best moment for a reel', 'best moment for a short',
                  'repurpose into a short', 'repurpose it as a short', 'fais un short', 'extrais un short',
                  'fais un reel', 'meilleur moment pour un short',
                  'i want a reel', 'i want a short', 'i want a reel video', 'i want a short video',
                  'give me a reel', 'give me a short', 'i need a reel', 'i need a short'],
        destructive: true,
        requires: ['transcript'],
    },
    {
        // R90 (to-do A7) — style recipes (motion/StyleRecipes.js).
        id: 'apply_style_recipe',
        category: 'macro',
        label: 'Apply a style recipe',
        summary: 'Applies a bundled style: captions, key words, transitions, zoom rhythm and automatic placements.',
        phrases: ['style recipe', 'apply the recipe', 'punchy style', 'punchy creator', 'travel vlog style', 'explainer style',
                  'podcast style', 'make it look like a travel vlog', 'make it an explainer',
                  'make it a podcast clip', 'recette de style', 'style vlog voyage', 'style podcast', 'style tutoriel', 'style percutant'],
        destructive: false,
    },
    {
        // R89 (to-do A5) — animated templates (motion/TemplateGraphics.js).
        id: 'add_template',
        category: 'text',
        label: 'Add an animated template',
        summary: 'Adds a flip counter, a number/price pop, a logo card or a code window at the playhead.',
        phrases: ['add a counter', 'day counter', 'flip counter', 'add a price pop', 'price pop', 'number pop',
                  'pop the price', 'add a code window', 'code window', 'typing code', 'add a logo card', 'logo card',
                  'ajoute un compteur', 'compteur de jours', 'fenetre de code', 'carte logo', 'prix anime',
                  // R92: vector shapes
                  'add a bar chart', 'bar chart', 'add a chart', 'add a graph', 'add an arrow', 'draw an arrow',
                  'add a progress bar', 'progress bar', 'circle callout', 'circle it', 'draw a circle',
                  'highlight box', 'box around', 'add an underline', 'underline it', 'add a burst',
                  'ajoute un graphique', 'ajoute une fleche', 'barre de progression', 'entoure'],
        negative: ['remove', 'clear', 'enleve', 'retire', 'supprime'],
        destructive: false,
    },
    {
        // R95 PHASE 4 — the director: a brief becomes a whole designed
        // sequence (intro, points, stat, call to action) rather than one
        // graphic. See motion/SceneDirector.js.
        id: 'design_scene',
        category: 'text',
        label: 'Design a graphics sequence',
        summary: 'Reads a brief for its tone and beats, then designs the titles, points and call to action as one editable sequence.',
        phrases: ['design a scene', 'design the graphics', 'design a sequence', 'design the titles',
                  'make a title sequence', 'build a title sequence', 'design a product reveal',
                  'make it feel like', 'make this feel like', 'introduce the product',
                  'graphics sequence', 'motion graphics sequence', 'design an intro sequence',
                  'three benefits', 'highlight three benefits', 'with a call to action',
                  'cree une sequence', 'design une sequence', 'fais une sequence de titres'],
        negative: ['remove', 'clear', 'enleve', 'retire', 'supprime', 'caption', 'sous titre'],
        destructive: false,
    },
    {
        id: 'set_brand_kit',
        category: 'text',
        label: 'Set the brand colours and fonts',
        summary: 'Stores a brand kit — accent colour, text colour, fonts — that every new graphic takes automatically.',
        phrases: ['set my brand colour', 'set my brand color', 'use my brand colours', 'use my brand colors',
                  'my brand is', 'brand kit', 'set the brand', 'change the accent colour', 'change the accent color',
                  'make the graphics match my brand', 'use my channel colours', 'use my channel colors',
                  'definis ma couleur de marque', 'utilise mes couleurs', 'ma marque est',
                  'change la couleur d accent', 'applique ma charte'],
        negative: ['remove', 'clear the brand', 'enleve', 'supprime'],
        destructive: false,
    },
    {
        id: 'storyboard_video',
        category: 'text',
        label: 'Storyboard the whole video',
        summary: 'Reads the transcript for the moments worth showing, plans a graphic for each one, and places them across the whole timeline.',
        phrases: ['storyboard this video', 'storyboard the video', 'storyboard it', 'make a storyboard',
                  'show me the storyboard', 'plan the storyboard', 'preview the storyboard',
                  'what would you put on screen', 'montre moi le storyboard', 'planifie le storyboard',
                  'add graphics throughout', 'graphics throughout the video', 'illustrate what i say',
                  'illustrate what im saying', 'add visuals to what i say', 'edit it like a pro creator',
                  'make it look like a premium creator video', 'add b roll graphics throughout',
                  'storyboard la video', 'fais un storyboard', 'illustre ce que je dis',
                  'ajoute des visuels partout', 'ajoute des graphismes sur toute la video'],
        negative: ['remove', 'clear', 'undo', 'enleve', 'retire', 'supprime'],
        destructive: false,
    },
    {
        id: 'place_contextual_illustrations',
        category: 'text',
        label: 'Add contextual vector illustrations',
        summary: 'Adds a few animated vector illustrations when a spoken phrase matches a supported subject.',
        phrases: ['add vector illustrations', 'add contextual illustrations', 'illustrate the key ideas',
                  'add animated icons to the video', 'place vector graphics', 'ajoute des illustrations vectorielles',
                  'illustre les idees importantes'],
        negative: ['remove', 'clear', 'undo', 'enleve', 'retire', 'supprime'],
        destructive: false,
    },
    {
        id: 'add_motion_component',
        category: 'text',
        label: 'Add motion title / composition',
        summary: 'Adds an editable multi-layer motion graphics component (Title Sequence, Kinetic Title, Stat Callout, Lower Third).',
        phrases: ['add title sequence', 'title sequence', 'add a title sequence', 'cinematic title',
                  'add kinetic title', 'kinetic title', 'kinetic text', 'punchy title',
                  'add stat callout', 'stat callout', 'metric callout', 'growth callout',
                  'add lower third', 'lower third', 'pro lower third', 'modern lower third'],
        negative: ['remove', 'clear', 'enleve', 'retire', 'supprime'],
        destructive: false,
    },
    {
        id: 'add_text_overlay',
        category: 'text',
        label: 'Add text',
        summary: 'Places a text overlay on the timeline.',
        phrases: ['add text', 'add a title', 'put text on', 'add a caption that says',
                  'overlay text', 'add a headline'],
        params: [
            { name: 'content', type: 'text', description: 'The words to display' },
            { name: 'at',      type: 'seconds', optional: true },
        ],
        destructive: false,
    },

    // ── Audio ────────────────────────────────────────────────────────────────
    {
        id: 'normalize_audio',
        category: 'audio',
        label: 'Normalise audio',
        summary: 'Evens out loudness across clips.',
        phrases: ['normalize audio', 'normalise audio', 'fix the levels', 'even out the audio',
                  'balance the volume', 'make the audio consistent'],
        destructive: false,
    },
    {
        id: 'denoise_audio',
        category: 'audio',
        label: 'Reduce noise',
        summary: 'Removes background hiss and hum.',
        phrases: ['remove background noise', 'denoise', 'reduce noise',
                  'remove the hiss', 'remove hum'],
        destructive: false,
    },
    {
        // R92: one pass (high-pass, denoise, compression, -16 LUFS). Part of "clean up".
        id: 'enhance_audio',
        category: 'audio',
        label: 'Enhance the voice',
        summary: 'Less background noise, even level and standard loudness, in one pass.',
        phrases: ['enhance the audio', 'enhance audio', 'improve the audio', 'improve audio', 'fix the audio',
                  'clean up the audio', 'clean the audio', 'better audio', 'better sound', 'make the voice clearer',
                  'enhance the voice', 'studio sound', 'ameliore le son', 'ameliore l audio', 'nettoie le son'],
        negative: ['music', 'musique', 'volume'],
        destructive: false,
    },
    {
        // R97: icon/emoji insert command. "add a fire emoji" places that
        // glyph; "add a heart icon"/"add a sticker" resolves a keyword
        // against the sticker library; "add 🔥" uses the literal glyph the
        // user already typed. See stickerQuery.js for the parsing.
        id: 'add_sticker',
        category: 'asset',
        label: 'Add an icon or emoji',
        summary: 'Places an icon, emoji or sticker overlay from the library.',
        phrases: ['add an emoji', 'add emoji', 'insert an emoji', 'add a sticker', 'insert a sticker',
                  'add an icon', 'insert an icon', 'add a fire emoji', 'add a heart emoji',
                  'put an emoji', 'add some emojis', 'add icons', 'add a sticker of', 'put a sticker',
                  'ajoute un emoji', 'ajoute une icone', 'ajoute un autocollant'],
        params: [{ name: 'query', type: 'text', optional: true }],
        destructive: false,
    },
    {
        // R98: generic drop shadow for stickers/icons/shapes/templates on
        // the overlay track (NOT captions -- those already have their own
        // textShadow toggle, TextPanel.jsx). Targets the active clip, else
        // whichever overlay clip is under the playhead, else the first one
        // -- same fallback chain _matteTargets already uses for video.
        id: 'add_shadow',
        category: 'transform',
        label: 'Add a shadow',
        summary: 'Adds a drop shadow to the selected sticker, icon, shape or graphic.',
        phrases: ['add a shadow', 'add shadow', 'add a drop shadow', 'give it a shadow',
                  'add a shadow to the icon', 'add a shadow to the sticker', 'add a shadow to the logo',
                  'add a shadow to the shape', 'put a shadow on it', 'ajoute une ombre'],
        negative: ['text', 'caption', 'captions'],
        destructive: false,
    },
    {
        id: 'remove_shadow',
        category: 'transform',
        label: 'Remove the shadow',
        summary: 'Removes the drop shadow from the selected sticker, icon, shape or graphic.',
        phrases: ['remove the shadow', 'remove shadow', 'clear the shadow', 'remove the drop shadow',
                  'take off the shadow', 'enleve l ombre'],
        negative: ['text', 'caption', 'captions'],
        destructive: false,
    },
    {
        // R99: freeform zone blur. A STATIC rectangle (frame fractions),
        // not a tracked region -- Marc explicitly did not pick "object
        // tracking beyond people" among the editing features he approved.
        // Covers what MatteBaker.js's person segmentation (R92) was never
        // built to find: a logo, a watermark, a timestamp burned into the
        // source, a stray face in the background. See zoneQuery.js for how
        // the location phrase ("top right corner", "the bottom") resolves
        // to a box, and _blurZoneTargets (MediaExecutionEngine.js) for the
        // clip-targeting chain (scoped to video + overlay tracks, unlike
        // _matteTargets, since a still photo is just as valid a target
        // here as video).
        id: 'add_blur_zone',
        category: 'transform',
        label: 'Blur a zone',
        summary: 'Blurs a rectangular region of the frame (a logo, watermark or stray face) for the clip\'s full duration.',
        phrases: ['blur this area', 'blur that area', 'blur this zone', 'blur this region',
                  'add a blur zone', 'blur the corner', 'blur the top left corner', 'blur the top right corner',
                  'blur the bottom left corner', 'blur the bottom right corner', 'blur the logo',
                  'blur the watermark', 'blur the timestamp', 'blur the text in the corner',
                  'pixelate the corner', 'pixelate the logo', 'censor the corner',
                  'floute ce coin', 'floute la zone', 'floute le logo'],
        // "blur the background" is a different command entirely (remove_background,
        // R92 -- person segmentation, not a fixed rectangle).
        negative: ['background', 'face', 'speaker', 'subject'],
        destructive: false,
    },
    {
        id: 'remove_blur_zone',
        category: 'transform',
        label: 'Remove the blur zone',
        summary: 'Removes a previously added zone blur from the selected clip.',
        phrases: ['remove the blur zone', 'remove blur zone', 'clear the blur zone', 'remove the pixelation',
                  'unblur the corner', 'remove the corner blur', 'enleve le flou de zone', 'enleve le flou du coin'],
        negative: ['background', 'face', 'speaker', 'subject'],
        destructive: false,
    },
    {
        id: 'add_sfx',
        category: 'asset',
        label: 'Add a sound effect',
        summary: 'Places a sound effect from the library.',
        phrases: ['add a sound effect', 'add sfx', 'add a whoosh', 'add a riser',
                  'put a sound on', 'add an impact sound',
                  // R92: plural = sound the whole edit; named = that sound at the playhead
                  'add sound effects', 'add some sound effects', 'sound effects', 'add a pop sound', 'add a swoosh',
                  'add a ding', 'add a boom', 'ajoute des effets sonores', 'ajoute des bruitages', 'ajoute un bruitage'],
        params: [{ name: 'query', type: 'text', optional: true }],
        destructive: false,
    },
    {
        id: 'adjust_volume',
        category: 'audio',
        label: 'Change volume',
        summary: 'Sets clip or track volume.',
        phrases: ['turn the volume', 'make it louder', 'make it quieter', 'lower the volume',
                  'raise the volume', 'set the volume'],
        params: [{ name: 'amount', type: 'percent', default: 1.0 }],
        destructive: false,
    },

    // ── Look ─────────────────────────────────────────────────────────────────
    {
        id: 'color_grade',
        category: 'transform',
        label: 'Colour grade',
        summary: 'Applies a colour look across clips.',
        // FIX (R75): 'apply a lut' used to live here, so typing it ran the
        // generic brightness/contrast/saturation adjuster instead of the real
        // LUT library — a vocabulary collision of exactly the kind this
        // registry exists to catch. Moved to the new apply_lut command below.
        phrases: ['color grade', 'colour grade', 'apply a look', 'make it cinematic',
                  'warm it up', 'cool it down'],
        params: [{ name: 'style', type: 'text', optional: true }],
        destructive: false,
    },
    {
        id: 'apply_lut',
        category: 'transform',
        label: 'Apply a LUT',
        summary: 'Applies a curated LUT look, resolved from a text description, to the timeline.',
        // Resolves the description via the real LUT library (searchLUTs) and
        // applies the best match — distinct from color_grade's ad hoc
        // brightness/contrast/saturation adjuster.
        phrases: ['apply a lut', 'apply the lut', 'apply a color preset', 'apply a colour preset',
                  'use a lut', 'try a lut', 'give me a lut', 'find me a lut',
                  'apply the recommended lut', 'apply the suggested look', 'use the suggested look'],
        negative: ['clear', 'remove', 'reset'],
        params: [
            { name: 'query',  type: 'text',   optional: true, description: 'Mood/style description, e.g. "warm cinematic"' },
            { name: 'target', type: 'target', default: 'clip', description: 'clip | all — whether to override manually-graded clips' },
        ],
        destructive: false,
    },
    {
        id: 'clear_lut',
        category: 'transform',
        label: 'Clear LUT',
        summary: 'Removes the applied LUT look from the timeline.',
        phrases: ['clear the lut', 'remove the lut', 'clear the color grade', 'clear the colour grade',
                  'reset the color look', 'remove the color look', 'undo the lut'],
        params: [
            { name: 'target', type: 'target', default: 'clip', description: 'clip | all — whether to override manually-graded clips' },
        ],
        destructive: false,
    },
    {
        id: 'recommend_luts',
        category: 'transform',
        label: 'Recommend LUTs',
        summary: 'Suggests LUTs that fit the footage — content-aware, not just format-based.',
        phrases: ['recommend a lut', 'recommend luts', 'suggest a lut', 'suggest a look',
                  'what lut should i use', 'what look would work', 'lut suggestions'],
        params: [{ name: 'limit', type: 'text', optional: true }],
        destructive: false,
    },

    // ── Timeline primitives (editor functions, typed) ────────────────────────
    {
        id: 'split_clip',
        category: 'timeline',
        label: 'Split at playhead',
        summary: 'Cuts the clip under the playhead in two.',
        phrases: ['split', 'split here', 'cut here', 'split at the playhead', 'razor here'],
        negative: ['speaker', 'silence'],
        destructive: true,
    },
    {
        id: 'remove_clip',
        category: 'timeline',
        label: 'Delete clip',
        summary: 'Removes the selected clip.',
        phrases: ['delete this clip', 'remove this clip', 'delete the selected clip'],
        destructive: true,
    },
    {
        id: 'set_clip_speed',
        category: 'timeline',
        label: 'Change speed',
        summary: 'Speeds up or slows down a clip.',
        phrases: ['speed up', 'slow down', 'change the speed', 'make it faster', 'make it slower',
                  'half speed', 'double speed'],
        params: [{ name: 'amount', type: 'percent', default: 1.0 }],
        destructive: false,
    },
    {
        id: 'add_transition',
        category: 'timeline',
        label: 'Add transition',
        summary: 'Adds a transition at a cut: flash, dip to black, whip, zoom punch, glitch or speed lines.',
        phrases: ['add a transition', 'add transitions', 'add a fade', 'crossfade', 'fade between', 'fade out',
                  'add a whip', 'whip transition', 'whip pan', 'flash transition', 'add a flash', 'glitch transition',
                  'add a glitch', 'speed lines', 'zoom transition', 'zoom punch', 'transitions between',
                  'ajoute une transition', 'ajoute des transitions', 'transition entre', 'mets une transition',
                  'mets des transitions', 'transition flash', 'transition glitch'],
        // "remove the transitions" is not an add.
        negative: ['remove', 'clear', 'enleve', 'retire', 'supprime'],
        params: [
            // Matched in this order (first hit wins), longest names first;
            // EditPlanner maps them onto the pack (motion/TransitionFX.js).
            { name: 'type',     type: 'enum', values: ['speed lines', 'whip right', 'whip left', 'zoom punch', 'whip', 'glitch', 'flash', 'dip', 'zoom', 'crossfade', 'fade', 'slide'] },
            { name: 'duration', type: 'seconds' },
            { name: 'target',   type: 'target', description: 'all → every cut' },
        ],
        destructive: false,
    },
    {
        id: 'set_aspect_ratio',
        category: 'timeline',
        label: 'Change aspect ratio',
        summary: 'Reframes the project for a platform.',
        phrases: ['make it vertical', 'make it 9:16', 'make it square', 'change the aspect ratio',
                  'format for tiktok', 'format for reels', 'make it widescreen',
                  'set the aspect ratio to', 'set aspect ratio to', 'set it to 9:16', 'set it to vertical',
                  'switch to 9:16', 'switch to vertical', 'switch the aspect ratio', 'switch it to 9:16'],
        params: [{ name: 'ratio', type: 'enum', values: ['16:9', '9:16', '1:1', '4:5'], default: '9:16' }],
        destructive: false,
    },
    {
        id: 'organize_clips',
        category: 'timeline',
        label: 'Organise clips',
        summary: 'Places and orders bin clips on the timeline.',
        phrases: ['organize', 'organise', 'organize my clips', 'arrange the clips',
                  'put them in order', 'sort my clips'],
        destructive: true,
    },
    {
        id: 'undo_action',
        category: 'timeline',
        label: 'Undo',
        summary: 'Reverts the last change.',
        phrases: ['undo', 'undo that', 'revert that', 'go back'],
        destructive: false,
    },

    // ── Export ───────────────────────────────────────────────────────────────
    {
        id: 'queue_export',
        category: 'export',
        label: 'Export',
        summary: 'Renders the final video.',
        phrases: ['export', 'render', 'export for youtube', 'export for tiktok',
                  'download the video', 'render it out'],
        params: [{ name: 'platform', type: 'text', optional: true }],
        destructive: false,
    },

    // R131 — "the brain loses the flow after each task done": a long-form
    // edit that fails or stops partway (a bug, a timeout, a transient error)
    // left nothing behind for the user to pick back up — see
    // longFormJobMemory.js. This command reads whatever was saved there.
    // Phrases are deliberately short and specific: "continue"/"keep going"
    // alone would be too broad (it could mean a dozen things depending on
    // context), so this only matches when the user is clearly asking to
    // pick a STOPPED EDIT back up, not just "continue" in the abstract.
    // R132 — "create a video from this script": script-to-video, Slice 1.
    // No TTS/voice yet (deferred by the user's own choice this round) — this
    // segments a plain-text script into shots, searches Vecteezy's vector
    // catalog first for a cartoonish look (falling back to video, then
    // photo, per shot), places them in sequence, and captions each shot
    // from the script text itself. See
    // claude/script-to-video-scoping-R132.md for what this does and
    // doesn't cover yet.
    {
        id: 'create_video_from_assets',
        category: 'edit',
        label: 'Create a video from images and footage',
        summary: 'Builds a visual montage from uploaded images and event footage, with gentle motion on stills and transitions between shots.',
        phrases: ['create a video from these images', 'create a video from my images', 'create a video from these photos', 'create a video from my photos', 'make a video from these images', 'make a video from my photos', 'make a montage from my media', 'make a montage from these clips', 'create a silent video from my media', 'create a video from the media bin', 'create a video from the attached images and video clips', 'turn these event photos into a video', 'turn these event videos into a video', 'assemble my event footage', 'compose these images and videos', 'créer une vidéo à partir de ces images', 'créer une vidéo à partir de mes photos', 'créer une vidéo à partir des images et des vidéos jointes', 'faire un montage de mes vidéos'],
        negative: ['script', 'transcript', 'narration', 'voiceover'],
        destructive: false,
    },
    {
        id: 'create_video_from_script',
        category: 'edit',
        label: 'Create a video from a script',
        summary: 'Builds a cartoonish-style video from a plain-text script — no footage needed — using Vecteezy vector/video/photo stock per shot, captioned from the script itself.',
        phrases: ['create a video from this script', 'create a video from my script',
                  'make a video from this script', 'make a video from my script',
                  'turn this script into a video', 'turn my script into a video',
                  'generate a video from this script', 'generate a video from my script',
                  'animate this script', 'make a cartoon video from this script',
                  'make an animated video from this script', 'build a video from this script'],
        negative: ['storyboard', 'illustrate', 'b-roll', 'broll', 'footage', 'transcript'],
        destructive: false,
    },

    {
        id: 'resume_failed_job',
        category: 'edit',
        label: 'Continue the edit',
        summary: 'Picks up the last complete edit from wherever it stopped or failed.',
        phrases: ['continue the edit', 'continue editing', 'continue where it stopped',
                  'continue where it left off', 'pick up where it left off',
                  'resume the edit', 'resume editing', 'finish the edit',
                  'try the edit again', 'try again', 'retry the edit', 'retry the failed step'],
        destructive: false,
    },

    // ── Macros — sugar only, expand to atomic steps ──────────────────────────
    {
        id: 'macro_multicam',
        executes: 'virtual_multicam',   // single-shot path; macro[] is the atomic expansion
        category: 'macro',
        label: 'Full multicam pass',
        summary: 'Detect speakers → analyse framing → split at turns → apply angles.',
        phrases: ['virtual multicam', 'multicam', 'multi camera', 'make it multicam',
                  'make it feel multi camera'],
        macro: ['detect_speakers', 'detect_scene', 'split_by_speaker', 'apply_angle'],
        destructive: true,
    },
    {
        id: 'macro_clean_and_polish',
        executes: 'compound_clean_dynamic',
        category: 'macro',
        label: 'Clean up and polish',
        summary: 'Remove silences → remove fillers → add zoom rhythm.',
        // R92: "full cleanup" / "clean and polish" are a plain clean up (no zoom)
        // now; only an explicit "make it dynamic" adds the zoom rhythm.
        phrases: ['clean it up and make it dynamic', 'clean up and make it dynamic'],
        macro: ['silence_removal', 'remove_filler_words', 'rhythm_zoom'],
        destructive: true,
    },
];

/** id → command */
export const COMMAND_BY_ID = Object.fromEntries(COMMANDS.map(c => [c.id, c]));

/**
 * Detect vocabulary that would make two commands ambiguous.
 * Run in tests — a collision here is exactly the `crop` bug waiting to happen.
 * @returns {Array<{phrase:string, commands:string[]}>}
 */
export function findCollisions() {
    const byPhrase = {};
    for (const c of COMMANDS) {
        for (const p of c.phrases || []) {
            const k = p.toLowerCase().trim();
            (byPhrase[k] ||= []).push(c.id);
        }
    }
    return Object.entries(byPhrase)
        .filter(([, ids]) => ids.length > 1)
        .map(([phrase, commands]) => ({ phrase, commands }));
}

/**
 * Score how well raw user text matches a command.
 * Longer phrase matches win (so "remove filler words" beats "remove"), and any
 * `negative` term vetoes the command outright — that veto is what stops "crop
 * the speaker" from ever reaching silence removal again.
 *
 * @returns {number} 0 = no match
 */
export function scoreCommand(cmd, text) {
    // Accents are folded (R88): the tokenizer below splits on anything outside
    // a-z, so "clés" used to become "cl" + "s" and French requests missed
    // phrases written without accents. ASCII text is unchanged by this.
    const raw = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!raw) return 0;

    const tokens = raw.split(/[^a-z0-9%:]+/).filter(Boolean);
    // Filler words people naturally insert ("remove THE silences") — ignored when
    // matching so phrases don't have to enumerate every phrasing variant.
    const SKIP = new Set(['the', 'a', 'an', 'my', 'all', 'of', 'please', 'this', 'that', 'some', 'any']);

    for (const n of cmd.negative || []) {
        if (tokens.includes(n.toLowerCase())) return 0;
    }

    let best = 0;
    for (const p of cmd.phrases || []) {
        const pTokens = p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean);
        // Ordered subsequence match: every phrase token appears in order,
        // with filler words allowed in between.
        let ti = 0, matched = 0;
        for (const pt of pTokens) {
            while (ti < tokens.length && tokens[ti] !== pt) {
                if (!SKIP.has(tokens[ti]) && matched > 0) { /* real word gap — still allowed */ }
                ti++;
            }
            if (ti >= tokens.length) { matched = 0; break; }
            matched++; ti++;
        }
        if (matched === pTokens.length) {
            // Longer phrases are more specific → higher score
            best = Math.max(best, p.length);
        }
    }
    return best;
}

/**
 * Rank commands for a piece of text.
 * @returns {Array<{ id:string, score:number, command:object }>} best first
 */
export function matchCommands(text, { limit = 3 } = {}) {
    return COMMANDS
        .map(c => ({ id: c.id, score: scoreCommand(c, text), command: c }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

/**
 * Resolve text to a single command, flagging when it's too close to call.
 * `ambiguous` is what the caller should turn into a question rather than
 * silently executing — the failure mode that ran silence removal on a crop
 * request and then reported success.
 *
 * @returns {{ match:object|null, ambiguous:boolean, alternatives:Array, confidence:'high'|'low'|'none' }}
 */
export function resolveCommand(text) {
    const ranked = matchCommands(text, { limit: 3 });
    if (ranked.length === 0) {
        return { match: null, ambiguous: false, alternatives: [], confidence: 'none' };
    }
    const [top, second] = ranked;
    // Two commands matched on phrases of near-identical length → genuinely unclear
    const tooClose = !!second && (top.score - second.score) <= 2;
    const destructive = !!top.command.destructive;
    return {
        match: top.command,
        ambiguous: tooClose && destructive,
        alternatives: ranked.slice(1).map(r => r.command),
        confidence: tooClose ? 'low' : 'high',
    };
}

/**
 * Extract structured params from free text for a command.
 *
 * Deliberately conservative: anything not confidently parsed falls back to the
 * declared default instead of guessing, so a half-understood sentence can never
 * produce a confidently wrong edit. Lives here (not in the parser) so it's
 * unit-testable without booting the store.
 *
 * @returns {Record<string, any>}
 */
export function extractParams(cmd, prompt) {
    const text = String(prompt || '').toLowerCase();
    const out = {};

    for (const p of cmd.params || []) {
        let value;

        if (p.type === 'percent') {
            const pct  = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
            const mult = text.match(/(\d+(?:\.\d+)?)\s*x\b/);
            if (pct)       value = parseFloat(pct[1]) / 100;
            else if (mult) value = parseFloat(mult[1]);
            else if (/\bdouble\b/.test(text)) value = 2;
            else if (/\bhalf\b/.test(text))   value = 0.5;
        } else if (p.type === 'seconds') {
            const s = text.match(/(\d+(?:\.\d+)?)\s*(?:s\b|sec\b|seconds?)/);
            if (s) value = parseFloat(s[1]);
        } else if (p.type === 'speaker') {
            const m = text.match(/speaker[\s_]*(\d+)/);
            if (m) value = `SPEAKER_${m[1].padStart(2, '0')}`;
        } else if (p.type === 'target') {
            // R89: French too ("toutes les coupes", "chaque plan").
            if (/\ball\b|\bevery\b|\bwhole\b|\btous\b|\btoutes\b|\bchaque\b/.test(text)) value = 'all';
            else if (/\bthis\b|\bselected\b|\bhere\b/.test(text)) value = 'clip';
        } else if (p.type === 'enum') {
            value = (p.values || []).find(v => text.includes(String(v).toLowerCase()));
        } else if (p.type === 'text') {
            const q = String(prompt || '').match(/["“]([^"”]+)["”]/);
            if (q) {
                value = q[1];
            } else if (p.name === 'query' || p.name === 'style') {
                // No quotes given — fall back to whatever's left of the prompt
                // after stripping this command's own trigger words, e.g.
                // "apply a warm cinematic lut" → trigger words "apply/a/lut"
                // stripped → "warm cinematic". Without this, typed mood/style
                // requests ("apply a warm lut") would silently resolve the
                // command but drop the very description that picks the LUT.
                const stop = new Set(['a', 'an', 'the', 'to', 'me', 'please', 'it', 'on',
                    'for', 'with', 'my', 'this', 'that', 'i', 'want', 'can', 'you', 'and',
                    'all', 'every', 'whole', 'clip', 'clips']);
                const phraseWords = new Set((cmd.phrases || []).join(' ').toLowerCase().split(/\s+/));
                const leftover = text
                    .replace(/["“”]/g, '')
                    .split(/\s+/)
                    .filter(w => w && !phraseWords.has(w) && !stop.has(w))
                    .join(' ')
                    .trim();
                if (leftover) value = leftover;
            }
        }

        if (value === undefined && p.default !== undefined) value = p.default;
        if (value !== undefined) out[p.name] = value;
    }
    return out;
}

/** Expand a macro id into its atomic step ids (non-macros return themselves). */
export function expandMacro(id) {
    const c = COMMAND_BY_ID[id];
    if (!c) return [id];
    return c.macro ? [...c.macro] : [id];
}

/** Commands grouped for UI listing ("what can I type?"). */
export function commandsByCategory() {
    return COMMANDS.reduce((acc, c) => {
        (acc[c.category] ||= []).push({ id: c.id, label: c.label, summary: c.summary });
        return acc;
    }, {});
}

export default { COMMANDS, COMMAND_BY_ID, matchCommands, resolveCommand, findCollisions, expandMacro, commandsByCategory, extractParams };
