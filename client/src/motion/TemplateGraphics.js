/**
 * client/src/motion/TemplateGraphics.js
 *
 * R89 (to-do A5) — animated template components: flip counter ("JOUR 14/30"),
 * number/price pop ("15-20€"), logo card, code-typing window.
 *
 * ONE drawing function per template, called by BOTH renderers:
 *   - the preview (Player/TemplateCanvas.jsx) draws every frame on a <canvas>;
 *   - the export (server/compositor/TemplateRenderer.js) imports this same file
 *     and draws every output frame with @napi-rs/canvas (Skia, like Chrome).
 * Only standard Canvas 2D calls, no imports, no DOM: it must run in both.
 *
 * Sizes are in REFERENCE pixels (a 1080-wide frame). A template clip lives on
 * the overlay track; its box (x, y, scale, rotation, motion presets) is placed
 * exactly like a sticker, and these functions only draw INSIDE the box.
 */

export const TEMPLATE_KINDS = ['counter', 'price-pop', 'logo-card', 'code-window',
    // R92: vector shapes
    'highlight-box', 'underline', 'circle-callout', 'arrow', 'progress-bar', 'bar-chart', 'burst',
    // Creative Suite additions
    'line-graph', 'circular-meter', 'data-counter', 'film-grain', 'vhs-glitch', 'light-leak',
    // Online trend additions (Talking Head, Vlog, Short Form, Repurposing)
    'lower-third-minimal', 'location-badge', 'retention-progress-bar', 'quote-card',
    // Expanded Motion Catalog (Editorial, Social Proof, Comparison, KPI)
    'comparison-card', 'social-notification', 'comment-bubble', 'kpi-stat-callout', 'newspaper-headline', 'search-bar'];

/** R92: the shape kinds (drawn strokes and charts, not cards). */
export const SHAPE_KINDS = ['highlight-box', 'underline', 'circle-callout', 'arrow', 'progress-bar', 'bar-chart', 'burst',
    'line-graph', 'circular-meter', 'data-counter', 'film-grain', 'vhs-glitch', 'light-leak'];

export const TEMPLATE_FONTS = Object.freeze({
    display: 'Anton',          // client/public/fonts/Anton-Regular.ttf
    label: 'Montserrat',       // client/public/fonts/Montserrat-Bold.ttf
    body: 'Inter',             // client/public/fonts/Inter-Regular.ttf
    mono: 'JetBrains Mono',    // latin subset woff2 (index.css)
});

export const TEMPLATE_DEFAULTS = {
    'counter':     { label: 'DAY', value: 14, total: 30, from: null, accent: '#FFE500' },
    'price-pop':   { text: '15-20€', color: '#FFE500', sub: '' },
    'logo-card':   { label: 'Your brand', sub: '', imageUrl: null, accent: '#00E5FF' },
    'code-window': { title: 'index.js', code: "const views = await post('reel');\nif (views > 1e6) celebrate();", cps: 28 },
    'highlight-box':  { color: '#FFE500', thickness: 10, fill: false },
    'underline':      { color: '#FFE500', thickness: 18 },
    'circle-callout': { color: '#FF3B5C', thickness: 10 },
    'arrow':          { color: '#FFFFFF', thickness: 14, direction: 'right', curve: 0.25 },
    'progress-bar':   { label: 'Progress', value: 72, color: '#00E5FF' },
    'bar-chart':      { values: '35,60,90', labels: 'Before,During,After', color: '#00E5FF', accent: '#FFE500' },
    'burst':          { color: '#FFE500', thickness: 12, rays: 12 },
    // Creative Suite additions
    'line-graph':     { values: '20,45,35,70,95', labels: 'Q1,Q2,Q3,Q4,Target', color: '#00E5FF', accent: '#FFE500' },
    'circular-meter': { value: 84, label: 'GROWTH', color: '#00E5FF', accent: '#10B981' },
    'data-counter':   { prefix: '$', value: 250000, suffix: '', label: 'NET REVENUE', color: '#10B981' },
    'film-grain':     { intensity: 0.15 },
    'vhs-glitch':     { lines: 4, intensity: 0.25, color: '#00E5FF' },
    'light-leak':     { color: '#FFA500' },
    // Online trend additions
    'lower-third-minimal': { name: 'Dr. Sarah Chen', role: 'Lead AI Researcher', color: '#00E5FF' },
    'location-badge':      { location: 'Tokyo, Shibuya', time: '09:42 AM', color: '#FF3B5C' },
    'retention-progress-bar': { label: 'Keep Watching', value: 75, color: '#00E5FF', accent: '#FFE500' },
    'quote-card':          { quote: 'Focus on leverage, not just hours.', author: 'Naval Ravikant', color: '#FFE500' },
    // Expanded Motion Catalog
    'comparison-card':     { beforeLabel: 'BEFORE', beforeVal: '14 Hours', afterLabel: 'AFTER', afterVal: '35 Mins', color: '#00E5FF', accent: '#10B981' },
    'social-notification': { title: 'NEW SUBSCRIBER', subtitle: '@alex started following you', color: '#FF3B5C', accent: '#FFFFFF' },
    'comment-bubble':      { user: '@marcus_dev', text: 'How do you structure this without ads?', color: '#38BDF8' },
    'kpi-stat-callout':     { stat: '+184%', label: 'ORGANIC RETENTION RATE', color: '#10B981', accent: '#38BDF8' },
    'newspaper-headline':  { publication: 'THE TECH DISPATCH', headline: 'AI OVERHAULS CREATOR PRODUCTION', highlight: 'OVERHAULS', date: 'OCTOBER 2026' },
    'search-bar':          { query: 'how to edit viral videos', placeholder: 'Search Google...', color: '#00E5FF' },
};

