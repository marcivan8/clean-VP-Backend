/**
 * client/src/motion/IconLibrary.js
 *
 * R115 — category 9: a real icon set.
 *
 * `StickerLibraryAdapter` serves raster stickers, and R113 put eight tiny
 * glyphs inside `status-label` where nothing else could reach them. Neither is
 * an icon library: the first cannot take a brand colour or scale cleanly, and
 * the second is eight shapes welded to one template.
 *
 * ─── WHY PATH DATA AND NOT SVG FILES ───────────────────────────────────────
 *
 * An icon here is a list of drawing commands on a 24x24 grid, which is the
 * grid every icon set in common use is drawn on. That choice is what makes
 * them work everywhere this engine already works:
 *
 *   - they draw to a CANVAS, which is what the preview and the export
 *     renderer both use, so there is one implementation and no parity
 *     question;
 *   - they scale to any size with no raster asset to fetch, so an icon never
 *     fails to load mid-render;
 *   - they take a colour at draw time, so the brand kit applies to them for
 *     free, which an imported SVG file would not.
 *
 * The cost is honest: these are hand-described shapes, not a designed set.
 * Simple, consistent in weight, deliberately unornamented.
 *
 * ─── THE COMMAND FORMAT ────────────────────────────────────────────────────
 *
 * Each icon is `{ s: [...] }` (strokes) and/or `{ f: [...] }` (fills). Every
 * entry is one shape:
 *   ['M', x, y, x, y, ...]   a polyline through the points
 *   ['Z', x, y, x, y, ...]   the same, closed
 *   ['C', cx, cy, r]         a circle
 *   ['A', cx, cy, r, a0, a1] an arc, angles in TURNS (0.25 = 90 degrees)
 *   ['R', x, y, w, h, r]     a rounded rectangle
 *
 * Numbers are in 24x24 units. Nothing else is allowed, which is what lets
 * `drawIcon` stay short and lets a check walk every icon and prove it stays
 * inside its box.
 *
 * Pure: no DOM beyond the ctx it is handed, no imports.
 */

/** The grid every icon is drawn on. */
export const ICON_GRID = 24;

/**
 * The set, grouped the way the request grouped it. The group is part of the
 * data because a picker needs it, and because it is how a person looks for an
 * icon ("something for analytics") rather than by name.
 */
export const ICON_GROUPS = Object.freeze({
    interface: ['play', 'pause', 'cursor', 'search', 'settings', 'upload', 'download', 'link', 'menu', 'close'],
    communication: ['chat', 'mail', 'phone', 'mic', 'send', 'bell'],
    business: ['briefcase', 'target', 'handshake', 'team', 'building', 'growth', 'shield', 'lock', 'globe'],
    analytics: ['chart-up', 'chart-bar', 'gauge', 'calculator', 'clock', 'calendar'],
    education: ['book', 'bulb', 'cap', 'note'],
    creator: ['camera', 'video', 'timeline', 'headphones', 'scissors', 'palette'],
    reactions: ['check', 'cross', 'bang', 'question', 'star', 'heart', 'fire', 'eye', 'trophy'],
    decorative: ['sparkle', 'arrow-right', 'arrow-up-right', 'burst', 'squiggle', 'dots', 'rocket'],
});

/** Every icon name, flattened. */
export const ICON_NAMES = Object.freeze(Object.values(ICON_GROUPS).flat());

/** The group an icon belongs to, or null. */
export function groupOf(name) {
    for (const [group, names] of Object.entries(ICON_GROUPS)) {
        if (names.includes(name)) return group;
    }
    return null;
}

/** Every command letter `drawIcon` knows. Anything else is a malformed icon. */
export const ICON_COMMANDS = Object.freeze(['M', 'Z', 'C', 'A', 'R']);

