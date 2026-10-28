/**
 * client/src/motion/BrandKit.js
 *
 * R114 — one brand, applied to the whole catalogue.
 *
 * Fifty-two templates each carried their own hardcoded `#00E5FF`. That is
 * fine for a demo and wrong for a product: a creator with a red channel got a
 * cyan counter, a cyan funnel and a cyan status label, and the only way to
 * change it was to pass `accent` by hand to every graphic they ever asked
 * for. Marc's own list put a brand kit at category 12; it belongs nearer the
 * top, because it is the one item that multiplies every other graphic.
 *
 * ─── HOW IT REACHES 52 TEMPLATES WITHOUT TOUCHING 52 DRAW FUNCTIONS ─────────
 *
 * Not by threading a `brand` object through every drawing routine. That would
 * be fifty-two edits, fifty-two chances to miss one, and a silent divergence
 * the moment a fifty-third is added.
 *
 * Instead the kit is resolved at the PARAMS layer. `applyBrand(kind, params,
 * brand)` fills the colour fields a template declares — the five that exist
 * across the whole catalogue (`accent`, `color`, `colors`, `leftColor`,
 * `rightColor`, `borderColor`) — wherever the CALLER did not specify one.
 * `drawTemplate` calls it once. A new template gets brand support by
 * declaring an `accent` in its defaults, which it would do anyway.
 *
 * ─── THE RULE THAT MAKES THIS SAFE ─────────────────────────────────────────
 *
 * **An explicit value always wins.** The brand fills a slot the caller left
 * at its default; it never overwrites a colour someone chose. Without that,
 * applying a brand would silently destroy every hand-tuned graphic already on
 * a timeline — and a user who picked a red for one card and got the brand's
 * blue instead would have no way to understand why.
 *
 * Distinguishing "the caller chose this" from "this is the template's own
 * default" is the whole trick, and it is done by comparing against
 * TEMPLATE_DEFAULTS rather than by checking for undefined: callers routinely
 * pass the full resolved param set.
 *
 * ─── WHAT IS AND IS NOT APPLIED ────────────────────────────────────────────
 *
 * Applied to all 52: colour and font family.
 * Carried by the kit and used by the R114 BRAND graphics only: corner radius,
 * spacing and pace. Applying radius to the existing 52 would mean editing
 * every roundRect call in the file, and pace would mean rewriting every
 * envelope — both real work, neither done here, and neither pretended.
 *
 * Pure: no DOM, no store, no imports beyond the catalogue's own defaults.
 */

/** Everything a kit holds. Every field has a default, so a partial kit works. */
export const BRAND_DEFAULTS = Object.freeze({
    name: '',
    /** The colour that carries the brand. Most templates use exactly this. */
    accent: '#00E5FF',
    /** A second accent, for charts and anything with two sides. */
    accent2: '#FF3B5C',
    /** Text on a dark graphic. */
    text: '#FFFFFF',
    /** The card surface a graphic sits on. */
    surface: '#0E121C',
    /** Fonts, matching TEMPLATE_FONTS' shape so it drops straight in. */
    display: 'Anton',
    label: 'Montserrat',
    body: 'Inter',
    mono: 'JetBrains Mono',
    /** Corner radius for the R114 brand graphics, in reference pixels. */
    radius: 24,
    /** Padding inside a brand graphic. */
    spacing: 32,
    /**
     * Animation personality: a multiplier on entrance durations.
     * 1 is the catalogue's own timing; below 1 is snappier, above is calmer.
     */
    pace: 1,
    /** A logo image url, resolved through `opts.images` like `logo-card`. */
    logoUrl: '',
});

/** The colour fields that exist anywhere in the catalogue. */
export const BRAND_COLOR_FIELDS = Object.freeze(['accent', 'color', 'color2', 'accentColor', 'leftColor', 'rightColor', 'borderColor']);

/**
 * Which brand colour each field takes. `color` is deliberately absent: the
 * catalogue uses that one name for two different jobs, so it is resolved from
 * the template's own default — see `sourceFor`.
 */
const FIELD_SOURCE = Object.freeze({
    accent: 'accent',
    accentColor: 'accent',
    color2: 'accent2',
    leftColor: 'accent2',
    rightColor: 'accent',
    borderColor: 'accent',
});

/**
 * Per-kind overrides, for the handful of templates where a field name means
 * something other than it does everywhere else. `null` means the brand never
 * touches that field on that kind.
 */
const KIND_FIELD_SOURCE = Object.freeze({
    // A panel is the surface a graphic sits ON, not a mark drawn on top of
    // one, and its `color2` is an off-switch for the gradient rather than a
    // colour the brand should turn on.
    panel: Object.freeze({ color: 'surface', color2: null }),
});

/**
 * Resolve which brand colour a field takes.
 *
 * `color` is the hard case. In roughly half the catalogue it is the mark being
 * drawn (`bar-chart`, `underline`, `data-counter`) and in the other half it is
 * the text on a card that has its own separate `accent` (`step-card`,
 * `end-card`). The template's OWN default says which: a white default is text,
 * anything else is a mark. That rule is mechanical, so a new kind gets the
 * right source without being listed anywhere.
 */
