/**
 * fontRegistry.ts
 *
 * Single source of truth for fonts used in Vibed Revideo exports.
 * Mirrors FONT_SPECS in jobs/exportProcessor.js — keep both in sync when
 * adding a new font (see NODE 10 · EXT2 in CLAUDE.md).
 *
 * jsDelivr URL pattern:
 *   https://cdn.jsdelivr.net/npm/@fontsource/{slug}@4/files/{slug}-{subset}-{weight}-normal.ttf
 */

export interface FontSpec {
    /** TTF filename on disk (e.g. "Montserrat-Bold.ttf") */
    file: string;
    /** @fontsource npm package slug (e.g. "montserrat") */
    slug: string;
    /** CSS font-weight value */
    weight: number;
    /** @fontsource subset (usually "latin") */
    subset: string;
}

/**
 * All fonts offered in TextPanel.jsx and ReasoningPanel.jsx.
 * Key = exact font-family name used in clip.fontFamily.
 */
export const FONT_SPECS: Record<string, FontSpec> = {
    // Talking Head
    'Anton':              { file: 'Anton-Regular.ttf',             slug: 'anton',              weight: 400, subset: 'latin' },
    'Bebas Neue':         { file: 'BebasNeue-Regular.ttf',         slug: 'bebas-neue',         weight: 400, subset: 'latin' },
    'Montserrat':         { file: 'Montserrat-Bold.ttf',           slug: 'montserrat',         weight: 800, subset: 'latin' },
    'Inter':              { file: 'Inter-Regular.ttf',             slug: 'inter',              weight: 400, subset: 'latin' },
    'Barlow Condensed':   { file: 'BarlowCondensed-Bold.ttf',      slug: 'barlow-condensed',   weight: 700, subset: 'latin' },
    // Podcast / Doc
    'Playfair Display':   { file: 'PlayfairDisplay-Regular.ttf',   slug: 'playfair-display',   weight: 400, subset: 'latin' },
    'Lora':               { file: 'Lora-Regular.ttf',              slug: 'lora',               weight: 400, subset: 'latin' },
    'Merriweather':       { file: 'Merriweather-Regular.ttf',      slug: 'merriweather',       weight: 400, subset: 'latin' },
    'DM Serif Display':   { file: 'DMSerifDisplay-Regular.ttf',    slug: 'dm-serif-display',   weight: 400, subset: 'latin' },
    'Cormorant Garamond': { file: 'CormorantGaramond-Regular.ttf', slug: 'cormorant-garamond', weight: 400, subset: 'latin' },
    // Lifestyle / Vlog
    'Nunito':             { file: 'Nunito-Regular.ttf',            slug: 'nunito',             weight: 400, subset: 'latin' },
    'Poppins':            { file: 'Poppins-Regular.ttf',           slug: 'poppins',            weight: 400, subset: 'latin' },
    'Quicksand':          { file: 'Quicksand-Regular.ttf',         slug: 'quicksand',          weight: 400, subset: 'latin' },
    'Josefin Sans':       { file: 'JosefinSans-Regular.ttf',       slug: 'josefin-sans',       weight: 400, subset: 'latin' },
    'Raleway':            { file: 'Raleway-Regular.ttf',           slug: 'raleway',            weight: 400, subset: 'latin' },
    // Gaming / Tech
    'Rajdhani':           { file: 'Rajdhani-Regular.ttf',          slug: 'rajdhani',           weight: 400, subset: 'latin' },
    'Exo 2':              { file: 'Exo2-Regular.ttf',              slug: 'exo-2',              weight: 400, subset: 'latin' },
    'Orbitron':           { file: 'Orbitron-Regular.ttf',          slug: 'orbitron',           weight: 400, subset: 'latin' },
    'Oxanium':            { file: 'Oxanium-Regular.ttf',           slug: 'oxanium',            weight: 400, subset: 'latin' },
    'Roboto Condensed':   { file: 'RobotoCondensed-Regular.ttf',   slug: 'roboto-condensed',   weight: 400, subset: 'latin' },
    // Motivational
    'Oswald':             { file: 'Oswald-Regular.ttf',            slug: 'oswald',             weight: 400, subset: 'latin' },
    'Teko':               { file: 'Teko-Regular.ttf',              slug: 'teko',               weight: 400, subset: 'latin' },
    'Black Han Sans':     { file: 'BlackHanSans-Regular.ttf',      slug: 'black-han-sans',     weight: 400, subset: 'latin' },
    'Saira Condensed':    { file: 'SairaCondensed-Regular.ttf',    slug: 'saira-condensed',    weight: 400, subset: 'latin' },
    'Cabin':              { file: 'Cabin-Regular.ttf',             slug: 'cabin',              weight: 400, subset: 'latin' },
    // Handwritten
    'Caveat':             { file: 'Caveat-Regular.ttf',            slug: 'caveat',             weight: 400, subset: 'latin' },
    'Pacifico':           { file: 'Pacifico-Regular.ttf',          slug: 'pacifico',           weight: 400, subset: 'latin' },
    'Kalam':              { file: 'Kalam-Regular.ttf',             slug: 'kalam',              weight: 400, subset: 'latin' },
    'Satisfy':            { file: 'Satisfy-Regular.ttf',           slug: 'satisfy',            weight: 400, subset: 'latin' },
    'Dancing Script':     { file: 'DancingScript-Regular.ttf',     slug: 'dancing-script',     weight: 400, subset: 'latin' },
    // Neon / Glow
    'Boogaloo':           { file: 'Boogaloo-Regular.ttf',          slug: 'boogaloo',           weight: 400, subset: 'latin' },
    'Righteous':          { file: 'Righteous-Regular.ttf',         slug: 'righteous',          weight: 400, subset: 'latin' },
    'Press Start 2P':     { file: 'PressStart2P-Regular.ttf',      slug: 'press-start-2p',     weight: 400, subset: 'latin' },
};

/** Case-insensitive lookup map. Built once at module load. */
export const FONT_BY_NAME: Record<string, { name: string } & FontSpec> = {};
for (const [name, spec] of Object.entries(FONT_SPECS)) {
    FONT_BY_NAME[name.toLowerCase()] = { name, ...spec };
}