/* eslint-disable key-spacing */
export const ICONS = Object.freeze({
    // ── interface ──────────────────────────────────────────────────────────
    'play':           { f: [['Z', 7, 4, 20, 12, 7, 20]] },
    'pause':          { f: [['R', 6, 4, 4, 16, 1.5], ['R', 14, 4, 4, 16, 1.5]] },
    'cursor':         { f: [['Z', 5, 3, 19, 11, 12.5, 12.5, 10, 20]] },
    'search':         { s: [['C', 10.5, 10.5, 6.5], ['M', 15.5, 15.5, 21, 21]] },
    'settings':       { s: [['C', 12, 12, 3.2], ['M', 12, 2, 12, 5], ['M', 12, 19, 12, 22], ['M', 2, 12, 5, 12], ['M', 19, 12, 22, 12], ['M', 5, 5, 7, 7], ['M', 17, 17, 19, 19], ['M', 19, 5, 17, 7], ['M', 7, 17, 5, 19]] },
    'upload':         { s: [['M', 12, 17, 12, 3], ['M', 6, 9, 12, 3, 18, 9], ['M', 3, 21, 21, 21]] },
    'download':       { s: [['M', 12, 3, 12, 17], ['M', 6, 11, 12, 17, 18, 11], ['M', 3, 21, 21, 21]] },
    'link':           { s: [['A', 8.5, 12, 4.5, 0.25, 0.75], ['A', 15.5, 12, 4.5, 0.75, 1.25], ['M', 8, 12, 16, 12]] },
    'menu':           { s: [['M', 4, 7, 20, 7], ['M', 4, 12, 20, 12], ['M', 4, 17, 20, 17]] },
    'close':          { s: [['M', 6, 6, 18, 18], ['M', 18, 6, 6, 18]] },

    // ── communication ──────────────────────────────────────────────────────
    'chat':           { s: [['R', 3, 4, 18, 13, 4], ['M', 8, 17, 8, 21, 13, 17]] },
    'mail':           { s: [['R', 3, 5, 18, 14, 3], ['M', 3, 7, 12, 14, 21, 7]] },
    'phone':          { s: [['Z', 4, 4, 9, 4, 11, 9, 8, 11, 13, 16, 15, 13, 20, 15, 20, 20, 15, 20, 4, 9]] },
    'mic':            { s: [['R', 9, 2, 6, 12, 3], ['A', 12, 13, 7, 0, 0.5], ['M', 12, 20, 12, 22], ['M', 8, 22, 16, 22]] },
    'send':           { s: [['Z', 3, 12, 21, 4, 14, 21, 12, 14]] },
    'bell':           { s: [['M', 6, 16, 6, 11], ['A', 12, 11, 6, 0.5, 1.0], ['M', 18, 11, 18, 16], ['M', 4, 16, 20, 16], ['A', 12, 17, 2.4, 0, 0.5]] },

    // ── business ───────────────────────────────────────────────────────────
    'briefcase':      { s: [['R', 2, 7, 20, 13, 3], ['M', 8, 7, 8, 4, 16, 4, 16, 7], ['M', 2, 13, 22, 13]] },
    'target':         { s: [['C', 12, 12, 9], ['C', 12, 12, 5], ['C', 12, 12, 1.5]] },
    // Two forearms meeting, not a zigzag. The first version read as a wave
    // at icon size; this one at least shows two hands coming together. It is
    // still the weakest glyph in the set — a handshake is hard at 24 units.
    'handshake':      { s: [['M', 1.5, 9, 5.5, 9, 10, 13.5, 8, 15.5, 5, 12.5], ['M', 22.5, 9, 18.5, 9, 14, 13.5, 16, 15.5, 19, 12.5], ['M', 10, 13.5, 12, 15.5, 14, 13.5]] },
    'team':           { s: [['C', 8, 8, 3.4], ['A', 8, 20, 5.6, 0.5, 1.0], ['C', 17, 9, 2.6], ['A', 17, 19, 4.4, 0.5, 1.0]] },
    'building':       { s: [['R', 4, 3, 16, 18, 2], ['M', 8, 7, 10, 7], ['M', 14, 7, 16, 7], ['M', 8, 12, 10, 12], ['M', 14, 12, 16, 12], ['M', 10, 21, 10, 16, 14, 16, 14, 21]] },
    'growth':         { s: [['M', 3, 18, 9, 11, 13, 15, 21, 5], ['M', 15, 5, 21, 5, 21, 11]] },
    // Compliance and reach. `shield` and `lock` earn their place because a
    // creator talking about privacy or security has no other way to say it.
    'shield':         { s: [['Z', 12, 2, 20, 5, 20, 11.5, 12, 22, 4, 11.5, 4, 5]] },
    'lock':           { s: [['R', 4, 10, 16, 11, 2.5], ['A', 12, 10, 5, 0.5, 1.0]], f: [['C', 12, 15.5, 1.5]] },
    'globe':          { s: [['C', 12, 12, 9.5], ['M', 2.5, 12, 21.5, 12], ['M', 12, 2.5, 8, 7, 7, 12, 8, 17, 12, 21.5], ['M', 12, 2.5, 16, 7, 17, 12, 16, 17, 12, 21.5]] },

    // ── analytics ──────────────────────────────────────────────────────────
    'chart-up':       { s: [['M', 3, 20, 3, 4], ['M', 3, 20, 21, 20], ['M', 6, 16, 11, 11, 14, 14, 20, 7]] },
    'chart-bar':      { s: [['M', 3, 21, 21, 21]], f: [['R', 5, 12, 4, 8, 1], ['R', 11, 7, 4, 13, 1], ['R', 17, 15, 4, 5, 1]] },
    'gauge':          { s: [['A', 12, 15, 9, 0.5, 1.0], ['M', 12, 15, 17, 10]] },
    'calculator':     { s: [['R', 4, 2, 16, 20, 3], ['R', 7, 5, 10, 4, 1], ['M', 8, 13, 8.01, 13], ['M', 12, 13, 12.01, 13], ['M', 16, 13, 16.01, 13], ['M', 8, 17, 8.01, 17], ['M', 12, 17, 12.01, 17], ['M', 16, 17, 16.01, 17]] },
    'clock':          { s: [['C', 12, 12, 9], ['M', 12, 7, 12, 12, 16, 14]] },
    'calendar':       { s: [['R', 3, 5, 18, 16, 3], ['M', 3, 10, 21, 10], ['M', 8, 2, 8, 6], ['M', 16, 2, 16, 6]] },

    // ── education ──────────────────────────────────────────────────────────
    'book':           { s: [['M', 4, 4, 11, 4, 12, 6, 12, 20, 11, 18, 4, 18, 4, 4], ['M', 20, 4, 13, 4, 12, 6], ['M', 20, 4, 20, 18, 13, 18, 12, 20]] },
    'bulb':           { s: [['A', 12, 10, 6, 0.55, 0.95], ['M', 7.6, 13.6, 9, 17, 15, 17, 16.4, 13.6], ['M', 9, 20, 15, 20]] },
    'cap':            { s: [['Z', 2, 9, 12, 4, 22, 9, 12, 14], ['M', 6, 11, 6, 17], ['M', 6, 17, 12, 20, 18, 17, 18, 11]] },
    'note':           { s: [['M', 5, 3, 15, 3, 19, 7, 19, 21, 5, 21, 5, 3], ['M', 15, 3, 15, 7, 19, 7], ['M', 8, 12, 16, 12], ['M', 8, 16, 14, 16]] },

    // ── creator tools ──────────────────────────────────────────────────────
    'camera':         { s: [['R', 2, 6, 20, 14, 3], ['C', 12, 13, 4], ['M', 8, 6, 10, 3, 14, 3, 16, 6]] },
    'video':          { s: [['R', 2, 6, 13, 12, 3], ['Z', 15, 12, 22, 8, 22, 16]] },
    'timeline':       { s: [['M', 2, 12, 22, 12], ['M', 7, 8, 7, 16], ['M', 13, 6, 13, 18], ['M', 19, 9, 19, 15]] },
    'headphones':     { s: [['A', 12, 12, 9, 0.5, 1.0], ['R', 2, 12, 5, 9, 2.4], ['R', 17, 12, 5, 9, 2.4]] },
    'scissors':       { s: [['M', 7, 7, 18, 18], ['M', 18, 6, 7, 17], ['C', 5.5, 5.5, 2.4], ['C', 5.5, 18.5, 2.4]] },
    'palette':        { s: [['A', 12, 12, 9.5, 0, 1.0], ['M', 12, 21.5, 15, 21.5, 15, 18, 19, 18]], f: [['C', 8, 9, 1.3], ['C', 12, 7, 1.3], ['C', 16, 9.5, 1.3]] },

    // ── reactions ──────────────────────────────────────────────────────────
    'check':          { s: [['M', 4, 13, 9, 18, 20, 6]] },
    'cross':          { s: [['M', 6, 6, 18, 18], ['M', 18, 6, 6, 18]] },
    'bang':           { s: [['Z', 12, 3, 22, 20, 2, 20], ['M', 12, 9, 12, 14]], f: [['C', 12, 17, 1.2]] },
    'question':       { s: [['A', 12, 9, 4, 0.55, 1.05], ['M', 12, 13, 12, 16]], f: [['C', 12, 19, 1.2]] },
    'star':           { f: [['Z', 12, 2.5, 14.9, 9.1, 21.5, 9.8, 16.5, 14.4, 18, 21, 12, 17.6, 6, 21, 7.5, 14.4, 2.5, 9.8, 9.1, 9.1]] },
    'heart':          { f: [['Z', 12, 21, 3, 12.5, 3, 7.5, 7.5, 5, 12, 8.5, 16.5, 5, 21, 7.5, 21, 12.5]] },
    'fire':           { s: [['M', 12, 2, 16, 7, 18, 12], ['A', 12, 14, 7, 0.85, 0.65], ['M', 12, 10, 14, 13], ['A', 12, 15.5, 3.4, 0.85, 0.65]] },
    'eye':            { s: [['Z', 2, 12, 7, 6, 17, 6, 22, 12, 17, 18, 7, 18], ['C', 12, 12, 3.2]] },
    'trophy':         { s: [['M', 7, 3, 17, 3, 16.5, 9, 12, 13, 7.5, 9, 7, 3], ['A', 5.4, 6, 2.6, 0.25, 0.75], ['A', 18.6, 6, 2.6, 0.75, 1.25], ['M', 12, 13, 12, 18], ['M', 9, 21, 10, 18, 14, 18, 15, 21], ['M', 7.5, 21, 16.5, 21]] },

    // ── decorative ─────────────────────────────────────────────────────────
    'sparkle':        { f: [['Z', 10, 2, 11.8, 7.6, 17.4, 9.4, 11.8, 11.2, 10, 16.8, 8.2, 11.2, 2.6, 9.4, 8.2, 7.6], ['Z', 18, 14, 19, 17, 22, 18, 19, 19, 18, 22, 17, 19, 14, 18, 17, 17]] },
    'arrow-right':    { s: [['M', 3, 12, 20, 12], ['M', 14, 6, 20, 12, 14, 18]] },
    'arrow-up-right': { s: [['M', 5, 19, 19, 5], ['M', 9, 5, 19, 5, 19, 15]] },
    'burst':          { s: [['M', 12, 2, 12, 7], ['M', 12, 17, 12, 22], ['M', 2, 12, 7, 12], ['M', 17, 12, 22, 12], ['M', 5, 5, 8.5, 8.5], ['M', 15.5, 15.5, 19, 19], ['M', 19, 5, 15.5, 8.5], ['M', 8.5, 15.5, 5, 19]] },
    'squiggle':       { s: [['M', 2, 14, 6, 9, 10, 15, 14, 9, 18, 15, 22, 10]] },
    'dots':           { f: [['C', 5, 12, 2], ['C', 12, 12, 2], ['C', 19, 12, 2]] },
    'rocket':         { s: [['Z', 12, 1.8, 15.6, 6, 16, 13, 12, 16.6, 8, 13, 8.4, 6], ['M', 8.2, 10.5, 5, 14, 5, 18, 8.6, 15.4], ['M', 15.8, 10.5, 19, 14, 19, 18, 15.4, 15.4], ['C', 12, 8, 2], ['M', 10.4, 17.2, 12, 22, 13.6, 17.2]] },
});
/* eslint-enable key-spacing */

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Is `name` a real icon? */
export function hasIcon(name) {
    return Object.prototype.hasOwnProperty.call(ICONS, String(name || ''));
}

