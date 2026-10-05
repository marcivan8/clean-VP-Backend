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

export const TEMPLATE_KINDS = ['counter', 'price-pop', 'logo-card', 'code-window'];

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
};

/** Width as a fraction of the frame, the size a new template is dropped at. */
export const TEMPLATE_WIDTH_FRACTION = { 'counter': 0.5, 'price-pop': 0.62, 'logo-card': 0.72, 'code-window': 0.86 };

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

export default {
    TEMPLATE_KINDS, TEMPLATE_FONTS, TEMPLATE_DEFAULTS, TEMPLATE_WIDTH_FRACTION,
    templateParams, templateSize, drawTemplate, highlightLine, templateFromText,
};