/** Width as a fraction of the frame, the size a new template is dropped at. */
export const TEMPLATE_WIDTH_FRACTION = {
    'counter': 0.5, 'price-pop': 0.62, 'logo-card': 0.72, 'code-window': 0.86,
    'highlight-box': 0.7, 'underline': 0.6, 'circle-callout': 0.45, 'arrow': 0.4,
    'progress-bar': 0.8, 'bar-chart': 0.8, 'burst': 0.35,
    'line-graph': 0.85, 'circular-meter': 0.5, 'data-counter': 0.6,
    'film-grain': 1.0, 'vhs-glitch': 1.0, 'light-leak': 1.0,
    'lower-third-minimal': 0.75, 'location-badge': 0.55, 'retention-progress-bar': 0.88, 'quote-card': 0.82,
    'comparison-card': 0.85, 'social-notification': 0.72, 'comment-bubble': 0.82,
    'kpi-stat-callout': 0.78, 'newspaper-headline': 0.86, 'search-bar': 0.80,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

export function templateParams(kind, params) {
    return { ...(TEMPLATE_DEFAULTS[kind] || {}), ...(params || {}) };
}

function splitLines(code) {
    return String(code || '').replace(/\t/g, '  ').split('\n').slice(0, 14).map(l => l.slice(0, 48));
}

/** Natural size of a template in reference pixels. */
export function templateSize(kind, params) {
    const p = templateParams(kind, params);
    switch (kind) {
        case 'counter': return { w: 540, h: 300 };
        case 'price-pop': return { w: 680, h: 300 };
        case 'logo-card': return { w: 780, h: 210 };
        case 'code-window': {
            const lines = Math.max(2, splitLines(p.code).length);
            return { w: 930, h: 110 + lines * 54 + 40 };
        }
        case 'highlight-box': return { w: 800, h: 300 };
        case 'underline': return { w: 800, h: 70 };
        case 'circle-callout': return { w: 600, h: 400 };
        case 'arrow': return (p.direction === 'up' || p.direction === 'down') ? { w: 260, h: 600 } : { w: 600, h: 260 };
        case 'progress-bar': return { w: 900, h: 150 };
        case 'bar-chart': return { w: 900, h: 560 };
        case 'burst': return { w: 400, h: 400 };
        case 'line-graph': return { w: 900, h: 560 };
        case 'circular-meter': return { w: 500, h: 500 };
        case 'data-counter': return { w: 700, h: 280 };
        case 'film-grain': return { w: 1080, h: 1920 };
        case 'vhs-glitch': return { w: 1080, h: 1920 };
        case 'light-leak': return { w: 1080, h: 1920 };
        case 'lower-third-minimal': return { w: 780, h: 160 };
        case 'location-badge': return { w: 560, h: 110 };
        case 'retention-progress-bar': return { w: 920, h: 100 };
        case 'quote-card': return { w: 840, h: 300 };
        case 'comparison-card': return { w: 860, h: 220 };
        case 'social-notification': return { w: 680, h: 140 };
        case 'comment-bubble': return { w: 800, h: 200 };
        case 'kpi-stat-callout': return { w: 760, h: 210 };
        case 'newspaper-headline': return { w: 880, h: 260 };
        case 'search-bar': return { w: 780, h: 130 };
        default: return { w: 400, h: 200 };
    }
}

/** Envelope: pop/slide in over `inDur`, out over `outDur` before the end. */
function envelope(t, duration, inDur, outDur) {
    const tin = clamp(t / inDur, 0, 1);
    const tout = clamp((duration - t) / outDur, 0, 1);
    return { tin, tout };
}

function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

// ─── counter ────────────────────────────────────────────────────────────────

function drawCounter(ctx, p, t, duration, F) {
    const { w, h } = templateSize('counter', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const s = easeOutBack(tin) * (0.85 + 0.15 * tout);
    const alpha = Math.min(1, tin * 3) * tout;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);

    // Card
    ctx.fillStyle = 'rgba(12,12,16,0.92)';
    roundRect(ctx, 6, 6, w - 12, h - 12, 34);
    ctx.fill();

    // Label
    ctx.fillStyle = p.accent || '#FFE500';
    ctx.font = `44px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(p.label || '').toUpperCase().slice(0, 14), w / 2, 76);

    // Digits: count from `from` (default value-6) to `value` over 0.9 s.
    const value = Math.max(0, Math.round(Number(p.value) || 0));
    const from = Number.isFinite(Number(p.from)) && p.from !== null ? Math.max(0, Math.round(Number(p.from))) : Math.max(0, value - 6);
    const steps = Math.max(0, value - from);
    const k = clamp((t - 0.25) / 0.9, 0, 1) * steps;
    const shown = from + Math.floor(k);
    const flip = steps > 0 && shown < value ? k - Math.floor(k) : 1;
    const next = Math.min(value, shown + 1);
    const digitsNow = String(shown);
    const digitsNext = String(next);
    const nDigits = Math.max(digitsNow.length, digitsNext.length, String(value).length);
    const total = p.total !== null && p.total !== '' && Number.isFinite(Number(p.total)) ? `/${Math.round(Number(p.total))}` : '';

    const tileW = 96, tileH = 140, gap = 12;
    ctx.font = `150px "${F.display}"`;
    const totalW = total ? ctx.measureText(total).width * 0.55 + 14 : 0;
    const digitsW = nDigits * tileW + (nDigits - 1) * gap;
    let x = (w - (digitsW + totalW)) / 2;
    const y = 104;

    for (let i = 0; i < nDigits; i++) {
        const a = digitsNow.padStart(nDigits, ' ')[i];
        const b = digitsNext.padStart(nDigits, ' ')[i];
        // Tile
        ctx.fillStyle = '#1D1D26';
        roundRect(ctx, x, y, tileW, tileH, 14);
        ctx.fill();
        const drawHalf = (ch, top, scaleY) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, top ? y : y + tileH / 2, tileW, tileH / 2);
            ctx.clip();
            const cy = y + tileH / 2;
            ctx.translate(0, cy);
            ctx.scale(1, scaleY);
            ctx.translate(0, -cy);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `120px "${F.display}"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (ch.trim()) ctx.fillText(ch, x + tileW / 2, cy + 4);
            ctx.restore();
        };
        if (a === b || flip >= 1) {
            drawHalf(flip >= 1 ? b : a, true, 1);
            drawHalf(flip >= 1 ? b : a, false, 1);
        } else {
            // Split-flap: new top behind, old bottom until the flap passes.
            drawHalf(b, true, 1);
            drawHalf(a, false, 1);
            if (flip < 0.5) drawHalf(a, true, 1 - flip * 2);       // old top folding down
            else drawHalf(b, false, (flip - 0.5) * 2);             // new bottom unfolding
        }
        // Hinge line
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y + tileH / 2 - 2, tileW, 4);
        x += tileW + gap;
    }
    if (total) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `82px "${F.display}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(total, x + 2, y + tileH - 12);
    }
    ctx.restore();
}

// ─── price / number pop ─────────────────────────────────────────────────────

function drawPricePop(ctx, p, t, duration, F) {
    const { w, h } = templateSize('price-pop', p);
    const { tin, tout } = envelope(t, duration, 0.38, 0.2);
    if (tout <= 0 || tin <= 0) return;
    const pop = easeOutBack(tin);
    const s = pop * (0.6 + 0.4 * easeOutCubic(tout));
    const wobble = tin >= 1 ? Math.sin((t - 0.38) * 5) * 0.012 : 0;
    const cx = w / 2, cy = h / 2;

    ctx.save();
    ctx.globalAlpha = Math.min(1, tin * 4) * tout;

    // Burst rays during the pop
    if (t < 0.7) {
        const r = clamp(t / 0.7, 0, 1);
        ctx.save();
        ctx.strokeStyle = p.color || '#FFE500';
        ctx.lineCap = 'round';
        ctx.lineWidth = 12 * (1 - r);
        for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2 + 0.3;
            const r0 = 120 + 160 * easeOutCubic(r);
            const r1 = r0 + 60 * (1 - r);
            ctx.globalAlpha = (1 - r) * tout;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ang) * r0 * 1.6, cy + Math.sin(ang) * r0 * 0.7);
            ctx.lineTo(cx + Math.cos(ang) * r1 * 1.6, cy + Math.sin(ang) * r1 * 0.7);
            ctx.stroke();
        }
        ctx.restore();
    }

    ctx.translate(cx, cy);
    ctx.rotate(-0.06 + wobble);
    ctx.scale(s, s);
    const text = String(p.text || '').slice(0, 14);
    let size = 190;
    ctx.font = `${size}px "${F.display}"`;
    const maxW = w * 0.9;
    const mw = ctx.measureText(text).width;
    if (mw > maxW) { size = Math.floor(size * maxW / mw); ctx.font = `${size}px "${F.display}"`; }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Hard drop shadow, thick outline, fill
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, 10, 14);
    ctx.strokeStyle = '#0A0A0E';
    ctx.lineWidth = size * 0.14;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = p.color || '#FFE500';
    ctx.fillText(text, 0, 0);
    if (p.sub) {
        ctx.font = `40px "${F.label}"`;
        ctx.fillStyle = '#FFFFFF';
        ctx.lineWidth = 8;
        ctx.strokeText(String(p.sub).slice(0, 28), 0, size * 0.62);
        ctx.fillText(String(p.sub).slice(0, 28), 0, size * 0.62);
    }
    ctx.restore();
}

// ─── logo card ──────────────────────────────────────────────────────────────

function drawLogoCard(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('logo-card', p);
    const { tin, tout } = envelope(t, duration, 0.45, 0.3);
    if (tin <= 0 || tout <= 0) return;
    const slide = (1 - easeOutCubic(tin)) * -w * 0.25 + (1 - easeOutCubic(tout)) * w * 0.08;
    ctx.save();
    ctx.globalAlpha = Math.min(1, tin * 2) * tout;
    ctx.translate(slide, 0);

    ctx.fillStyle = 'rgba(14,14,18,0.94)';
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fill();
    // Accent bar grows in
    ctx.fillStyle = p.accent || '#00E5FF';
    roundRect(ctx, 6, 6, 14, (h - 12) * easeOutCubic(clamp((t - 0.2) / 0.4, 0, 1)), 7);
    ctx.fill();

    // Logo tile
    const tile = h - 60;
    const tx = 44, ty = 30;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, tx, ty, tile, tile, 28);
    ctx.fill();
    const img = images && p.imageUrl ? images[p.imageUrl] : null;
    if (img && img.width > 0 && img.height > 0) {
        const pad = 16;
        const box = tile - pad * 2;
        const r = Math.min(box / img.width, box / img.height);
        const iw = img.width * r, ih = img.height * r;
        ctx.save();
        roundRect(ctx, tx, ty, tile, tile, 28);
        ctx.clip();
        ctx.drawImage(img, tx + (tile - iw) / 2, ty + (tile - ih) / 2, iw, ih);
        ctx.restore();
    } else {
        ctx.fillStyle = '#0E0E12';
        ctx.font = `72px "${F.display}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(p.label || '?').trim().charAt(0).toUpperCase(), tx + tile / 2, ty + tile / 2 + 4);
    }

    // Text, revealed left to right
    const reveal = easeOutCubic(clamp((t - 0.25) / 0.5, 0, 1));
    const textX = tx + tile + 34;
    ctx.save();
    ctx.beginPath();
    ctx.rect(textX, 0, (w - textX - 30) * reveal, h);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `62px "${F.label}"`;
    ctx.fillText(String(p.label || '').slice(0, 22), textX, p.sub ? h / 2 + 6 : h / 2 + 22);
    if (p.sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `36px "${F.body}"`;
        ctx.fillText(String(p.sub).slice(0, 34), textX, h / 2 + 56);
    }
    ctx.restore();
    ctx.restore();
}