/** One shape, in 24-unit space. Shared by the fill and stroke passes. */
function tracePath(ctx, cmd, u) {
    const [op, ...n] = cmd;
    ctx.beginPath();
    if (op === 'C') {
        ctx.arc(n[0] * u, n[1] * u, Math.max(0.01, n[2]) * u, 0, Math.PI * 2);
    } else if (op === 'A') {
        // Angles are TURNS, not radians. A hand-written icon table is read and
        // edited far more often than it is executed, and 0.25 is easier to get
        // right than Math.PI / 2.
        ctx.arc(n[0] * u, n[1] * u, Math.max(0.01, n[2]) * u, n[3] * Math.PI * 2, n[4] * Math.PI * 2);
    } else if (op === 'R') {
        const [x, y, w, h, r] = n;
        const rr = Math.min(num(r, 0) * u, (w * u) / 2, (h * u) / 2);
        ctx.moveTo(x * u + rr, y * u);
        ctx.arcTo((x + w) * u, y * u, (x + w) * u, (y + h) * u, rr);
        ctx.arcTo((x + w) * u, (y + h) * u, x * u, (y + h) * u, rr);
        ctx.arcTo(x * u, (y + h) * u, x * u, y * u, rr);
        ctx.arcTo(x * u, y * u, (x + w) * u, y * u, rr);
        ctx.closePath();
    } else {
        for (let i = 0; i + 1 < n.length; i += 2) {
            if (i === 0) ctx.moveTo(n[i] * u, n[i + 1] * u);
            else ctx.lineTo(n[i] * u, n[i + 1] * u);
        }
        if (op === 'Z') ctx.closePath();
    }
}

