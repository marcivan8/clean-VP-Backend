/**
 * client/src/motion/StoryboardQA.js
 *
 * R112 round C — item 3 of the outside assessment: inspect the result, and
 * fix only what is wrong.
 *
 * `SceneValidator` already checks a composed SCENE — safe area, text size,
 * collisions, timing. What nothing checked is the STORYBOARD: a dozen
 * independent graphics, each individually valid, that together cover the
 * speaker's face, stack on top of each other, flash past, or sit over a shot
 * so bright the white card on it cannot be read.
 *
 * Those are properties of the PLAN, not of any one graphic, which is why
 * they survived every existing check.
 *
 * ─── WHAT THIS IS, AND IS NOT ──────────────────────────────────────────────
 *
 * This is the DETERMINISTIC half of the loop the assessment asked for:
 * measurable faults, found by arithmetic on the plan, with a per-beat repair.
 * It is not a vision model. It cannot tell you a card is ugly, that two
 * colours clash, or that a joke landed. The honest division is the one the
 * assessment itself drew — deterministic checks for measurable issues, a
 * human or a vision model for taste — and only the first half is here.
 *
 * What it does have that nothing in VIBED had before: **a repair that
 * changes ONE beat.** Every previous failure path in the motion pipeline
 * either accepted the whole plan or fell back to the whole rules plan
 * (`/api/motion/scene-plan`'s `source: 'rules'`). A plan where one beat
 * overlaps the subject should not cost the other eleven.
 *
 * Pure: no DOM, no canvas, no network.
 */

import { templateSize, TEMPLATE_WIDTH_FRACTION } from './TemplateGraphics.js';
import { contrastRatio } from './ColorTheory.js';
import { LAYOUT_POSITION } from './StoryboardBridge.js';

/** What a QA finding can be. */
export const QA_CODES = Object.freeze({
    OFF_FRAME: 'off_frame',
    SAFE_AREA: 'safe_area',
    OVER_SUBJECT: 'over_subject',
    OVERLAP: 'overlap',
    TOO_BRIEF: 'too_brief',
    LOW_CONTRAST: 'low_contrast',
    CROWDED: 'crowded',
});

/** Findings this module can repair itself, in the order it tries them. */
export const REPAIRABLE = Object.freeze([
    QA_CODES.OFF_FRAME, QA_CODES.SAFE_AREA, QA_CODES.OVER_SUBJECT,
    QA_CODES.OVERLAP, QA_CODES.TOO_BRIEF,
]);

/** Two graphics sharing more than this much of the smaller one collide. */
export const MAX_OVERLAP_SHARE = 0.2;
/** A graphic covering more than this much of the subject box is in the way. */
export const MAX_SUBJECT_SHARE = 0.25;
/** Below this, a graphic flashes rather than reads. */
export const MIN_ON_SCREEN_S = 1.2;
/**
 * The positions a repair may move a graphic to, in preference order.
 *
 * The VERTICAL spots come first and there are several of them, because the
 * side spots are unusable for a wide card: a `quote-card` is 82% of the frame
 * across, so 26/x and 74/x put it off-frame every time. A list that was
 * mostly side positions left wide cards with exactly one option and reported
 * "no free position" the moment two of them shared the screen.
 */
export const SAFE_SPOTS = Object.freeze([
    { x: 50, y: 24 }, { x: 50, y: 20 }, { x: 50, y: 30 }, { x: 50, y: 70 },
    { x: 50, y: 76 }, { x: 50, y: 64 },
    { x: 26, y: 30 }, { x: 74, y: 30 }, { x: 26, y: 72 }, { x: 74, y: 72 },
    { x: 50, y: 50 },
]);

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/**
 * The box a placement occupies, in FRAME FRACTIONS.
 *
 * The overlay pipeline draws a template at `TEMPLATE_WIDTH_FRACTION` of the
 * frame width, centred on (x, y) as percentages — the same arithmetic
 * `addTemplateClip` uses to derive its `scale`. Height follows from the
 * template's own aspect, so a tall card is measured as tall.
 */
