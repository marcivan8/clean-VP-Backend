// R124 — CaptionBriefParser extracts captions-specific signal from a long,
// free-text creative brief (the kind of multi-section document a user pastes
// wholesale, not a short canned phrase). Pure function, no store/network.
import assert from 'assert/strict';
import { parseCaptionBrief } from '../client/src/agent/CaptionBriefParser.js';

const log = console.log;
const ok = (name) => log(`✓ ${name}`);

// 1. The real-world case this was built for: a long multi-section creative
// brief whose "DYNAMIC CAPTIONS" section describes exactly this behaviour in
// prose, buried among a dozen other unrelated sections.
const megaBrief = `
## 4. DYNAMIC CAPTIONS

Generate accurate, synchronized captions throughout the video.

Caption requirements:

- Use readable, modern typography with strong contrast against the background.
- Highlight important keywords using an accent color, weight change, scale animation, or background shape.
- Use subtle pop, fade, slide, or spring animations for selected words.
- Keep captions clear of the speaker's face, mouth, hands, and other important visual information.
- Respect platform-safe margins and avoid covering existing on-screen text.
`;
{
    const brief = parseCaptionBrief(megaBrief);
    assert.equal(brief.wantsCaptions, true);
    assert.equal(brief.wantsKeywordEmphasis, true);
    assert.equal(brief.keepClearOfFace, true);
    assert.equal(brief.safeMargins, true);
    // "modern" appears, and nothing more specific (bold/cinematic/etc.) does —
    // should resolve to the clean-modern catch-all, not stay null.
    assert.equal(brief.stylePresetId, 'clean-modern');
    ok('a long multi-section creative brief: captions, emphasis, face-clear, safe-margins, and style all detected');
}

// 2. A short, plain request with none of this detail must not fabricate signal.
{
    const brief = parseCaptionBrief('remove the silences from my video');
    assert.equal(brief.wantsCaptions, false);
    assert.equal(brief.wantsKeywordEmphasis, false);
    assert.equal(brief.stylePresetId, null);
    ok('a request with no caption language at all reports nothing — no false positives');
}

// 3. A bold/viral caption ask should pick bold-impact, not the generic fallback.
{
    const brief = parseCaptionBrief('make the captions bold and punchy, TikTok style, with high contrast');
    assert.equal(brief.stylePresetId, 'bold-impact');
    ok('"bold", "punchy", "TikTok", "high contrast" resolve to bold-impact, not clean-modern');
}

// 4. Cinematic/documentary language should pick cinematic over the generic fallback.
{
    const brief = parseCaptionBrief('I want a cinematic, documentary-style caption look for this film');
    assert.equal(brief.stylePresetId, 'cinematic');
    ok('"cinematic"/"documentary" resolves to the cinematic preset');
}

// 5. Curly-quote apostrophe (what Word/Notion/iMessage actually paste) must
// still match "speaker's face" — a straight-quote-only check would silently
// miss the far more common real-world spelling.
{
    const brief = parseCaptionBrief("Keep text away from the speaker’s face at all times.");
    assert.equal(brief.keepClearOfFace, true);
    ok('a curly apostrophe in "speaker’s face" is still detected (not just the straight-quote spelling)');
}

log('\nALL CAPTION BRIEF PARSER TESTS PASSED');
