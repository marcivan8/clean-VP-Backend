#!/usr/bin/env node
/**
 * Regression: preview aspect fit (CLAUDE.md R53).
 *
 * THE BUG: the WebGL vertex shader used a FIXED full-screen quad
 * (`gl_Position = vec4(a_position, 0.0, 1.0)`) with no aspect correction, and
 * the canvas buffer was sized from the ACTIVE CLIP's native dimensions rather
 * than the project frame. Switching a 9:16 project to 16:9 therefore scaled the
 * source ~3x to cover the new width — visibly soft, top and bottom cropped off.
 * Export letterboxed correctly the whole time
 * (force_original_aspect_ratio=decrease,pad=...), so preview and export
 * disagreed about what the user was making.
 *
 * computeContainFit() is the geometry that fixes it, and the only part
 * verifiable without a browser — so it is verified thoroughly here. The visual
 * result still needs a human to look at it.
 *
 * Run: node scripts/test_aspect_fit.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const section = (t) => console.log(`\n${t}`);

// Load the pure function out of the ES module without a bundler.
const src = fs.readFileSync(
    path.resolve(__dirname, '../client/src/engine/PlaybackEngine.js'), 'utf8');
const fnSrc = src.slice(
    src.indexOf('export function computeContainFit'),
    src.indexOf('const PlaybackState = {')
).replace('export function', 'function');
const computeContainFit = new Function(`${fnSrc}; return computeContainFit;`)();

const P916 = 9 / 16;    // portrait source
const L169 = 16 / 9;    // landscape source

async function main() {

    section('1 · THE REPORTED BUG: 9:16 source in a 16:9 frame');
    {
        const fit = computeContainFit({
            sourceAspect: P916, frameWidth: 1920, frameHeight: 1080,
        });

        check('height fills the frame', near(fit.y, 1), `y=${fit.y}`);
        check('width is pillarboxed', fit.x < 1, `x=${fit.x}`);
        // 9:16 in 16:9 → the source occupies (9/16)/(16/9) = 0.3164 of the width.
        check('width scale is exactly the aspect ratio of the ratios',
            near(fit.x, P916 / L169), `expected ${P916 / L169}, got ${fit.x}`);
        check('the source is NOT scaled up past the frame',
            fit.x <= 1 && fit.y <= 1,
            'any value > 1 means the source overflows — the bug being fixed');
    }

    section('2 · The mirror case: 16:9 source in a 9:16 frame');
    {
        const fit = computeContainFit({
            sourceAspect: L169, frameWidth: 1080, frameHeight: 1920,
        });
        check('width fills the frame', near(fit.x, 1), `x=${fit.x}`);
        check('height is letterboxed', fit.y < 1, `y=${fit.y}`);
        check('height scale is correct', near(fit.y, P916 / L169), `${fit.y}`);
    }

    section('3 · Matching aspects fill exactly, with no bars');
    {
        for (const [label, a, w, h] of [
            ['16:9 in 16:9', L169, 1920, 1080],
            ['9:16 in 9:16', P916, 1080, 1920],
            ['1:1 in 1:1',   1,    1080, 1080],
        ]) {
            const fit = computeContainFit({ sourceAspect: a, frameWidth: w, frameHeight: h });
            check(`${label} → identity`, near(fit.x, 1) && near(fit.y, 1),
                `${fit.x},${fit.y}`);
        }
    }

    section('4 · A crop changes the VISIBLE aspect, so it changes the fit');
    {
        // R14 virtual multicam: cropping to the middle 50% of a 16:9 source
        // makes the visible region 8:9 — taller than wide.
        const uncropped = computeContainFit({
            sourceAspect: L169, frameWidth: 1920, frameHeight: 1080,
        });
        const cropped = computeContainFit({
            sourceAspect: L169, cropW: 0.5, cropH: 1, frameWidth: 1920, frameHeight: 1080,
        });

        check('uncropped 16:9 fills a 16:9 frame', near(uncropped.x, 1) && near(uncropped.y, 1));
        check('a half-width crop is now pillarboxed', cropped.x < 1,
            'fitting the UNCROPPED shape would stretch the crop — the R14 composition trap');
        check('the crop fit uses the cropped aspect',
            near(cropped.x, (L169 * 0.5) / L169), `${cropped.x}`);
    }

    section('5 · Unknown inputs degrade to identity, never to a collapsed frame');
    {
        const cases = [
            ['no source aspect',   { frameWidth: 1920, frameHeight: 1080 }],
            ['null source aspect', { sourceAspect: null, frameWidth: 1920, frameHeight: 1080 }],
            ['zero source aspect', { sourceAspect: 0, frameWidth: 1920, frameHeight: 1080 }],
            ['no frame dims',      { sourceAspect: P916 }],
            ['zero frame width',   { sourceAspect: P916, frameWidth: 0, frameHeight: 1080 }],
            ['NaN everywhere',     { sourceAspect: NaN, frameWidth: NaN, frameHeight: NaN }],
            ['no args',            undefined],
        ];
        for (const [label, args] of cases) {
            const fit = computeContainFit(args);
            check(`${label} → identity`, near(fit.x, 1) && near(fit.y, 1),
                `${fit.x},${fit.y} — a non-identity value here would distort or blank the frame`);
        }
        check('a zero crop falls back to full frame',
            near(computeContainFit({ sourceAspect: L169, cropW: 0, cropH: 0,
                frameWidth: 1920, frameHeight: 1080 }).x, 1));
    }

    section('6 · Never scales UP — that is the whole point');
    {
        // Every combination must produce factors <= 1. A factor > 1 means the
        // source is being enlarged past the frame, which is the cover-fit
        // behaviour that caused the quality loss.
        let violations = 0;
        for (const a of [P916, L169, 1, 4 / 5, 21 / 9, 0.5, 2.35]) {
            for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080], [2560, 1080]]) {
                const f = computeContainFit({ sourceAspect: a, frameWidth: w, frameHeight: h });
                if (f.x > 1 + 1e-9 || f.y > 1 + 1e-9) violations++;
            }
        }
        check('no combination scales beyond the frame', violations === 0, `${violations} did`);
    }

    section('7 · The engine and player are wired to it');
    {
        check('the vertex shader applies the fit',
            /gl_Position = vec4\(pos, 0\.0, 1\.0\)/.test(src)
            && /a_position \* u_fitScale \* u_userScale \+ u_userOffset/.test(src),
            'the fixed full-screen quad is what caused the stretch');
        check('the old unfitted quad is gone',
            !/gl_Position = vec4\(a_position, 0\.0, 1\.0\)/.test(src));
        check('fit uniforms are uploaded each draw',
            /uniform2f\(this\.loc\.fitScale/.test(src));
        check('resize recomputes the fit', /resize\(width, height\)[\s\S]{0,240}_recomputeFit\(\)/.test(src));
        // Anchor on the method DEFINITION — the doc comment above it contains
        // `setCrop(0, 0, 1, 1)` examples that a looser pattern matches first.
        check('setCrop recomputes the fit',
            /setCrop\(x = 0, y = 0, w = 1, h = 1\) \{[\s\S]{0,400}_recomputeFit\(\)/.test(src));
        check('a user transform composes on top, not instead',
            /u_userScale/.test(src) && /setUserTransform/.test(src));

        const player = fs.readFileSync(
            path.resolve(__dirname, '../client/src/components/Player/VideoPlayer.jsx'), 'utf8');
        check('the buffer is derived from the project frame',
            /frameAspectRef\.current/.test(player) && /frameIsLandscape/.test(player));
        check('the buffer is no longer the clip\'s native shape',
            !/const targetWidth\s*=\s*native \? Math\.floor\(native\.width/.test(player),
            'sizing the buffer from the clip is what made preview disagree with export');
        check('the engine is told the source aspect',
            /setSourceAspect\?\.\(videoWidth, videoHeight\)/.test(player));
        check('changing the ratio re-runs the sizing',
            /resizeHandlerRef\.current\?\.\(\)/.test(player),
            'a ResizeObserver only fires on container changes, not ratio changes');
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Aspect fit: ${passed} passed, ${failed} failed`);
    console.log('─'.repeat(60));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('\nHarness crashed:', e); process.exit(1); });
