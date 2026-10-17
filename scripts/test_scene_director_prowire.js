/**
 * scripts/test_scene_director_prowire.js
 *
 *   node scripts/test_scene_director_prowire.js
 *
 * R102 — the full SceneDirector (composeSceneFromBrief), auto-triggered from
 * polishShort()'s hook + a new CTA-outro layer, instead of only ever
 * reachable through the manual "design_scene" command. Verifies:
 *   1. With no scenePlan, polishShort behaves EXACTLY as before (single
 *      static title, no CTA) — the new path is additive, never a
 *      regression when AI is unavailable.
 *   2. With a real scenePlan, the hook becomes a multi-beat AI-directed
 *      sequence, and a CTA outro appears near the end when the plan has one.
 *   3. SceneDirector's own "never invent claims" rule is respected: a
 *      scenePlan with no usable text produces no placeholder beats.
 *   4. A short too brief to fit both a hook and a CTA skips the CTA rather
 *      than overlapping it with the hook.
 */

'use strict';

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`);
    else { failures++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};

const BASE_PROFILE = { id: 'tiktok', hookSeconds: 1.5, safeZone: { top: 0.12, bottom: 0.18, left: 0.06, right: 0.06 }, captionY: 70, sfx: 'full' };

const builtFor = (duration) => ({
    tracks: [{ id: 'track-video', type: 'video', name: 'Video', clips: [{ id: 'v1', type: 'video', start: 0, duration }] }],
    duration,
    aspectRatio: '9:16',
});

const idsOf = (tracks, prefix) => tracks.flatMap(t => t.clips || []).filter(c => String(c.id || '').startsWith(prefix)).map(c => c.id);

async function main() {
    const { polishShort } = await import('../client/src/agent/shortPolish.js');

    // ── 1. No scenePlan: unchanged single-title behaviour, no CTA ──────────
    {
        const result = polishShort(builtFor(20), BASE_PROFILE, {
            words: [{ word: 'Here', start: 0.1 }, { word: 'is', start: 0.3 }, { word: 'a', start: 0.4 }, { word: 'great', start: 0.5 }, { word: 'tip', start: 0.7 }],
            events: [],
        });
        check('no scenePlan -> exactly one hook text clip', idsOf(result.tracks, 'short-hook-text-').length === 1,
            `got ${JSON.stringify(idsOf(result.tracks, 'short-hook-text-'))}`);
        check('no scenePlan -> no CTA clips', idsOf(result.tracks, 'short-cta-').length === 0);
        check('no scenePlan -> applied lists "hook title" (not "AI-directed")', result.applied.some(a => a === 'hook title'));
    }

    // ── 2. Real scenePlan: multi-beat hook + CTA outro ──────────────────────
    {
        const scenePlan = { title: 'This Changes Everything', points: ['Saves you three hours a week'], cta: 'Follow for more' };
        const result = polishShort(builtFor(20), BASE_PROFILE, {
            words: [{ word: 'This', start: 0.1 }],
            events: [],
            scenePlan,
        });
        const hookTexts = idsOf(result.tracks, 'short-hook-text-');
        const ctaTexts = idsOf(result.tracks, 'short-cta-text-');
        check('scenePlan -> hook produces at least one designed text layer', hookTexts.length >= 1, JSON.stringify(hookTexts));
        check('scenePlan -> applied mentions "AI-directed" hook sequence', result.applied.some(a => /AI-directed/.test(a)), JSON.stringify(result.applied));
        check('scenePlan -> CTA outro produced', ctaTexts.length >= 1, JSON.stringify(ctaTexts));
        check('scenePlan -> applied mentions "cta outro"', result.applied.includes('cta outro'), JSON.stringify(result.applied));

        // The CTA clip must sit near the END of the short, not collide with the hook.
        const ctaClip = result.tracks.flatMap(t => t.clips).find(c => ctaTexts.includes(c.id));
        check('CTA clip starts in the back half of the short', Number(ctaClip?.start) > 10, `start=${ctaClip?.start}`);
    }

    // ── 3. scenePlan with nothing usable -> no placeholder beats ────────────
    {
        const result = polishShort(builtFor(20), BASE_PROFILE, {
            words: [{ word: 'Hello', start: 0.1 }, { word: 'world', start: 0.3 }],
            events: [],
            scenePlan: { title: '', points: [], cta: '' },
        });
        check('empty scenePlan -> falls back to the plain single title (no "YOUR HEADLINE")',
            !result.tracks.some(t => (t.clips || []).some(c => /YOUR HEADLINE|YOUR CALL TO ACTION/i.test(String(c.content || c.name || '')))));
        check('empty scenePlan -> no CTA clips (no cta text to show)', idsOf(result.tracks, 'short-cta-').length === 0);
    }

    // ── 4. Too short for hook + CTA both -> CTA is skipped, not overlapped ──
    {
        const scenePlan = { title: 'Quick Tip', points: [], cta: 'Follow for more' };
        const result = polishShort(builtFor(2.0), BASE_PROFILE, {
            words: [{ word: 'Quick', start: 0.1 }],
            events: [],
            scenePlan,
        });
        check('very short short -> no CTA clip emitted (would overlap the hook)',
            idsOf(result.tracks, 'short-cta-').length === 0,
            JSON.stringify(idsOf(result.tracks, 'short-cta-')));
    }

    console.log('');
    if (failures > 0) {
        console.error(`${failures} FAILED`);
        process.exit(1);
    }
    console.log('ALL SCENE DIRECTOR PRO-FINISH WIRING TESTS PASSED');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