export function boxFor(placement, frame) {
    const fw = num(frame?.w, 1080);
    const fh = num(frame?.h, 1920);
    let wFrac = 0.5;
    let aspect = 2;
    if (placement?.source === 'template' && placement.id) {
        wFrac = num(TEMPLATE_WIDTH_FRACTION[placement.id], 0.5);
        // An unknown kind must not take the whole inspection down with it:
        // the QA pass runs over a plan that may have come from anywhere.
        let size = null;
        try { size = templateSize(placement.id, placement.params || {}); } catch { size = null; }
        if (size && size.w > 0 && size.h > 0) aspect = size.w / size.h;
    } else {
        // A composed component measures itself at layout time; 46% of the
        // frame is the measure SceneLayout gives a block of text.
        wFrac = 0.46;
        aspect = 3;
    }
    const w = wFrac;
    const h = (wFrac * fw) / aspect / fh;
    const cx = num(placement?.x, 50) / 100;
    const cy = num(placement?.y, 50) / 100;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Overlapping area of two fraction boxes, as a share of the smaller one. */
export function overlapShare(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (!(w > 0) || !(h > 0)) return 0;
    const smaller = Math.min(a.w * a.h, b.w * b.h);
    return smaller > 0 ? round((w * h) / smaller) : 0;
}

/** Do two placements share any time on screen at all? */
export function overlapInTime(a, b) {
    return num(a.start, 0) < num(b.start, 0) + num(b.duration, 0) - 1e-6
        && num(b.start, 0) < num(a.start, 0) + num(a.duration, 0) - 1e-6;
}

function finding(code, placement, message, detail = {}) {
    return { code, beatId: placement?.beatId || null, graphic: placement?.graphic || null, message, detail };
}

/**
 * Inspect a whole storyboard.
 *
 * @param {Array} placements from StoryboardBridge.placementsFor
 * @param {object} [opts]
 * @param {{w:number,h:number}} [opts.frame]
 * @param {{top:number,bottom:number,left:number,right:number}} [opts.safeZone]
 * @param {{x:number,y:number,w:number,h:number}} [opts.subject] the speaker
 *        box in frame fractions, from FootageAnalyzer or a MatteBaker track
 * @param {string} [opts.backdrop] an average colour sampled off the footage
 * @returns {{ findings:Array, ok:boolean }}
 */
export function inspect(placements, opts = {}) {
    // A null or malformed entry is dropped rather than inspected: a QA pass
    // that throws on bad input is a QA pass nobody can run on bad input.
    const list = (Array.isArray(placements) ? placements : []).filter(p => p && typeof p === 'object');
    const frame = opts.frame || { w: 1080, h: 1920 };
    const sz = opts.safeZone || null;
    const subject = opts.subject || null;
    const findings = [];

    const boxes = list.map(p => ({ p, box: boxFor(p, frame) }));

    for (const { p, box } of boxes) {
        if (box.x < -0.001 || box.y < -0.001 || box.x + box.w > 1.001 || box.y + box.h > 1.001) {
            findings.push(finding(QA_CODES.OFF_FRAME, p, 'part of this graphic is outside the frame', { box }));
        } else if (sz) {
            const over = box.y < num(sz.top, 0)
                || box.y + box.h > 1 - num(sz.bottom, 0)
                || box.x < num(sz.left, 0)
                || box.x + box.w > 1 - num(sz.right, 0);
            // The caption bar and the platform's own buttons live here.
            if (over) findings.push(finding(QA_CODES.SAFE_AREA, p, 'this graphic reaches into the area the platform covers with its own interface', { box }));
        }

        if (subject) {
            const share = overlapShare(box, subject);
            if (share > MAX_SUBJECT_SHARE) {
                findings.push(finding(QA_CODES.OVER_SUBJECT, p, 'this graphic sits over the person speaking', { share }));
            }
        }

        if (num(p.duration, 0) < MIN_ON_SCREEN_S) {
            findings.push(finding(QA_CODES.TOO_BRIEF, p, 'this graphic is on screen too briefly to read', { duration: round(num(p.duration, 0), 2) }));
        }

        if (opts.backdrop) {
            // Only the graphic's OWN declared colour can be checked here; the
            // card's internal contrast is TemplateGraphics' business. What
            // this catches is a bright accent on a bright shot.
            const colour = p.params?.color || p.params?.accent || null;
            if (colour) {
                const ratio = contrastRatio(colour, opts.backdrop);
                if (ratio < 2) {
                    findings.push(finding(QA_CODES.LOW_CONTRAST, p, 'this graphic\'s colour nearly matches the shot behind it', { ratio: round(ratio, 2) }));
                }
            }
        }
    }

    for (let i = 0; i < boxes.length; i++) {
        for (let k = i + 1; k < boxes.length; k++) {
            if (!overlapInTime(boxes[i].p, boxes[k].p)) continue;
            const share = overlapShare(boxes[i].box, boxes[k].box);
            if (share > MAX_OVERLAP_SHARE) {
                findings.push(finding(QA_CODES.OVERLAP, boxes[k].p,
                    'this graphic lands on top of the one already on screen', { share, with: boxes[i].p.beatId }));
            }
        }
    }

    // Density, as a property of the whole plan rather than any one beat.
    //
    // Measured against the VIDEO's duration, which the caller must supply.
    // The first version measured it against the extent of the placements
    // themselves, so a single 2-second graphic computed as thirty a minute
    // and every clean plan with one card in it reported "crowded". With no
    // duration there is nothing to measure against, and inventing a span is
    // how that bug happened — so the check simply does not run.
    const span = num(opts.duration, 0);
    if (span > 0 && (list.length / span) * 60 > num(opts.maxPerMinute, 14)) {
        findings.push(finding(QA_CODES.CROWDED, null, 'there are more graphics a minute here than a viewer can follow',
            { perMinute: round((list.length / span) * 60, 1) }));
    }

    return { findings, ok: findings.length === 0 };
}

/**
 * Repair the beats that are wrong, and ONLY those.
 *
 * This is the part the assessment specifically asked for: "retry only the
 * problematic scene or element when possible, rather than regenerating the
 * entire video." A placement with no finding against it comes back
 * byte-identical — asserted by a check, because a repair pass that quietly
 * rewrites everything is the same failure as regenerating the whole video.
 *
 * @returns {{ placements:Array, repairs:Array, unresolved:Array }}
 */
export function repair(placements, opts = {}) {
    const list = (Array.isArray(placements) ? placements : []).filter(p => p && typeof p === 'object');
    const frame = opts.frame || { w: 1080, h: 1920 };
    const { findings } = inspect(list, opts);

    const byBeat = new Map();
    for (const f of findings) {
        if (!f.beatId || !REPAIRABLE.includes(f.code)) continue;
        if (!byBeat.has(f.beatId)) byBeat.set(f.beatId, []);
        byBeat.get(f.beatId).push(f);
    }

    const repairs = [];
    const unresolved = [];
    // Repaired in place so a move is visible to the next beat's overlap check:
    // two graphics both moved to the same free spot would still collide.
    const out = list.map(p => ({ ...p }));

    for (const p of out) {
        const mine = byBeat.get(p.beatId);
        if (!mine || mine.length === 0) continue;

        const codes = new Set(mine.map(f => f.code));
        let fixed = [];

        if (codes.has(QA_CODES.TOO_BRIEF)) {
            const was = num(p.duration, 0);
            p.duration = round(Math.max(MIN_ON_SCREEN_S, was));
            fixed.push(`held for ${p.duration}s instead of ${round(was, 2)}s`);
        }

        if (codes.has(QA_CODES.OFF_FRAME) || codes.has(QA_CODES.SAFE_AREA)
            || codes.has(QA_CODES.OVER_SUBJECT) || codes.has(QA_CODES.OVERLAP)) {
            const others = out.filter(o => o !== p && overlapInTime(o, p)).map(o => boxFor(o, frame));
            const spot = SAFE_SPOTS.find(candidate => {
                const box = boxFor({ ...p, x: candidate.x, y: candidate.y }, frame);
                if (box.x < 0 || box.y < 0 || box.x + box.w > 1 || box.y + box.h > 1) return false;
                if (opts.safeZone) {
                    const sz = opts.safeZone;
                    if (box.y < num(sz.top, 0) || box.y + box.h > 1 - num(sz.bottom, 0)
                        || box.x < num(sz.left, 0) || box.x + box.w > 1 - num(sz.right, 0)) return false;
                }
                if (opts.subject && overlapShare(box, opts.subject) > MAX_SUBJECT_SHARE) return false;
                return others.every(o => overlapShare(box, o) <= MAX_OVERLAP_SHARE);
            });
            if (spot) {
                p.x = spot.x;
                p.y = spot.y;
                fixed.push(`moved to ${spot.x}/${spot.y}`);
            } else {
                // Nowhere clear to put it. Saying so is the right answer:
                // moving it somewhere that is also wrong would make the
                // report say "repaired" about a graphic still in the way.
                unresolved.push({ beatId: p.beatId, codes: [...codes], reason: 'no free position for this graphic' });
            }
        }

        if (fixed.length) repairs.push({ beatId: p.beatId, graphic: p.graphic, fixed });
    }

    for (const f of findings) {
        if (!REPAIRABLE.includes(f.code)) unresolved.push({ beatId: f.beatId, codes: [f.code], reason: f.message });
    }

    return { placements: out, repairs, unresolved };
}

/** A sentence per finding, for the chat. */
export function describe(findings) {
    return (findings || []).map(f => f.message);
}

export default {
    QA_CODES, REPAIRABLE, MAX_OVERLAP_SHARE, MAX_SUBJECT_SHARE, MIN_ON_SCREEN_S, SAFE_SPOTS,
    boxFor, overlapShare, overlapInTime, inspect, repair, describe,
};