// ─── code window ────────────────────────────────────────────────────────────

const KEYWORDS = new Set(('const let var function return if else for while do switch case break continue import from export default class new await async try catch finally throw typeof instanceof in of this null undefined true false def print elif lambda yield').split(' '));

/** Tokens with colours for one line (very small highlighter: enough for a reel). */
export function highlightLine(line) {
    const out = [];
    const re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?(?:e\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        if (m[1]) out.push({ text: m[1], color: '#6B7089' });
        else if (m[2]) out.push({ text: m[2], color: '#A6E3A1' });
        else if (m[3]) out.push({ text: m[3], color: '#FAB387' });
        else if (m[4]) out.push({ text: m[4], color: KEYWORDS.has(m[4]) ? '#CBA6F7' : (line[re.lastIndex] === '(' ? '#89B4FA' : '#CDD6F4') });
        else out.push({ text: m[5] || m[6], color: '#CDD6F4' });
        if (m[0] === '') re.lastIndex++;
    }
    return out;
}

function drawCodeWindow(ctx, p, t, duration, F) {
    const { w, h } = templateSize('code-window', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    if (tin <= 0 || tout <= 0) return;
    const s = 0.92 + 0.08 * easeOutCubic(tin);
    ctx.save();
    ctx.globalAlpha = Math.min(1, tin * 2.5) * tout;
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);

    ctx.fillStyle = '#1E1E2E';
    roundRect(ctx, 6, 6, w - 12, h - 12, 26);
    ctx.fill();
    ctx.fillStyle = '#181825';
    roundRect(ctx, 6, 6, w - 12, 76, 26);
    ctx.fill();
    ctx.fillRect(6, 56, w - 12, 26);
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(46 + i * 38, 44, 12, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = 'rgba(205,214,244,0.7)';
    ctx.font = `30px "${F.body}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.title || '').slice(0, 30), w / 2, 46);

    // Typing
    const lines = splitLines(p.code);
    const cps = clamp(Number(p.cps) || 28, 4, 200);
    let budget = Math.max(0, Math.floor((t - 0.35) * cps));
    ctx.font = `36px "${F.mono}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const x0 = 48;
    let y = 150;
    let cursor = null;
    for (const line of lines) {
        if (budget <= 0 && cursor) break;
        let x = x0;
        const visible = line.slice(0, Math.max(0, budget));
        for (const tok of highlightLine(visible)) {
            ctx.fillStyle = tok.color;
            ctx.fillText(tok.text, x, y);
            x += ctx.measureText(tok.text).width;
        }
        cursor = { x, y };
        budget -= line.length + 1;
        if (budget < 0) break;
        y += 54;
    }
    // Blinking cursor (solid while typing)
    const typing = budget < 0;
    if (cursor && (typing || Math.floor(t * 2) % 2 === 0)) {
        ctx.fillStyle = '#F5E0DC';
        ctx.fillRect(cursor.x + 2, cursor.y - 32, 18, 40);
    }
    ctx.restore();
}

// ─── R92: vector shapes (highlight box, underline, circle, arrow, bars) ─────
//
// The SHAPE layer kind had no renderer before R92. These are drawn with plain
// Canvas 2D paths, so the preview and the Skia export draw the same pixels.
// Every shape "draws on" (stroke reveal), holds, then fades in the last
// 0.25 s, like the strokes a motion designer animates by hand.

const SHAPE_IN = 0.55;
const SHAPE_OUT = 0.25;

/** Stroke a path progressively: p = 0..1 of its length. */
function strokeProgress(ctx, length, p) {
    const L = Math.max(1, length);
    ctx.setLineDash([L, L]);
    ctx.lineDashOffset = L * (1 - clamp(p, 0, 1));
    ctx.stroke();
    ctx.setLineDash([]);
}

function shapeAlpha(t, duration) {
    return clamp((duration - t) / SHAPE_OUT, 0, 1);
}

function shapeStroke(ctx, p) {
    ctx.strokeStyle = p.color || '#FFE500';
    ctx.lineWidth = clamp(Number(p.thickness) || 10, 2, 40);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function drawHighlightBox(ctx, p, t, duration) {
    const { w, h } = templateSize('highlight-box', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const lw = clamp(Number(p.thickness) || 10, 2, 40);
    const x = lw, y = lw, bw = w - lw * 2, bh = h - lw * 2, r = Math.min(28, bh / 3);
    const prog = easeOutCubic(clamp(t / SHAPE_IN, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    if (p.fill) {
        ctx.globalAlpha = a * 0.22 * prog;
        ctx.fillStyle = p.color || '#FFE500';
        roundRect(ctx, x, y, bw, bh, r);
        ctx.fill();
        ctx.globalAlpha = a;
    }
    shapeStroke(ctx, p);
    // A gentle glow pulse once the box is drawn.
    const pulse = t > SHAPE_IN ? 0.5 + 0.5 * Math.sin((t - SHAPE_IN) * 4) : 0;
    ctx.shadowColor = p.color || '#FFE500';
    ctx.shadowBlur = 6 + 10 * pulse;
    roundRect(ctx, x, y, bw, bh, r);
    strokeProgress(ctx, 2 * (bw + bh), prog);
    ctx.restore();
}

function drawUnderline(ctx, p, t, duration) {
    const { w, h } = templateSize('underline', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / (SHAPE_IN * 0.8), 0, 1));
    ctx.save();
    ctx.globalAlpha = a * 0.92;
    shapeStroke(ctx, { ...p, thickness: Number(p.thickness) || 18 });
    ctx.beginPath();
    const y0 = h * 0.62, y1 = h * 0.42;
    ctx.moveTo(20, y0);
    ctx.quadraticCurveTo(w * 0.5, h * 0.3, w - 20, y1);
    strokeProgress(ctx, w * 1.02, prog);
    ctx.restore();
}

function drawCircleCallout(ctx, p, t, duration) {
    const { w, h } = templateSize('circle-callout', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / SHAPE_IN, 0, 1));
    const lw = clamp(Number(p.thickness) || 10, 2, 40);
    const rx = w / 2 - lw * 1.5, ry = h / 2 - lw * 1.5;
    ctx.save();
    ctx.globalAlpha = a;
    shapeStroke(ctx, p);
    ctx.beginPath();
    // Slightly more than a full turn with a drifting radius: reads as drawn by hand.
    const turns = 1.08;
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const ang = -Math.PI * 0.6 + k * Math.PI * 2 * turns;
        const wob = 1 + 0.035 * Math.sin(k * 9) - 0.03 * k;
        const px = w / 2 + Math.cos(ang) * rx * wob;
        const py = h / 2 + Math.sin(ang) * ry * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) * turns;
    strokeProgress(ctx, perim, prog);
    ctx.restore();
}

function drawArrow(ctx, p, t, duration) {
    const { w, h } = templateSize('arrow', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / SHAPE_IN, 0, 1));
    const dir = ['left', 'right', 'up', 'down'].includes(p.direction) ? p.direction : 'right';
    const curve = clamp(Number(p.curve) || 0.25, -0.6, 0.6);
    ctx.save();
    ctx.globalAlpha = a;
    // Draw a left→right arrow, rotated for the other directions.
    ctx.translate(w / 2, h / 2);
    const rot = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir];
    ctx.rotate(rot);
    const len = (dir === 'up' || dir === 'down') ? h : w;
    const half = len / 2 - 30;
    shapeStroke(ctx, { ...p, thickness: Number(p.thickness) || 14 });
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    const cy = -len * curve;
    ctx.quadraticCurveTo(0, cy, half, 0);
    strokeProgress(ctx, len * (1 + Math.abs(curve) * 0.6), prog);
    // Head pops in once the shaft arrives.
    const head = clamp((t - SHAPE_IN * 0.8) / 0.18, 0, 1);
    if (head > 0) {
        const s = easeOutBack(head) * 34;
        const ang = Math.atan2(0 - cy / 2, half);
        ctx.beginPath();
        ctx.moveTo(half - Math.cos(ang - 0.5) * s, -Math.sin(ang - 0.5) * s);
        ctx.lineTo(half, 0);
        ctx.lineTo(half - Math.cos(ang + 0.5) * s, -Math.sin(ang + 0.5) * s);
        ctx.stroke();
    }
    ctx.restore();
}

