// R123: "illustrate this with b-roll" and similar natural phrasings were being
// hijacked by animate_automatically's bare "illustrate this"/"illustrate the
// video" phrases in CommandRegistry — IntentParser trusts any registry match
// (even non-ambiguous "low" confidence) without ever falling through, so the
// b-roll placement path never got a chance to run and nothing was placed.
// Separately, bare phrasings like "insert b-roll" / "add stock footage"
// matched nothing anywhere and silently resolved to a null operation.
//
// Fix: (1) animate_automatically's `negative` array now vetoes on
// b-roll/footage/stock/cutaway terms, so it no longer wins when those words
// are present; (2) sync_cutaways (CommandRegistry) and the contextualBroll
// NLP_MAP category (IntentParser) both gained the missing natural phrasing.
//
// This pins both: the new phrasings must resolve to sync_cutaways (the real
// b-roll placement command), and the original animate_automatically phrasing
// — bare "illustrate this" with no b-roll/footage/stock mention — must still
// resolve to animate_automatically exactly as before (no regression).
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realWarn = console.warn, realInfo = console.info, realLog = console.log;
console.warn = () => {}; console.info = () => {};

const { IntentParser } = await import('../client/src/agent/IntentParser.js');

const cases = [
  // Previously hijacked by animate_automatically — must now reach b-roll placement.
  ['illustrate this with b-roll', 'sync_cutaways'],
  ['illustrate the video with b-roll', 'sync_cutaways'],
  ['illustrate this with stock footage', 'sync_cutaways'],
  ['illustrate this with footage', 'sync_cutaways'],
  // Previously resolved to nothing (operation: null) — now covered.
  ['insert b-roll', 'sync_cutaways'],
  ['add stock footage', 'sync_cutaways'],
  // Must NOT regress: bare "illustrate" with no b-roll/footage/stock mention
  // is genuinely about motion graphics, not b-roll, and must keep working.
  ['illustrate this', 'animate_automatically'],
  ['illustrate the video', 'animate_automatically'],
  ['animate this automatically', 'animate_automatically'],
];

let allPass = true;
for (const [text, expected] of cases) {
  console.log = () => {};
  const res = await IntentParser.parse(text);
  console.log = realLog;
  const ok = res.operation === expected;
  if (!ok) allPass = false;
  realLog(`${ok ? 'PASS' : 'FAIL'} "${text}" -> operation=${res.operation} (expected ${expected})`);
}
console.warn = realWarn; console.info = realInfo;

if (!allPass) {
  realLog('\nFAILED: b-roll/illustrate routing regression');
  process.exit(1);
}
realLog('\nPASS: b-roll/illustrate routing (R123)');
