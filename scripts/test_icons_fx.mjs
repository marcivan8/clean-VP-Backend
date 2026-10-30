// R115: the icon library, the shape-wipe transitions, and the advanced
// frame effects. node scripts/test_icons_fx.mjs
import assert from 'assert/strict';
import fs from 'fs';

const log = console.log;
let failures = 0;
const check = (name, fn) => {
    try { fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const IL = await import('../client/src/motion/IconLibrary.js');
const VI = await import('../client/src/motion/VectorIllustrationLibrary.js');
const TG = await import('../client/src/motion/TemplateGraphics.js');
const FX = await import('../client/src/motion/TransitionFX.js');

function recorder() {
    const calls = [];
    const ctx = new Proxy({}, {
        get(_, prop) {
            if (prop === 'canvas') return { width: 1080, height: 1920 };
            if (prop === 'measureText') return (s) => ({ width: String(s).length * 11 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
                return (...args) => {
                    calls.push(`${String(prop)}(${args.join(',')})`);
                    return { addColorStop: (o, c) => calls.push(`stop(${o},${c})`) };
                };
            }
            if (typeof prop === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|globalAlpha|textAlign|textBaseline|lineCap|lineJoin|filter|shadowBlur|shadowColor|globalCompositeOperation)$/.test(prop)) return undefined;
            return (...args) => { calls.push(`${String(prop)}(${args.map(a => (typeof a === 'number' ? a.toFixed(4) : String(a))).join(',')})`); };
        },
        set(_, prop, value) { calls.push(`${String(prop)}=${String(value)}`); return true; },
    });
    return { ctx, calls };
}

log('\n-- 1. The icon set --');

check('the vector illustration catalog has 100+ unique, usable entries', () => {
    assert.ok(VI.VECTOR_ILLUSTRATIONS.length >= 100, `only ${VI.VECTOR_ILLUSTRATIONS.length} illustrations`);
    assert.equal(new Set(VI.VECTOR_ILLUSTRATIONS.map(item => item.id)).size, VI.VECTOR_ILLUSTRATIONS.length);
    for (const item of VI.VECTOR_ILLUSTRATIONS) {
        assert.ok(IL.hasIcon(item.icon), `${item.id} references missing icon ${item.icon}`);
        assert.ok(VI.isValidVectorIllustration(item), `${item.id} is invalid`);
        assert.ok(VI.VECTOR_ILLUSTRATION_BACKGROUNDS.some(({ id }) => id === item.background), `${item.id} has no backdrop`);
    }
});

check('agent template tool exposes the full template catalogue and the illustration picker forwards params', () => {
    const tools = read('../client/src/agent/VideoEditorTools.js');
    const panel = read('../client/src/components/TemplatePanel.jsx');
    assert.match(tools, /kind:\s*\{\s*type:\s*"string",\s*enum:\s*TEMPLATE_KINDS\s*\}/);
    assert.match(tools, /params\.icon names a vector illustration/);
    assert.match(panel, /const add = \(kind, params = \{\}\)/);
    assert.match(panel, /add\('icon', \{ icon: item\.icon, treatment: item\.treatment, background: item\.background \}\)/);
    assert.match(panel, /VECTOR_ILLUSTRATION_BACKGROUNDS\.map/);
    assert.match(panel, /evaluateMotionCompatibility\(editingStyle, 'template', kind, params\)/);
});

check('every name in a group is a real icon, and every icon is in a group', () => {
    for (const name of IL.ICON_NAMES) {
        assert.ok(IL.hasIcon(name), `${name} is listed but not defined`);
        assert.ok(IL.groupOf(name), `${name} is in no group`);
    }
    for (const name of Object.keys(IL.ICONS)) {
        assert.ok(IL.ICON_NAMES.includes(name), `${name} is defined but unreachable`);
    }
    assert.equal(new Set(IL.ICON_NAMES).size, IL.ICON_NAMES.length, 'a name is in two groups');
});

check('every icon is well-formed and stays inside its 24x24 box', () => {
    // The box matters: an icon that overflows it collides with whatever the
    // caller put beside it, and nothing downstream would catch that.
    for (const name of IL.ICON_NAMES) {
        const icon = IL.ICONS[name];
        const shapes = [...(icon.s || []), ...(icon.f || [])];
        assert.ok(shapes.length > 0, `${name} draws nothing`);
        for (const [op, ...n] of shapes) {
            assert.ok(IL.ICON_COMMANDS.includes(op), `${name} uses unknown command "${op}"`);
            assert.ok(n.every(Number.isFinite), `${name} has a non-numeric coordinate`);
            if (op === 'C' || op === 'A') {
                const [cx, cy, r, a0, a1] = n;
                assert.ok(r > 0, `${name}: radius ${r}`);
                // An ARC's bounds are not its circle's. Treating every arc as
                // a full circle called half the set an overflow — a half-arc
                // drawn as the TOP of a shoulder line sits entirely above its
                // own centre. The extremes are the two endpoints plus any
                // axis the arc actually crosses.
                const from = op === 'A' ? a0 * Math.PI * 2 : 0;
                const to = op === 'A' ? a1 * Math.PI * 2 : Math.PI * 2;
                const xs = [];
                const ys = [];
                for (const ang of [from, to]) { xs.push(cx + Math.cos(ang) * r); ys.push(cy + Math.sin(ang) * r); }
                for (let k = -4; k <= 8; k++) {
                    const ang = (k * Math.PI) / 2;
                    if (ang < Math.min(from, to) - 1e-9 || ang > Math.max(from, to) + 1e-9) continue;
                    xs.push(cx + Math.cos(ang) * r);
                    ys.push(cy + Math.sin(ang) * r);
                }
                const lo = (v) => Math.min(...v);
                const hi = (v) => Math.max(...v);
                assert.ok(lo(xs) >= -1.5 && hi(xs) <= IL.ICON_GRID + 1.5, `${name} overflows horizontally (${lo(xs).toFixed(1)}..${hi(xs).toFixed(1)})`);
                assert.ok(lo(ys) >= -1.5 && hi(ys) <= IL.ICON_GRID + 1.5, `${name} overflows vertically (${lo(ys).toFixed(1)}..${hi(ys).toFixed(1)})`);
            } else if (op === 'R') {
                const [x, y, w, h] = n;
                assert.ok(w > 0 && h > 0, `${name}: rect ${w}x${h}`);
                assert.ok(x >= -1.5 && y >= -1.5 && x + w <= IL.ICON_GRID + 1.5 && y + h <= IL.ICON_GRID + 1.5, `${name} overflows`);
            } else {
                assert.equal(n.length % 2, 0, `${name} has an odd coordinate count`);
                for (let i = 0; i < n.length; i += 2) {
                    assert.ok(n[i] >= -1.5 && n[i] <= IL.ICON_GRID + 1.5, `${name} overflows horizontally at ${n[i]}`);
                    assert.ok(n[i + 1] >= -1.5 && n[i + 1] <= IL.ICON_GRID + 1.5, `${name} overflows vertically at ${n[i + 1]}`);
                }
            }
        }
    }
});

check('drawing an icon is deterministic, and reports whether it drew', () => {
    for (const name of IL.ICON_NAMES) {
        const a = recorder();
        assert.equal(IL.drawIcon(a.ctx, name, 48, { color: '#fff' }), true, `${name} reported nothing drawn`);
        const b = recorder();
        IL.drawIcon(b.ctx, name, 48, { color: '#fff' });
        assert.equal(b.calls.join('|'), a.calls.join('|'), `${name} draws differently the second time`);
        assert.ok(a.calls.some(c => c === 'fill()' || c === 'stroke()'), `${name} issued no paint call`);
    }
    // An unknown name draws nothing and SAYS so, so a caller can fall back
    // rather than leave a hole.
    const r = recorder();
    assert.equal(IL.drawIcon(r.ctx, 'not-an-icon', 48), false);
    assert.deepEqual(r.calls, []);
    assert.equal(IL.drawIcon(null, 'check', 48), false);
});

check('stroke weight scales with the icon', () => {
    // A 320px icon drawn with a 2px stroke looks hairline next to a 32px one.
    const small = recorder();
    IL.drawIcon(small.ctx, 'check', 24);
    const big = recorder();
    IL.drawIcon(big.ctx, 'check', 240);
    const width = (r) => Number((r.calls.find(c => c.startsWith('lineWidth=')) || '').slice(10));
    assert.ok(width(big) > width(small) * 5, `${width(small)} vs ${width(big)}`);
});

check('a phrase finds its icon, in English and French, or nothing', () => {
    const asks = [['check icon', 'check'], ['tick', 'check'], ['coche', 'check'],
        ['loupe', 'search'], ['search', 'search'], ['ampoule', 'bulb'], ['idea', 'bulb'],
        ['fire', 'fire'], ['trending', 'fire'], ['chart bar', 'chart-bar'],
        ['arrow up right', 'arrow-up-right'], ['equipe', 'team'], ['objectif', 'target'],
        ['ciseaux', 'scissors'], ['calendrier', 'calendar']];
    for (const [text, name] of asks) assert.equal(IL.iconFromText(text), name, `"${text}" gave ${IL.iconFromText(text)}`);
    // Never a fuzzy match: the wrong icon silently is worse than none.
    for (const text of ['', 'xyzzy', 'something entirely unrelated']) {
        assert.equal(IL.iconFromText(text), null, `"${text}" matched something`);
    }
});

check('longer names win over the names they contain', () => {
    assert.equal(IL.iconFromText('chart bar'), 'chart-bar');
    assert.equal(IL.iconFromText('chart up'), 'chart-up');
    assert.equal(IL.iconFromText('arrow up right'), 'arrow-up-right');
    assert.equal(IL.iconFromText('arrow right'), 'arrow-right');
});

log('\n-- 2. Icons reaching the catalogue --');

check('the icon templates are registered and draw', () => {
    for (const kind of ['icon', 'icon-label', 'icon-row']) {
        assert.ok(TG.TEMPLATE_KINDS.includes(kind));
        const { ctx, calls } = recorder();
        TG.drawTemplate(ctx, kind, {}, 1.4, 2.6, {});
        assert.ok(calls.length > 0, `${kind} drew nothing`);
    }
});

check('each illustration background draws through the shared template renderer', () => {
    for (const [treatment, background, gradient] of [
        ['solo', 'soft-glow', 'createRadialGradient'],
        ['badge', 'gradient-orb', 'createRadialGradient'],
        ['frame', 'glass-panel', 'createLinearGradient'],
        ['burst', 'radial-burst', 'stroke()'],
    ]) {
        const { ctx, calls } = recorder();
        TG.drawTemplate(ctx, 'icon', { icon: 'rocket', treatment, background, accent: '#ff00aa' }, 1.4, 2.6, {});
        assert.ok(calls.some(call => call === 'fill()' || call === 'stroke()'), `${treatment} drew nothing`);
        assert.ok(calls.some(call => call.startsWith(gradient)), `${background} backdrop was not drawn`);
    }
});

check('an unknown icon name leaves no hole in a label', () => {
    // drawIcon reports whether it drew, so the text shifts left instead of
    // sitting beside an empty gap.
    const bad = recorder();
    TG.drawTemplate(bad.ctx, 'icon-label', { icon: 'not-an-icon', text: 'Hello' }, 1.4, 2.6, {});
    const good = recorder();
    TG.drawTemplate(good.ctx, 'icon-label', { icon: 'bulb', text: 'Hello' }, 1.4, 2.6, {});
    const xOf = (r) => Number((r.calls.find(c => c.startsWith('fillText(Hello,')) || ',0').split(',')[1]);
    assert.ok(xOf(bad) < xOf(good), `text at ${xOf(bad)} with no icon vs ${xOf(good)} with one`);
});

check('asking for an icon with no usable name returns nothing', () => {
    // Handing back the default would put an unrelated symbol on screen under
    // the user's own words.
    assert.equal(TG.templateFromText('add an icon'), null);
    assert.equal(TG.templateFromText('add a check icon')?.kind, 'icon');
    assert.equal(TG.templateFromText('add a check icon')?.params.icon, 'check');
    assert.deepEqual(TG.templateFromText('add a burst illustration of a rocket'), {
        kind: 'icon', params: { icon: 'rocket', treatment: 'burst' },
    });
});

check('the brand reaches an icon', () => {
    const r = recorder();
    TG.drawTemplate(r.ctx, 'icon', { icon: 'star' }, 1.4, 2.6, { brand: { accent: '#ff0033' } });
    assert.ok(/ff0033/i.test(r.calls.join(' ')), 'the icon did not take the brand colour');
});

log('\n-- 3. The shape-wipe transitions --');

const WIPES = ['circle-wipe', 'bar-wipe', 'blinds', 'diagonal-wipe'];

check('every type is visually neutral at both window edges', () => {
    // A transition that is not neutral at its edges jumps at the window
    // boundary, which reads as a worse cut than no transition.
    for (const type of FX.TRANSITION_TYPES) {
        for (const u of [-1, 1]) {
            const fx = FX.fxAt(type, u);
            assert.ok(Math.abs(fx.scale - 1) < 1e-5, `${type} at u=${u} scales`);
            assert.ok(Math.abs(fx.tx) < 1e-5, `${type} at u=${u} shifts`);
            assert.ok(!(fx.wipe && fx.wipe.p > 1e-6), `${type} at u=${u} still covers the frame`);
        }
    }
});

check('a wipe covers the frame exactly AT the cut', () => {
    for (const type of WIPES) {
        const fx = FX.fxAt(type, 0);
        assert.ok(fx.wipe, `${type} has no wipe at the cut`);
        assert.equal(fx.wipe.p, 1, `${type} covers ${fx.wipe.p} at the cut`);
        assert.ok(FX.WIPE_SHAPES.includes(fx.wipe.shape), `${type} names shape "${fx.wipe.shape}"`);
    }
});

check('a wipe is NOT reported as neutral, or both renderers skip it', () => {
    // fxIsNeutral is how the preview and the export decide whether to work at
    // all. A wipe missing from it would simply never appear.
    for (const type of WIPES) {
        assert.equal(FX.fxIsNeutral(FX.fxAt(type, 0)), false, `${type} at the cut reads as neutral`);
        assert.equal(FX.fxIsNeutral(FX.fxAt(type, 0.5)), false, `${type} mid-window reads as neutral`);
    }
    assert.equal(FX.fxIsNeutral(FX.NEUTRAL_FX), true);
});

check('each wipe shape draws, deterministically, and grows with p', () => {
    for (const shape of FX.WIPE_SHAPES) {
        const area = (p) => {
            const r = recorder();
            FX.drawWipe(r.ctx, 1080, 1920, { shape, p });
            return r.calls.join('|');
        };
        const quarter = area(0.25);
        const full = area(1);
        assert.ok(quarter.length > 0, `${shape} drew nothing at p=0.25`);
        assert.notEqual(quarter, full, `${shape} draws the same at p=0.25 and p=1`);
        assert.equal(area(0.5), area(0.5), `${shape} is not deterministic`);
        // p=0 is fully open: nothing at all.
        const r = recorder();
        FX.drawWipe(r.ctx, 1080, 1920, { shape, p: 0 });
        assert.deepEqual(r.calls, [], `${shape} drew at p=0`);
    }
});

check('both renderers ask TransitionFX what to draw, not fx.lines', () => {
    // `lines` was special-cased in two files. A second overlay would have been
    // two more places to forget, so both now call one function.
    const preview = read('../client/src/components/Player/TransitionLayer.jsx');
    assert.ok(/drawTransitionOverlay/.test(preview), 'the preview still special-cases an overlay');
    assert.ok(!/drawSpeedLines/.test(preview), 'the preview still calls drawSpeedLines directly');
    const exporter = read('../server/compositor/TransitionCompiler.js');
    assert.ok(/FX\.hasOverlay\(s\.fx\)/.test(exporter), 'the export still tests fx.lines');
    assert.ok(/FX\.drawTransitionOverlay/.test(exporter), 'the export still calls drawSpeedLines directly');
});

check('the overlay dispatcher reports whether it drew', () => {
    const none = recorder();
    assert.equal(FX.drawTransitionOverlay(none.ctx, 100, 100, FX.NEUTRAL_FX), false);
    assert.deepEqual(none.calls, []);
    const wiped = recorder();
    assert.equal(FX.drawTransitionOverlay(wiped.ctx, 100, 100, FX.fxAt('circle-wipe', 0)), true);
    assert.ok(wiped.calls.length > 0);
    const lined = recorder();
    assert.equal(FX.drawTransitionOverlay(lined.ctx, 100, 100, FX.fxAt('speed-lines', 0)), true);
    assert.equal(FX.hasOverlay(FX.NEUTRAL_FX), false);
});

check('each new transition can be asked for, and the old ones still answer', () => {
    const asks = [['circle wipe', 'circle-wipe'], ['iris', 'circle-wipe'], ['bar wipe', 'bar-wipe'],
        ['volet', 'bar-wipe'], ['blinds', 'blinds'], ['stores', 'blinds'],
        ['diagonal wipe', 'diagonal-wipe'], ['diagonale', 'diagonal-wipe'],
        ['whip left', 'whip-left'], ['whip right', 'whip-right'], ['speed lines', 'speed-lines'],
        ['flash', 'flash'], ['fade to black', 'dip'], ['glitch', 'glitch'], ['zoom punch', 'zoom-punch']];
    for (const [text, type] of asks) {
        assert.equal(FX.transitionFromText(`add a ${text}`), type, `"${text}" gave ${FX.transitionFromText(`add a ${text}`)}`);
    }
});

check('every type has a default duration inside the cap', () => {
    for (const type of FX.TRANSITION_TYPES) {
        const d = FX.TRANSITION_DEFAULT_DURATION[type];
        assert.ok(d > 0, `${type} has no default duration`);
        assert.ok(d <= FX.MAX_TRANSITION_DURATION, `${type} defaults past the cap`);
    }
});

log('\n-- 4. The advanced effects --');

const FXK = ['light-sweep', 'particles', 'gradient-wash', 'chroma-pulse'];

check('all four are classed as frame effects, and sized to the frame', () => {
    for (const kind of FXK) {
        assert.ok(TG.FRAME_EFFECT_KINDS.includes(kind), `${kind} is not classed as a frame effect`);
        assert.equal(TG.TEMPLATE_WIDTH_FRACTION[kind], 1.0, `${kind} is not frame-width`);
    }
});

check('particles are seeded, never random', () => {
    // The preview and the export draw the same frame independently. Anything
    // random would put a particle in a different place in each, and no parity
    // check could say which was right.
    const a = recorder();
    TG.drawTemplate(a.ctx, 'particles', {}, 1.4, 2.6, {});
    const b = recorder();
    TG.drawTemplate(b.ctx, 'particles', {}, 1.4, 2.6, {});
    assert.equal(b.calls.join('|'), a.calls.join('|'), 'two draws of the same frame differ');
    const other = recorder();
    TG.drawTemplate(other.ctx, 'particles', { seed: 99 }, 1.4, 2.6, {});
    assert.notEqual(other.calls.join('|'), a.calls.join('|'), 'the seed changes nothing');
    // The CALL, not the word: the file says "NOT Math.random" in two comments.
    assert.ok(!/Math\.random\s*\(/.test(read('../client/src/motion/TemplateGraphics.js')),
        'something in the catalogue calls Math.random');
});

check('a light sweep is actually on screen through its life', () => {
    // The first version travelled (w + h) * 1.2 with an eased position, which
    // put the band off-frame by halfway and made the effect invisible for most
    // of the clip. Sampled, not reasoned.
    let seen = 0;
    for (const t of [0.4, 0.9, 1.3, 1.7, 2.2]) {
        const r = recorder();
        TG.drawTemplate(r.ctx, 'light-sweep', {}, t, 2.6, {});
        if (r.calls.some(c => c.startsWith('fillRect('))) seen += 1;
    }
    assert.ok(seen >= 4, `the sweep drew in only ${seen} of 5 sampled moments`);
});

check('a numeric param of ZERO is honoured, not replaced by the default', () => {
    // `Number(x) || fallback` is wrong wherever zero is legitimate, because 0
    // is falsy. Asking for no particles gave the default field of 70; a meter
    // set to 0% read as 84%. Three more instances turned up once this one did.
    const zero = recorder();
    TG.drawTemplate(zero.ctx, 'particles', { count: 0 }, 1.4, 2.6, {});
    assert.deepEqual(zero.calls.filter(c => c === 'fill()'), [], 'count: 0 still drew particles');
    const meter = recorder();
    TG.drawTemplate(meter.ctx, 'circular-meter', { value: 0 }, 2.4, 2.6, {});
    const shown = meter.calls.filter(c => /^fillText\(\d/.test(c)).join(' ');
    assert.ok(!/84/.test(shown), `a meter at 0 reported ${shown}`);
});

check('an effect with nothing to show draws nothing', () => {
    for (const [kind, params] of [['particles', { count: 0 }], ['light-sweep', { strength: 0 }],
        ['gradient-wash', { opacity: 0 }], ['chroma-pulse', { strength: 0 }]]) {
        const r = recorder();
        TG.drawTemplate(r.ctx, kind, params, 1.4, 2.6, {});
        assert.ok(!r.calls.some(c => c.startsWith('fillRect(') || c === 'fill()'),
            `${kind} drew with ${JSON.stringify(params)}`);
    }
});

check('junk params never throw', () => {
    const { ctx } = recorder();
    for (const kind of [...FXK, 'icon', 'icon-label', 'icon-row']) {
        for (const t of [-9, 0, 2.6, 999, NaN]) TG.drawTemplate(ctx, kind, {}, t, 2.6, {});
        for (const p of [{ count: -5 }, { count: 1e9 }, { angle: NaN }, { icons: '' },
            { icon: '' }, { strength: 99 }, { opacity: -1 }, { seed: NaN }]) {
            TG.drawTemplate(ctx, kind, p, 1, 2.6, {});
        }
    }
});

log(failures === 0 ? '\nALL ICON + FX TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