function drawProgressBar(ctx, p, t, duration, F) {
    const { w } = templateSize('progress-bar', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const appear = easeOutCubic(clamp(t / 0.3, 0, 1));
    const value = clamp(Number(p.value), 0, 100);
    const fill = easeOutCubic(clamp((t - 0.2) / 1.0, 0, 1)) * value;
    ctx.save();
    ctx.globalAlpha = a * appear;
    const barY = 86, barH = 46;
    ctx.font = `40px "${F.label}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText(String(p.label || '').slice(0, 28), 8, 58);
    ctx.textAlign = 'right';
    ctx.fillStyle = p.color || '#00E5FF';
    ctx.fillText(`${Math.round(fill)}%`, w - 8, 58);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, 6, barY, w - 12, barH, barH / 2);
    ctx.fill();
    if (fill > 0) {
        ctx.fillStyle = p.color || '#00E5FF';
        roundRect(ctx, 6, barY, Math.max(barH, (w - 12) * (fill / 100)), barH, barH / 2);
        ctx.fill();
    }
    ctx.restore();
}

function parseList(v, max) {
    return String(v ?? '').split(',').map(s => s.trim()).filter(s => s.length > 0).slice(0, max);
}

function drawBarChart(ctx, p, t, duration, F) {
    const { w, h } = templateSize('bar-chart', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const values = parseList(p.values, 6).map(Number).map(v => (Number.isFinite(v) ? v : 0));
    if (values.length === 0) return;
    const labels = parseList(p.labels, 6);
    const max = Math.max(1, ...values.map(Math.abs));
    const n = values.length;
    const gap = 26;
    const top = 70, bottom = h - 70;
    const bw = (w - gap * (n + 1)) / n;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gap / 2, bottom + 2);
    ctx.lineTo(w - gap / 2, bottom + 2);
    ctx.stroke();
    values.forEach((v, i) => {
        // Staggered growth: each bar starts 0.12 s after the previous one.
        const g = easeOutBack(clamp((t - 0.15 - i * 0.12) / 0.6, 0, 1));
        const bh = Math.max(0, (bottom - top) * (Math.abs(v) / max) * g);
        const x = gap + i * (bw + gap);
        ctx.fillStyle = i === values.indexOf(Math.max(...values)) ? (p.accent || '#FFE500') : (p.color || '#00E5FF');
        roundRect(ctx, x, bottom - bh, bw, Math.max(bh, 0.01), Math.min(14, bw / 4));
        ctx.fill();
        if (g > 0.6) {
            ctx.globalAlpha = a * clamp((g - 0.6) / 0.4, 0, 1);
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.font = `36px "${F.label}"`;
            ctx.fillText(String(Math.round(v * 10) / 10), x + bw / 2, bottom - bh - 14);
            ctx.globalAlpha = a;
        }
        if (labels[i]) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.textAlign = 'center';
            ctx.font = `30px "${F.body}"`;
            ctx.fillText(labels[i].slice(0, 10), x + bw / 2, bottom + 44);
        }
    });
    ctx.restore();
}

function drawBurst(ctx, p, t, duration) {
    const { w, h } = templateSize('burst', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const rays = clamp(Math.round(Number(p.rays) || 12), 4, 24);
    // Rays shoot out with an overshoot, then hold and turn slowly.
    const outer = easeOutBack(clamp(t / 0.45, 0, 1));
    const inner = easeOutCubic(clamp((t - 0.1) / 0.5, 0, 1));
    const R = Math.min(w, h) / 2 - 16;
    ctx.save();
    ctx.globalAlpha = a;
    shapeStroke(ctx, { ...p, thickness: Number(p.thickness) || 12 });
    ctx.translate(w / 2, h / 2);
    ctx.rotate(t * 0.25);
    for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2;
        const r0 = R * (0.3 + 0.25 * inner);
        const r1 = R * Math.min(1, 0.35 + 0.65 * outer);
        if (r1 <= r0) continue;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
        ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
        ctx.stroke();
    }
    ctx.restore();
}

function drawLineGraph(ctx, p, t, duration, F) {
    const { w, h } = templateSize('line-graph', p);
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const vals = String(p.values || '20,45,35,70,95').split(',').map(v => Number(v.trim())).filter(Number.isFinite);
    if (vals.length < 2) return;
    const labels = String(p.labels || '').split(',').map(s => s.trim());
    const maxVal = Math.max(...vals, 1);
    const prog = easeOutCubic(clamp(t / (duration * 0.4), 0, 1));

    ctx.save();
    ctx.globalAlpha = a;

    // Card background
    ctx.fillStyle = 'rgba(15,18,28,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 6, 6, w - 12, h - 12, 28);
    ctx.fill();
    ctx.stroke();

    const padX = 70;
    const padY = 60;
    const chartW = w - padX * 2;
    const chartH = h - padY * 2 - 40;
    const stepX = chartW / (vals.length - 1);

    const pts = vals.map((v, i) => {
        const px = padX + i * stepX;
        const norm = (v / maxVal) * prog;
        const py = padY + chartH - norm * chartH;
        return { x: px, y: py };
    });

    // Area fill under curve
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, padY + chartH);
    pts.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(pts[pts.length - 1].x, padY + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padY, 0, padY + chartH);
    grad.addColorStop(0, p.color ? `${p.color}55` : 'rgba(0,229,255,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Line stroke
    ctx.save();
    ctx.strokeStyle = p.color || '#00E5FF';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = p.color || '#00E5FF';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    pts.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();

    // Data points & labels
    pts.forEach((pt, i) => {
        ctx.fillStyle = p.accent || '#FFE500';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
        ctx.fill();

        if (labels[i]) {
            ctx.fillStyle = '#94A3B8';
            ctx.font = `20px "${F.body}"`;
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], pt.x, h - padY + 15);
        }
    });

    ctx.restore();
}

function drawCircularMeter(ctx, p, t, duration, F) {
    const { w, h } = templateSize('circular-meter', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const targetVal = clamp(Number(p.value) || 84, 0, 100);
    const prog = easeOutCubic(clamp(t / (duration * 0.45), 0, 1));
    const curVal = Math.round(targetVal * prog);

    ctx.save();
    ctx.globalAlpha = a;

    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 30;
    ctx.fillStyle = 'rgba(15,18,28,0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI * 0.75, Math.PI * 0.75);
    ctx.stroke();

    const startAng = -Math.PI * 0.75;
    const totalAng = Math.PI * 1.5;
    const endAng = startAng + totalAng * (curVal / 100);
    ctx.strokeStyle = p.color || '#00E5FF';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.shadowColor = p.color || '#00E5FF';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 84px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${curVal}%`, cx, cy - 10);

    if (p.label) {
        ctx.fillStyle = p.accent || '#10B981';
        ctx.font = `bold 24px "${F.label}"`;
        ctx.fillText(String(p.label).toUpperCase(), cx, cy + 55);
    }
    ctx.restore();
}