/**
 * Draw an icon at (0,0) in a `size` x `size` box.
 *
 * Returns true when something was drawn and false for an unknown name, so a
 * caller can fall back rather than leave a hole, and a check can tell the two
 * apart.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} name
 * @param {number} size   side of the box, in the caller's units
 * @param {{color?:string, weight?:number, alpha?:number}} [opts]
 */
export function drawIcon(ctx, name, size, opts = {}) {
    const icon = ICONS[String(name || '')];
    if (!ctx || !icon) return false;
    const s = Math.max(1, num(size, 24));
    const u = s / ICON_GRID;
    const color = opts.color || '#FFFFFF';
    // The stroke weight is in GRID units and scales with the icon, so a 32px
    // and a 320px icon look like the same drawing rather than the large one
    // looking hairline.
    const weight = Math.max(0.2, num(opts.weight, 2)) * u;

    ctx.save();
    if (Number.isFinite(Number(opts.alpha))) ctx.globalAlpha = Math.max(0, Math.min(1, Number(opts.alpha)));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = weight;

    for (const cmd of icon.f || []) {
        tracePath(ctx, cmd, u);
        ctx.fill();
    }
    for (const cmd of icon.s || []) {
        tracePath(ctx, cmd, u);
        ctx.stroke();
    }
    ctx.restore();
    return true;
}

