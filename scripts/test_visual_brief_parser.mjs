// R125 — VisualBriefParser extracts the visual-direction signal from a long
// free-text brief: whether contextual b-roll/motion graphics were asked for,
// and whether the brief used actual color/mood language (not just any
// mention of "color").
import assert from 'assert/strict';
import { parseVisualBrief } from '../client/src/agent/VisualBriefParser.js';

const log = console.log;
const ok = (name) => log(`✓ ${name}`);

// 1. The real brief's own section 1 + 5 language.
{
    const brief = `Do not simply add subtitles to the footage. Make the video
    visually communicate the ideas being spoken. For each important idea,
    decide whether a visual would make the message easier to understand —
    consider floating cards, b-roll, or a relevant cutaway.`;
    const v = parseVisualBrief(brief);
    assert.equal(v.wantsContextualBroll, true);
    ok('"visually communicate"/"b-roll"/"cutaway"/"floating card" language is detected');
}

// Explicit graphics language opts the complete edit into a video-wide storyboard.
{
    const brief = 'Add animated callouts for each important idea and use concise labels.';
    const v = parseVisualBrief(brief);
    assert.equal(v.wantsMotionGraphics, true);
    ok('explicit motion-graphics direction is detected for the video storyboard');
}

// 2. A plain request with none of this language reports nothing.
{
    const v = parseVisualBrief('remove the silences from my video');
    assert.equal(v.wantsContextualBroll, false);
    assert.equal(v.wantsMotionGraphics, false);
    assert.equal(v.colorMoodQuery, null);
    ok('a request with no visual-direction language at all reports nothing — no false positives');
}

// 3. Mood language resolves to the right LUT query, and more specific
// phrasing ("golden hour") wins over a later, broader category.
{
    const v = parseVisualBrief('I want a warm, golden hour, vintage film look');
    assert.equal(v.colorMoodQuery, 'warm golden hour vintage film');
    ok('"golden hour"/"vintage" resolves to the warm/vintage LUT query');
}
{
    const v = parseVisualBrief('make it black and white, almost monochrome');
    assert.equal(v.colorMoodQuery, 'black and white desaturated');
    ok('"black and white"/"monochrome" resolves to the correct LUT query, not a generic fallback');
}


// 4. An explicit brand/accent color (hex or name) is captured, but only when
// actually framed as a brand instruction — not any incidental color mention.
{
    const v = parseVisualBrief('Our accent color is teal, use it throughout.');
    assert.equal(v.accentColorHex, '#0d9488');
    ok('"accent color is teal" resolves to the named color\'s hex');
}
{
    const v = parseVisualBrief('Brand color: #1a73e8 for every graphic.');
    assert.equal(v.accentColorHex, '#1a73e8');
    ok('an explicit hex after "brand color" is captured directly');
}
{
    const v = parseVisualBrief('The car in the footage is bright red.');
    assert.equal(v.accentColorHex, null);
    ok('an incidental color mention unrelated to branding is correctly ignored');
}

log('\nALL VISUAL BRIEF PARSER TESTS PASSED');