function drawDataCounter(ctx, p, t, duration, F) {
    const { w, h } = templateSize('data-counter', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const target = Number(p.value) || 250000;
    const prog = easeOutCubic(clamp(t / (duration * 0.4), 0, 1));
    const cur = Math.round(target * prog);
    const formatted = cur.toLocaleString('en-US');

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(12,15,24,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 6, 6, w - 12, h - 12, 28);
    ctx.fill();
    ctx.stroke();

    if (p.label) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = `bold 22px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.fillText(String(p.label).toUpperCase(), w / 2, 60);
    }

    ctx.fillStyle = p.color || '#10B981';
    ctx.font = `900 88px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = p.color || '#10B981';
    ctx.shadowBlur = 16;
    const prefix = p.prefix || '';
    const suffix = p.suffix || '';
    ctx.fillText(`${prefix}${formatted}${suffix}`, w / 2, h - 60);
    ctx.restore();
}

function drawFilmGrain(ctx, p, t, duration) {
    const { w, h } = templateSize('film-grain', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // 1. Cinematic 35mm letterbox frame
    const barH = 50;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.96)';
    ctx.fillRect(0, 0, w, barH);
    ctx.fillRect(0, h - barH, w, barH);

    // Film stock margin label
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
    ctx.fillText('35MM KODAK 500T · RAW', 36, 32);

    // 2. High-density deterministic grain specks
    const seed = Math.floor(t * 24);
    for (let i = 0; i < 800; i++) {
        const gx = ((Math.sin(seed * 99 + i * 13) * 10000) % 1 + 1) % 1 * w;
        const gy = ((Math.cos(seed * 77 + i * 17) * 10000) % 1 + 1) % 1 * (h - barH * 2) + barH;
        const gw = (i % 3) + 1;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.88)' : 'rgba(15, 15, 20, 0.88)';
        ctx.fillRect(gx, gy, gw, gw);
    }
    ctx.restore();
}