/**
 * The words people actually use for an icon, mapped to its name. Never a
 * fuzzy match: handing back the wrong icon silently is worse than none.
 */
const ALIASES = Object.freeze({
    tick: 'check', checkmark: 'check', valid: 'check', coche: 'check', done: 'check',
    no: 'cross', wrong: 'cross', croix: 'cross', nope: 'cross',
    warning: 'bang', alert: 'bang', attention: 'bang', danger: 'bang',
    idea: 'bulb', lightbulb: 'bulb', ampoule: 'bulb', astuce: 'bulb', tip: 'bulb',
    loupe: 'search', magnifier: 'search', recherche: 'search', find: 'search',
    microphone: 'mic', micro: 'mic',
    message: 'chat', comment: 'chat', bubble: 'chat', commentaire: 'chat',
    email: 'mail', envelope: 'mail', courrier: 'mail',
    notification: 'bell', cloche: 'bell',
    money: 'growth', revenue: 'growth', croissance: 'growth', profit: 'growth',
    stats: 'chart-bar', graph: 'chart-bar', statistiques: 'chart-bar',
    people: 'team', users: 'team', equipe: 'team', audience: 'team',
    company: 'building', office: 'building', entreprise: 'building',
    goal: 'target', objectif: 'target', bullseye: 'target',
    love: 'heart', coeur: 'heart',
    hot: 'fire', trending: 'fire', feu: 'fire', viral: 'fire',
    views: 'eye', watch: 'eye', oeil: 'eye', vues: 'eye',
    cut: 'scissors', ciseaux: 'scissors',
    colour: 'palette', color: 'palette', couleur: 'palette',
    record: 'camera', appareil: 'camera',
    time: 'clock', timer: 'clock', horloge: 'clock',
    date: 'calendar', agenda: 'calendar', calendrier: 'calendar',
    learn: 'book', livre: 'book', read: 'book',
    student: 'cap', graduation: 'cap', diplome: 'cap',
    arrow: 'arrow-right', fleche: 'arrow-right',
    shine: 'sparkle', magic: 'sparkle', etincelle: 'sparkle',
    etoile: 'star', favourite: 'star', favorite: 'star',
    launch: 'rocket', ship: 'rocket', fusee: 'rocket', lancement: 'rocket',
    win: 'trophy', award: 'trophy', prize: 'trophy', trophee: 'trophy', coupe: 'trophy',
    secure: 'shield', security: 'shield', protect: 'shield', privacy: 'shield',
    rgpd: 'shield', gdpr: 'shield', securite: 'shield', protection: 'shield',
    locked: 'lock', password: 'lock', cadenas: 'lock', verrou: 'lock',
    world: 'globe', international: 'globe', monde: 'globe', web: 'globe', global: 'globe',
});

/** The icon a phrase names, or null. Exact names first, then the aliases. */
export function iconFromText(text) {
    const s = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!s.trim()) return null;
    // Longest first, so "chart-bar" wins over "chart-up" on "chart bar" and
    // "arrow-up-right" over "arrow-right".
    const names = [...ICON_NAMES].sort((a, b) => b.length - a.length);
    for (const name of names) {
        if (new RegExp(`\\b${name.replace(/-/g, '[ -]?')}\\b`).test(s)) return name;
    }
    for (const [alias, name] of Object.entries(ALIASES)) {
        if (new RegExp(`\\b${alias}\\b`).test(s)) return name;
    }
    return null;
}

export default {
    ICON_GRID, ICON_GROUPS, ICON_NAMES, ICONS, ICON_COMMANDS,
    groupOf, hasIcon, drawIcon, iconFromText,
};
