// R124 — a long, multi-section creative brief (the kind of document a user
// pastes wholesale into the AI chat, describing an entire creative edit in
// 10+ sections) must resolve to ONE long_form_edit (FULL_BUILD) request with
// its caption-specific instructions preserved — not get hijacked by whichever
// single CommandRegistry phrase happens to appear somewhere inside it.
//
// This is the exact failure mode reported and reproduced: a real user-supplied
// brief containing "captions"/"keywords"/etc. among a dozen other instructions
// was resolving to the single, narrow `auto_captions` operation, silently
// discarding every other instruction in the brief (pacing, motion graphics,
// camera work, design consistency, QC pass — none of it ever executed).
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realWarn = console.warn, realInfo = console.info, realLog = console.log;
console.warn = () => {}; console.info = () => {};

const { IntentParser } = await import('../client/src/agent/IntentParser.js');

// A condensed excerpt of the real reported brief — same section headers and
// phrasing as the original multi-section "DYNAMIC CREATOR EDIT" document,
// trimmed for test readability but carrying the same signal: role-play
// production language, a dedicated captions section, and a closing objective.
const BRIEF = `# VIBED AI VIDEO EDITING PROMPT — DYNAMIC CREATOR EDIT

## ROLE

Act as a senior YouTube video editor, motion designer, creative director, and
visual storyteller. Your task is to transform my uploaded raw video into a
polished, modern, dynamic talking-head video inspired by the visual editing
style of the reference videos provided.

Do not simply add subtitles to the footage. Make the video visually
communicate the ideas being spoken.

## 4. DYNAMIC CAPTIONS

Generate accurate, synchronized captions throughout the video.

Caption requirements:
- Highlight important keywords using an accent color, weight change, scale
  animation, or background shape.
- Keep captions clear of the speaker's face, mouth, hands, and other
  important visual information.
- Respect platform-safe margins and avoid covering existing on-screen text.
- Use readable, modern typography with strong contrast against the
  background.

## FINAL OBJECTIVE

Deliver a complete, polished, professionally edited video inspired by the
supplied reference style.`;

console.log = () => {};
const res = await IntentParser.parse(BRIEF);
console.log = realLog;
console.warn = realWarn; console.info = realInfo;

const ok = (name) => realLog(`✓ ${name}`);

assert.equal(res.operation, 'long_form_edit', `expected long_form_edit, got ${res.operation}`);
ok('a full multi-section creative brief resolves to long_form_edit, not a single hijacked command');

assert.equal(res.constraints.editMode, 'FULL_BUILD');
ok('editMode is FULL_BUILD — a from-scratch creative rebuild, not a narrow clean-up');

assert.ok(res.constraints.captionBrief, 'captionBrief must be attached');
assert.equal(res.constraints.captionBrief.wantsCaptions, true);
assert.equal(res.constraints.captionBrief.wantsKeywordEmphasis, true);
assert.equal(res.constraints.captionBrief.keepClearOfFace, true);
assert.equal(res.constraints.captionBrief.safeMargins, true);
assert.equal(res.constraints.captionBrief.stylePresetId, 'clean-modern');
ok('the caption section\'s detail (emphasis, face-clear, safe margins, style) survives into constraints.captionBrief');

// Regression guard: a short, genuinely single-purpose request mentioning
// "captions" must still resolve to the plain auto_captions command — this
// fix must not swallow every message that happens to say the word "caption".
console.log = () => {};
const shortRes = await IntentParser.parse('add captions to this video');
console.log = realLog;
assert.equal(shortRes.operation, 'auto_captions', `expected auto_captions for a short direct request, got ${shortRes.operation}`);
ok('a short, direct "add captions" request still resolves to auto_captions — no regression for simple commands');

realLog('\nALL LONG-FORM CREATIVE BRIEF TESTS PASSED');