function sourceFor(kind, field, base) {
    const override = KIND_FIELD_SOURCE[kind];
    if (override && field in override) return override[field];
    if (field === 'color') return isWhite(base[field]) ? 'text' : 'accent';
    return FIELD_SOURCE[field] || null;
}

/** A default of white (or near it) means the field carries text, not a mark. */
function isWhite(v) {
    const h = str(v).toLowerCase();
    if (h === '#fff' || h === '#ffffff') return true;
    if (!/^#[0-9a-f]{6}$/.test(h)) return false;
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    return r >= 240 && g >= 240 && b >= 240;
}

const str = (v) => String(v ?? '').trim();
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** A colour string we are willing to treat as a colour. */
export function isColor(v) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(str(v));
}

/**
 * A kit from partial input: every missing field falls back to the default,
 * and anything malformed is dropped rather than carried into a draw call.
 */
export function normalizeBrand(input) {
    const b = { ...BRAND_DEFAULTS };
    const src = input && typeof input === 'object' ? input : {};
    for (const key of ['accent', 'accent2', 'text', 'surface']) {
        if (isColor(src[key])) b[key] = str(src[key]).toLowerCase();
    }
    for (const key of ['display', 'label', 'body', 'mono']) {
        // A font family is a name, not a stack: these are passed to a canvas
        // `font` string, where a comma-separated stack silently fails to
        // match the registered face in the export renderer.
        const v = str(src[key]);
        if (v && !v.includes(',')) b[key] = v;
    }
    b.name = str(src.name).slice(0, 60);
    b.logoUrl = str(src.logoUrl);
    b.radius = Math.max(0, Math.min(80, num(src.radius, BRAND_DEFAULTS.radius)));
    b.spacing = Math.max(8, Math.min(120, num(src.spacing, BRAND_DEFAULTS.spacing)));
    // A pace of 0 would divide by zero in an entrance; a pace of 10 would mean
    // a graphic that never finishes arriving before it has to leave.
    b.pace = Math.max(0.5, Math.min(2, num(src.pace, BRAND_DEFAULTS.pace)));
    return b;
}

/** The font table a branded draw should use, in TEMPLATE_FONTS' shape. */
export function brandFonts(brand) {
    const b = normalizeBrand(brand);
    return { display: b.display, label: b.label, body: b.body, mono: b.mono };
}

/**
 * Fill a template's colour fields from the brand, leaving anything the caller
 * chose alone.
 *
 * @param {string} kind
 * @param {object} params        the caller's params (may be partial or full)
 * @param {object} brand
 * @param {object} defaults      TEMPLATE_DEFAULTS[kind] — passed in so this
 *                               module does not import the catalogue and can
 *                               be tested on its own
 * @returns {object} a NEW params object; the input is never mutated
 */
export function applyBrand(kind, params, brand, defaults) {
    const p = { ...(params && typeof params === 'object' ? params : {}) };
    if (!brand) return p;
    const b = normalizeBrand(brand);
    const base = defaults && typeof defaults === 'object' ? defaults : {};

    for (const field of BRAND_COLOR_FIELDS) {
        if (!(field in base)) continue;
        const given = p[field];
        // Untouched means: absent, or still equal to the template's own
        // default. Comparing to the default is what lets a caller pass the
        // fully-resolved param set (which every internal caller does) and
        // still have the brand apply.
        const untouched = given === undefined || given === null || str(given) === ''
            || str(given).toLowerCase() === str(base[field]).toLowerCase();
        if (!untouched) continue;
        // A default of null or '' is an off-switch (panel's second gradient
        // stop, say), not a colour waiting to be branded.
        if (base[field] === null || base[field] === undefined || str(base[field]) === '') continue;
        const source = sourceFor(kind, field, base);
        if (!source) continue;
        p[field] = b[source];
    }

    // `colors` is a comma LIST (pie, donut). An empty one means "derive from
    // the accent", which the chart already does — so the brand only has to
    // leave it alone. Setting it here would freeze a palette the chart is
    // better at computing for the number of slices it actually has.

    // A logo-bearing template with no image of its own takes the brand's.
    if ('imageUrl' in base && b.logoUrl && !str(p.imageUrl)) p.imageUrl = b.logoUrl;

    return p;
}

/** Scale an entrance duration by the brand's pace. */
export function paced(seconds, brand) {
    return Math.max(0.05, num(seconds, 0.4) * normalizeBrand(brand).pace);
}

/**
 * A kit read off a project: the user's own fields if they set any, else the
 * palette the footage suggested, else the defaults.
 *
 * Deliberately NOT inventing a brand from one sampled frame alone — a palette
 * read off a single shot is a suggestion about that shot, not a decision
 * about the channel. It fills the accent only when nothing else has.
 */
export function brandFromProject({ brand, palette } = {}) {
    const explicit = brand && typeof brand === 'object' ? brand : {};
    const merged = { ...explicit };
    if (!isColor(merged.accent) && isColor(palette?.accent)) merged.accent = palette.accent;
    if (!isColor(merged.text) && isColor(palette?.text)) merged.text = palette.text;
    return normalizeBrand(merged);
}

export default {
    BRAND_DEFAULTS, BRAND_COLOR_FIELDS, isColor, normalizeBrand, brandFonts,
    applyBrand, paced, brandFromProject,
};