function drawVhsGlitch(ctx, p, t, duration) {
    const { w, h } = templateSize('vhs-glitch', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // 1. VHS tracking noise band (solid noise block, height 68px = 3.5% of 1920)
    const bandH = 68;
    const trackY = Math.floor(((t * 2.5) % 1) * (h - bandH));
    ctx.fillStyle = 'rgba(240, 245, 255, 0.92)';
    ctx.fillRect(0, trackY, w, bandH);

    // Static noise lines within tracking band
    ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    for (let i = 0; i < 6; i++) {
        const ny = trackY + i * 11;
        ctx.fillRect(0, ny, w, 4);
    }

    // 2. VHS OSD Header
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = 'bold 32px monospace';
    ctx.fillText('PLAY ▶', 40, 60);
    ctx.fillText('SP 00:24:19', 40, 105);

    // 3. Chromatic scanline glitches
    const lines = clamp(Number(p.lines) || 4, 1, 10);
    for (let i = 0; i < lines; i++) {
        const ly = ((t * 280 + i * (h / lines)) % h);
        ctx.fillStyle = p.color || '#00E5FF';
        ctx.fillRect(0, ly, w, 3);
    }
    ctx.restore();
}

function drawLightLeak(ctx, p, t, duration) {
    const { w, h } = templateSize('light-leak', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = (t % 3) / 3;
    const lx = prog * (w + 400) - 200;
    const ly = h * 0.35;
    ctx.save();
    ctx.globalAlpha = a;

    // Glowing warm anamorphic flare core with alpha > 200 covering > 5% of screen
    const grad = ctx.createRadialGradient(lx, ly, 30, lx, ly, 500);
    grad.addColorStop(0, '#FFF5CC');
    grad.addColorStop(0.2, p.color || '#FFA500');
    grad.addColorStop(0.45, 'rgba(255, 70, 0, 0.88)');
    grad.addColorStop(0.75, 'rgba(255, 20, 50, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}

function drawLowerThirdMinimal(ctx, p, t, duration, F) {
    const { w, h } = templateSize('lower-third-minimal', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;

    // Slide in from left
    const slideX = (1 - prog) * -50;
    ctx.translate(slideX, 0);

    // Frosted pill card background (alpha 0.94 > 200)
    ctx.fillStyle = 'rgba(12, 16, 26, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.fill();
    ctx.stroke();

    // Accent indicator vertical bar on left edge
    ctx.fillStyle = p.color || '#00E5FF';
    roundRect(ctx, 16, 20, 8, h - 40, 4);
    ctx.fill();

    // Speaker Name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 32px "${F.label}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(p.name || 'SPEAKER NAME').toUpperCase(), 44, 68);

    // Role / Title
    ctx.fillStyle = '#94A3B8';
    ctx.font = `500 20px "${F.body}"`;
    ctx.fillText(String(p.role || 'LEAD CREATOR').toUpperCase(), 44, 114);

    ctx.restore();
}

function drawLocationBadge(ctx, p, t, duration, F) {
    const { w, h } = templateSize('location-badge', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Dark pill container
    ctx.fillStyle = 'rgba(14, 18, 28, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, h / 2);
    ctx.fill();
    ctx.stroke();

    // Red Location Pin Dot
    ctx.fillStyle = p.color || '#FF3B5C';
    ctx.beginPath();
    ctx.arc(42, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();

    // Pin pulse ring
    ctx.strokeStyle = p.color || '#FF3B5C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(42, h / 2, 16, 0, Math.PI * 2);
    ctx.stroke();

    // Location name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 24px "${F.label}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.location || 'LOCATION').toUpperCase(), 72, h / 2 - 1);

    // Time / secondary
    if (p.time) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = `500 18px "${F.body}"`;
        ctx.textAlign = 'right';
        ctx.fillText(String(p.time), w - 36, h / 2);
    }

    ctx.restore();
}

function drawRetentionProgressBar(ctx, p, t, duration, F) {
    const { w, h } = templateSize('retention-progress-bar', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / (duration * 0.9), 0, 1));
    const targetVal = clamp(Number(p.value) || 75, 0, 100);
    const fillPercent = targetVal * prog;

    ctx.save();
    ctx.globalAlpha = a;

    // Background container
    ctx.fillStyle = 'rgba(12, 15, 24, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.stroke();

    // Progress track bar
    const barX = 24, barY = 46, barW = w - 48, barH = 26;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fill();

    // Active fill with glowing gradient
    if (fillPercent > 0) {
        const fillW = Math.max(barH, (barW * fillPercent) / 100);
        const grad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
        grad.addColorStop(0, p.color || '#00E5FF');
        grad.addColorStop(1, p.accent || '#FFE500');
        ctx.fillStyle = grad;
        ctx.shadowColor = p.color || '#00E5FF';
        ctx.shadowBlur = 12;
        roundRect(ctx, barX, barY, fillW, barH, barH / 2);
        ctx.fill();
    }

    // Top Label & Percentage
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'left';
    ctx.fillText(String(p.label || 'PROGRESS').toUpperCase(), barX + 4, 30);

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'right';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.fillText(`${Math.round(fillPercent)}%`, barX + barW - 4, 30);

    ctx.restore();
}

function drawQuoteCard(ctx, p, t, duration, F) {
    const { w, h } = templateSize('quote-card', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Card background
    ctx.fillStyle = 'rgba(14, 18, 28, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 24);
    ctx.fill();
    ctx.stroke();

    // Stylized quote mark
    ctx.fillStyle = p.color || '#FFE500';
    ctx.font = `900 64px "${F.display}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('“', 32, 60);

    // Quote text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `500 24px "${F.body}"`;
    ctx.textBaseline = 'alphabetic';
    const quoteStr = String(p.quote || 'Simplicity is prerequisite for reliability.');
    ctx.fillText(`"${quoteStr.slice(0, 56)}"`, 36, 130);
    if (quoteStr.length > 56) {
        ctx.fillText(quoteStr.slice(56, 116), 36, 168);
    }

    // Author line
    const authorY = h - 45;
    ctx.fillStyle = p.color || '#FFE500';
    ctx.beginPath();
    ctx.arc(48, authorY - 6, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 20px "${F.label}"`;
    ctx.fillText(String(p.author || 'AUTHOR').toUpperCase(), 70, authorY);

    ctx.restore();
}

function drawComparisonCard(ctx, p, t, duration, F) {
    const { w, h } = templateSize('comparison-card', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Card background
    ctx.fillStyle = 'rgba(14, 18, 28, 0.95)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 22);
    ctx.fill();
    ctx.stroke();

    // Divider
    const midX = w / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midX, 24);
    ctx.lineTo(midX, h - 24);
    ctx.stroke();

    // "VS" badge in center
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(midX, h / 2, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 16px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', midX, h / 2);

    // Left (Before)
    const leftX = midX / 2;
    ctx.fillStyle = '#EF4444';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(p.beforeLabel || 'BEFORE').toUpperCase(), leftX, 60);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = `900 36px "${F.display}"`;
    ctx.fillText(String(p.beforeVal || '14 Hours'), leftX, 120);

    // Right (After)
    const rightX = midX + midX / 2;
    ctx.fillStyle = p.accent || '#10B981';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.fillText(String(p.afterLabel || 'AFTER').toUpperCase(), rightX, 60);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 38px "${F.display}"`;
    ctx.fillText(String(p.afterVal || '35 Mins'), rightX, 120);

    ctx.restore();
}

function drawSocialNotification(ctx, p, t, duration, F) {
    const { w, h } = templateSize('social-notification', p);
    const { tin, tout } = envelope(t, duration, 0.30, 0.25);
    const a = Math.min(1, tin * 2.5) * tout;
    if (a <= 0) return;
    const slide = easeOutBack(clamp(t / 0.30, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - slide) * -20);

    // Notification Capsule
    ctx.fillStyle = 'rgba(16, 22, 34, 0.96)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 24);
    ctx.fill();
    ctx.stroke();

    // App/Social Icon Circle
    const iconX = 54, iconY = h / 2;
    ctx.fillStyle = p.color || '#FF3B5C';
    ctx.beginPath();
    ctx.arc(iconX, iconY, 24, 0, Math.PI * 2);
    ctx.fill();

    // Notification bell / star symbol inside circle
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 22px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', iconX, iconY);

    // Title / App Name
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `bold 20px "${F.label}"`;
    ctx.fillText(String(p.title || 'NEW SUBSCRIBER').toUpperCase(), 96, 54);

    // Timestamp
    ctx.fillStyle = '#94A3B8';
    ctx.font = `500 16px "${F.body}"`;
    ctx.textAlign = 'right';
    ctx.fillText('now', w - 32, 54);

    // Subtitle / message
    ctx.textAlign = 'left';
    ctx.fillStyle = '#CBD5E1';
    ctx.font = `500 20px "${F.body}"`;
    const subStr = String(p.subtitle || '@alex started following you');
    ctx.fillText(subStr.slice(0, 42), 96, 95);

    ctx.restore();
}

function drawCommentBubble(ctx, p, t, duration, F) {
    const { w, h } = templateSize('comment-bubble', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Comment Card
    ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 22);
    ctx.fill();
    ctx.stroke();

    // Avatar Circle
    const avX = 52, avY = 56;
    const grad = ctx.createLinearGradient(avX - 22, avY - 22, avX + 22, avY + 22);
    grad.addColorStop(0, p.color || '#38BDF8');
    grad.addColorStop(1, '#818CF8');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(avX, avY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Avatar Initial
    const userStr = String(p.user || '@marcus_dev');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(userStr.replace('@', '')[0]?.toUpperCase() || 'U', avX, avY);

    // Username
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 22px "${F.label}"`;
    ctx.fillText(userStr, 90, 52);

    // Verified badge icon
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(90 + ctx.measureText(userStr).width + 16, 45, 8, 0, Math.PI * 2);
    ctx.fill();

    // Comment Text
    ctx.fillStyle = '#E2E8F0';
    ctx.font = `500 22px "${F.body}"`;
    const cText = String(p.text || 'How do you structure this without ads?');
    ctx.fillText(cText.slice(0, 52), 90, 110);
    if (cText.length > 52) {
        ctx.fillText(cText.slice(52, 105), 90, 145);
    }

    ctx.restore();
}

function drawKpiStatCallout(ctx, p, t, duration, F) {
    const { w, h } = templateSize('kpi-stat-callout', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Background Card with neon border
    ctx.fillStyle = 'rgba(12, 18, 32, 0.96)';
    ctx.strokeStyle = p.color || '#10B981';
    ctx.lineWidth = 2.5;
    roundRect(ctx, 4, 4, w - 8, h - 8, 22);
    ctx.fill();
    ctx.stroke();

    // Big Stat Number
    ctx.fillStyle = p.color || '#10B981';
    ctx.font = `900 76px "${F.display}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const statText = String(p.stat || '+184%');
    ctx.fillText(statText, 40, 106);

    // Trending up pill
    const statW = ctx.measureText(statText).width;
    const pillX = 50 + statW, pillY = 56, pillW = 86, pillH = 34;
    ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.strokeStyle = p.color || '#10B981';
    ctx.lineWidth = 1.5;
    roundRect(ctx, pillX, pillY, pillW, pillH, 17);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 16px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▲ DELTA', pillX + pillW / 2, pillY + pillH / 2);

    // Label Line
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 20px "${F.label}"`;
    ctx.fillText(String(p.label || 'ORGANIC RETENTION RATE').toUpperCase(), 40, 160);

    // Accent line underneath
    ctx.fillStyle = p.accent || '#38BDF8';
    ctx.fillRect(40, 178, w - 80, 4);

    ctx.restore();
}

function drawNewspaperHeadline(ctx, p, t, duration, F) {
    const { w, h } = templateSize('newspaper-headline', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Cream newspaper background with crisp editorial feel
    ctx.fillStyle = 'rgba(248, 246, 240, 0.98)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 12);
    ctx.fill();
    ctx.stroke();

    // Masthead header rules
    const pubName = String(p.publication || 'THE TECH DISPATCH').toUpperCase();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(32, 28);
    ctx.lineTo(w - 32, 28);
    ctx.moveTo(32, 62);
    ctx.lineTo(w - 32, 62);
    ctx.stroke();

    // Publication title
    ctx.fillStyle = '#0F172A';
    ctx.font = `900 22px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pubName, w / 2, 45);

    // Date
    ctx.font = `600 13px "${F.label}"`;
    ctx.textAlign = 'right';
    ctx.fillText(String(p.date || 'OCTOBER 2026').toUpperCase(), w - 40, 45);

    // Headline
    const hl = String(p.headline || 'AI OVERHAULS CREATOR PRODUCTION');
    ctx.fillStyle = '#000000';
    ctx.font = `900 36px "${F.display}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(hl.slice(0, 36), 36, 128);
    if (hl.length > 36) {
        ctx.fillText(hl.slice(36, 75), 36, 172);
    }

    // Yellow highlighter over key phrase
    const highlightWord = p.highlight || 'OVERHAULS';
    const hlProgress = clamp((t - 0.2) / 0.4, 0, 1);
    if (hlProgress > 0) {
        ctx.fillStyle = 'rgba(254, 240, 138, 0.65)';
        ctx.fillRect(36, 138, (w - 72) * hlProgress, 28);
    }

    // Bottom column divider & deck
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(36, 214);
    ctx.lineTo(w - 36, 214);
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.font = `500 16px "${F.body}"`;
    ctx.fillText('SPECIAL REPORT • EDITION No. 42', 36, 238);

    ctx.restore();
}

function drawSearchBar(ctx, p, t, duration, F) {
    const { w, h } = templateSize('search-bar', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Search pill capsule
    ctx.fillStyle = 'rgba(18, 24, 38, 0.96)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = 2.5;
    roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
    ctx.fill();
    ctx.stroke();

    // Magnifying glass icon on left
    const iconX = 52, iconY = h / 2;
    ctx.strokeStyle = p.color || '#00E5FF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(iconX, iconY - 3, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(iconX + 8, iconY + 5);
    ctx.lineTo(iconX + 17, iconY + 14);
    ctx.stroke();

    // Animated typing query
    const fullQuery = String(p.query || 'how to edit viral videos');
    const typeProg = clamp((t - 0.2) / (duration * 0.6), 0, 1);
    const charCount = Math.floor(typeProg * fullQuery.length);
    const displayedQuery = fullQuery.slice(0, charCount);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 24px "${F.body}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayedQuery || (t < 0.25 ? String(p.placeholder || 'Search...') : ''), 88, h / 2);

    // Blinking cursor
    const cursorVisible = Math.floor(t * 4) % 2 === 0;
    if (cursorVisible && charCount < fullQuery.length) {
        const textW = ctx.measureText(displayedQuery).width;
        ctx.fillStyle = p.color || '#00E5FF';
        ctx.fillRect(92 + textW, h / 2 - 14, 3, 28);
    }

    ctx.restore();
}

/**
 * Draw a template at time t (seconds since the clip started) into a context
 * whose drawing area is the template box scaled by `scale`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind
 * @param {object} params
 * @param {number} t
 * @param {number} duration
 * @param {{scale?:number, fonts?:object, images?:object}} opts images: url → loaded image
 */
export function drawTemplate(ctx, kind, params, t, duration, opts = {}) {
    if (!ctx || !TEMPLATE_KINDS.includes(kind)) return;
    const p = templateParams(kind, params);
    const F = { ...TEMPLATE_FONTS, ...(opts.fonts || {}) };
    const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    const d = Math.max(0.5, Number(duration) || 3);
    const tt = clamp(Number(t) || 0, 0, d);
    ctx.save();
    ctx.scale(scale, scale);
    try {
        if (kind === 'counter') drawCounter(ctx, p, tt, d, F);
        else if (kind === 'price-pop') drawPricePop(ctx, p, tt, d, F);
        else if (kind === 'logo-card') drawLogoCard(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'code-window') drawCodeWindow(ctx, p, tt, d, F);
        else if (kind === 'highlight-box') drawHighlightBox(ctx, p, tt, d);
        else if (kind === 'underline') drawUnderline(ctx, p, tt, d);
        else if (kind === 'circle-callout') drawCircleCallout(ctx, p, tt, d);
        else if (kind === 'arrow') drawArrow(ctx, p, tt, d);
        else if (kind === 'progress-bar') drawProgressBar(ctx, p, tt, d, F);
        else if (kind === 'bar-chart') drawBarChart(ctx, p, tt, d, F);
        else if (kind === 'burst') drawBurst(ctx, p, tt, d);
        else if (kind === 'line-graph') drawLineGraph(ctx, p, tt, d, F);
        else if (kind === 'circular-meter') drawCircularMeter(ctx, p, tt, d, F);
        else if (kind === 'data-counter') drawDataCounter(ctx, p, tt, d, F);
        else if (kind === 'film-grain') drawFilmGrain(ctx, p, tt, d);
        else if (kind === 'vhs-glitch') drawVhsGlitch(ctx, p, tt, d);
        else if (kind === 'light-leak') drawLightLeak(ctx, p, tt, d);
        else if (kind === 'lower-third-minimal') drawLowerThirdMinimal(ctx, p, tt, d, F);
        else if (kind === 'location-badge') drawLocationBadge(ctx, p, tt, d, F);
        else if (kind === 'retention-progress-bar') drawRetentionProgressBar(ctx, p, tt, d, F);
        else if (kind === 'quote-card') drawQuoteCard(ctx, p, tt, d, F);
        else if (kind === 'comparison-card') drawComparisonCard(ctx, p, tt, d, F);
        else if (kind === 'social-notification') drawSocialNotification(ctx, p, tt, d, F);
        else if (kind === 'comment-bubble') drawCommentBubble(ctx, p, tt, d, F);
        else if (kind === 'kpi-stat-callout') drawKpiStatCallout(ctx, p, tt, d, F);
        else if (kind === 'newspaper-headline') drawNewspaperHeadline(ctx, p, tt, d, F);
        else if (kind === 'search-bar') drawSearchBar(ctx, p, tt, d, F);
    } finally {
        ctx.restore();
    }
}

/**
 * Pull template parameters out of a request ("add a counter day 14 of 30",
 * "price pop 15-20€", "code window \"npm i vibed\""). Returns null if the
 * text names no template.
 */
export function templateFromText(text) {
    const raw = String(text || '');
    const s = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const quoted = (raw.match(/["“«]\s*([^"”»]+?)\s*["”»]/) || [])[1] || null;
    // R92: shapes first, so "bar chart 10 of 30" is not read as a counter.
    const shape = shapeFromText(s, raw, quoted);
    if (shape) return shape;
    if (/counter|compteur|day \d|jour \d|\d+\s*(?:\/|of|sur)\s*\d+/.test(s) && !/code/.test(s)) {
        const m = s.match(/(\d+)\s*(?:\/|of|sur|out of)\s*(\d+)/);
        const lab = s.match(/\b(day|jour|week|semaine|step|etape|episode|ep|part|partie)\b/);
        return {
            kind: 'counter',
            params: {
                ...(m ? { value: Number(m[1]), total: Number(m[2]) } : {}),
                ...(lab ? { label: lab[1].toUpperCase() } : {}),
            },
        };
    }
    if (/price|prix|number pop|chiffre|amount|montant|pop/.test(s)) {
        const tok = quoted || (raw.match(/[\d][\d\s.,]*(?:-[\d.,]+)?\s*(?:€|\$|£|%|k\b|m\b)?/) || [])[0];
        return { kind: 'price-pop', params: tok ? { text: String(tok).trim() } : {} };
    }
    if (/code|terminal|typing|tape du code/.test(s)) {
        return { kind: 'code-window', params: quoted ? { code: quoted } : {} };
    }
    if (/logo card|logo|carte logo|brand card/.test(s)) {
        return { kind: 'logo-card', params: quoted ? { label: quoted } : {} };
    }
    return null;
}

/** R92: shapes named in a request. `s` is lower-cased and accent-free. */
function shapeFromText(s, raw, quoted) {
    if (/line graph|trend line|courbe|tendance/.test(s)) {
        const nums = (raw.match(/-?\d+(?:[.,]\d+)?/g) || []).slice(0, 6).map(n => n.replace(',', '.'));
        return { kind: 'line-graph', params: nums.length >= 2 ? { values: nums.join(',') } : {} };
    }
    if (/bar chart|\bgraph\b|\bchart\b|histogram|graphique|diagramme/.test(s)) {
        const nums = (raw.match(/-?\d+(?:[.,]\d+)?/g) || []).slice(0, 6).map(n => n.replace(',', '.'));
        return { kind: 'bar-chart', params: nums.length >= 2 ? { values: nums.join(','), labels: '' } : {} };
    }
    if (/progress bar|progress|barre de progression|progression/.test(s)) {
        const m = s.match(/(\d{1,3})\s*%/);
        return { kind: 'progress-bar', params: { ...(m ? { value: Number(m[1]) } : {}), ...(quoted ? { label: quoted } : {}) } };
    }
    if (/arrow|fleche/.test(s)) {
        const d = (s.match(/\b(left|right|up|down|gauche|droite|haut|bas)\b/) || [])[1];
        const map = { gauche: 'left', droite: 'right', haut: 'up', bas: 'down' };
        return { kind: 'arrow', params: d ? { direction: map[d] || d } : {} };
    }
    if (/circle|encercle|cercle/.test(s)) return { kind: 'circle-callout', params: {} };
    if (/underline|souligne/.test(s)) return { kind: 'underline', params: {} };
    if (/highlight box|box around|frame around|rectangle|encadre|cadre/.test(s)) return { kind: 'highlight-box', params: {} };
    if (/burst|starburst|explosion|eclat/.test(s)) return { kind: 'burst', params: {} };
    if (/circular meter|gauge|radial meter|jauge/.test(s)) {
        const m = s.match(/(\d{1,3})\s*%/);
        return { kind: 'circular-meter', params: m ? { value: Number(m[1]) } : {} };
    }
    if (/data counter|metric counter|chiffre anime/.test(s)) {
        const m = s.match(/[\d,.]+/);
        return { kind: 'data-counter', params: m ? { value: Number(m[0].replace(/,/g, '')) } : {} };
    }
    if (/film grain|grain 35mm|grain pellicule|35mm/.test(s)) return { kind: 'film-grain', params: {} };
    if (/vhs|glitch|retro tape|scanline/.test(s)) return { kind: 'vhs-glitch', params: {} };
    if (/light leak|leak|flare|lueur/.test(s)) return { kind: 'light-leak', params: {} };
    if (/lower third|titre bas|speaker card|nom du speaker/.test(s)) {
        return { kind: 'lower-third-minimal', params: quoted ? { name: quoted } : {} };
    }
    if (/\b(location|lieu|pin|badge lieu|city|ville)\b/.test(s)) {
        return { kind: 'location-badge', params: quoted ? { location: quoted } : {} };
    }
    if (/retention bar|retention progress|watch progress/.test(s)) {
        const m = s.match(/(\d{1,3})\s*%/);
        return { kind: 'retention-progress-bar', params: m ? { value: Number(m[1]) } : {} };
    }
    if (/quote card|citation|quote|tweet/.test(s)) {
        return { kind: 'quote-card', params: quoted ? { quote: quoted } : {} };
    }
    if (/\b(comparison|before after|avant apres|comparatif|comparaison)\b/.test(s)) {
        return { kind: 'comparison-card', params: quoted ? { beforeVal: quoted } : {} };
    }
    if (/\b(notification|social notif|notif|subscriber|nouvel abonne)\b/.test(s)) {
        return { kind: 'social-notification', params: quoted ? { subtitle: quoted } : {} };
    }
    if (/\b(comment bubble|commentaire|bubble|social proof|temoignage)\b/.test(s)) {
        return { kind: 'comment-bubble', params: quoted ? { text: quoted } : {} };
    }
    if (/\b(kpi|stat callout|metrique cle|taux|chiffre cle)\b/.test(s)) {
        return { kind: 'kpi-stat-callout', params: quoted ? { stat: quoted } : {} };
    }
    if (/\b(newspaper|headline|journal|gazette|titre presse|presse)\b/.test(s)) {
        return { kind: 'newspaper-headline', params: quoted ? { headline: quoted } : {} };
    }
    if (/\b(search bar|barre de recherche|recherche|google search)\b/.test(s)) {
        return { kind: 'search-bar', params: quoted ? { query: quoted } : {} };
    }
    return null;
}

export default {
    TEMPLATE_KINDS, SHAPE_KINDS, TEMPLATE_FONTS, TEMPLATE_DEFAULTS, TEMPLATE_WIDTH_FRACTION,
    templateParams, templateSize, drawTemplate, highlightLine, templateFromText,
};
