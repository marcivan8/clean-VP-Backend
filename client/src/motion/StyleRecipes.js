/**
 * client/src/motion/StyleRecipes.js
 *
 * R90 (to-do A7) — one-click style recipes: a caption look, keyword emphasis,
 * transitions on the cuts, a zoom rhythm and automatic placements (b-roll on
 * the words it illustrates, number pops), bundled. Pure data; the assistant's
 * `apply_style_recipe` (MediaExecutionEngine) applies it as ONE undo step.
 *
 * Every field is optional: a recipe step that cannot run (no captions yet, no
 * b-roll in the bin) is skipped and reported, never faked.
 */

export const STYLE_RECIPES = {
    'punchy': {
        id: 'punchy',
        captionPack: 'hormozi',          // CaptionModel CAPTION_STYLE_PACKS
        keywords: true,                  // keyword emphasis (R88)
        transitions: { cycle: ['flash', 'whip-left', 'zoom-punch', 'whip-right'] },
        rhythmZoom: 'dynamic',           // /api/interview/rhythm-zoom styles
        broll: { layout: 'fullscreen' }, // word-synced cutaways (A6)
        numberPops: true,
        phrases: ['punchy', 'punchy creator', 'hormozi', 'high energy', 'dynamique', 'percutant'],
    },
    'travel': {
        id: 'travel',
        captionPack: 'mrbeast',
        keywords: true,
        transitions: { cycle: ['speed-lines', 'whip-left', 'whip-right'] },
        rhythmZoom: 'subtle',
        broll: { layout: 'fullscreen' },
        numberPops: true,
        phrases: ['travel', 'travel vlog', 'vlog', 'voyage', 'vlog voyage'],
    },
    'explainer': {
        id: 'explainer',
        captionPack: 'ali-abdaal',
        keywords: true,
        transitions: { cycle: ['dip'], duration: 0.4 },
        rhythmZoom: 'subtle',
        broll: { layout: 'split' },
        numberPops: true,
        phrases: ['explainer', 'tutorial', 'tuto', 'tutoriel', 'educational', 'explication'],
    },
    'podcast': {
        id: 'podcast',
        captionPack: 'podcast',
        keywords: false,
        transitions: { cycle: ['dip'], duration: 0.5 },
        rhythmZoom: 'subtle',
        broll: null,
        numberPops: false,
        phrases: ['podcast', 'podcast clip', 'interview', 'calm', 'calme'],
    },
};

export const STYLE_RECIPE_IDS = Object.keys(STYLE_RECIPES);

/** The recipe named in free text, or null. */
export function recipeFromText(text) {
    const s = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let best = null;
    let bestLen = 0;
    for (const r of Object.values(STYLE_RECIPES)) {
        for (const p of r.phrases) {
            if (s.includes(p) && p.length > bestLen) { best = r.id; bestLen = p.length; }
        }
    }
    return best;
}

/**
 * Transition for the i-th cut (cycling), or null when the recipe has none.
 * @returns {{type:string, duration:number|null}|null}
 */
export function recipeTransitionForCut(recipe, i) {
    const c = recipe?.transitions?.cycle;
    if (!Array.isArray(c) || c.length === 0) return null;
    return { type: c[i % c.length], duration: Number(recipe.transitions.duration) > 0 ? Number(recipe.transitions.duration) : null };
}

export default { STYLE_RECIPES, STYLE_RECIPE_IDS, recipeFromText, recipeTransitionForCut };
