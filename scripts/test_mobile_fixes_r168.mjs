// scripts/test_mobile_fixes_r168.mjs — R105 mobile round: saved conversation,
// cut-on-caption-delete, no silent "done", preview held during AI work, swatch
// images, mobile tab strip. Pure modules are EXECUTED; wiring is read.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const { findDeletedWords } = await import('../client/src/motion/captionEdits.js');
const { serializeConversation, parseConversation, MAX_SAVED_ITEMS } = await import('../client/src/agent/conversationPersistence.js');
const { isSilentNoop, isReadOnlyAction, changedKeys } = await import('../client/src/agent/editChangeCheck.js');

console.log('\n§1 removing words from a caption finds where they were said');
const W = [['Bonjour', 0, 0.4], ['euh', 0.5, 0.8], ['je', 0.9, 1.0], ['suis', 1.0, 1.3], ['Marc,', 1.4, 1.9]]
    .map(([text, start, end]) => ({ text, start, end }));
let r = findDeletedWords(W, 'Bonjour euh je suis Marc,', 'Bonjour je suis Marc,');
ok(r.deleted.join() === '1' && r.ranges.length === 1 && r.ranges[0][0] === 0.5 && r.ranges[0][1] === 0.8, 'one deleted word → its exact span (0.5 to 0.8 s)');
ok(r.kept.length === 4 && r.kept[1].start === 0.9, 'the words left keep their real timing');
r = findDeletedWords(W, 'Bonjour euh je suis Marc,', 'Bonjour Marc,');
ok(r.ranges.length === 1 && r.ranges[0][0] === 0.5 && r.ranges[0][1] === 1.3, 'adjacent deleted words merge into one cut');
r = findDeletedWords(W, 'Bonjour euh je suis Marc,', 'euh je suis');
ok(r.ranges.length === 2, 'deletions at both ends are two cuts');
ok(findDeletedWords(W, 'Bonjour euh je suis Marc,', 'Bonjour euh je suis marc').ranges.length === 0, 'case and punctuation changes cut nothing');
ok(findDeletedWords(W, 'Bonjour euh je suis Marc,', 'Bonjour heu je suis Marc,').ranges.length === 0, 'a re-typed word (spelling fix) cuts nothing');
ok(findDeletedWords(W, 'Bonjour euh je suis Marc,', 'Salut je suis Marc,').ranges.length === 0, 'replacing two words with one is a rewrite, not a deletion');
ok(findDeletedWords(W.slice(0, 3), 'Bonjour euh je suis Marc,', 'Bonjour').ranges.length === 0, 'words that cannot be mapped to the text cut nothing');
ok(findDeletedWords([], 'a b', 'a').ranges.length === 0, 'a caption without timed words cuts nothing');

console.log('\n§2 the conversation survives a save');
const logs = [{ id: 'a', type: 'user', text: 'hi', _seq: 1, fn: () => 1 }, { id: 's', type: 'step', text: 'x', done: false, _seq: 2 }, { id: 'clarification-1', type: 'q', _seq: 3 }, { id: 't', type: 'thinking', _seq: 4 }];
const sug = [{ id: 'b', type: 'brain_advisory', data: { m: 'x' }, _seq: 5 }];
const saved = serializeConversation({ logs, suggestions: sug });
ok(saved.v === 1 && saved.logs.length === 2 && saved.suggestions.length === 1, 'kept: messages and cards; dropped: open clarifications and spinners');
ok(saved.logs[1].done === true && !('fn' in saved.logs[0]), 'steps are saved as finished and functions are stripped');
ok(JSON.parse(JSON.stringify(saved)).logs.length === 2, 'the saved value is plain JSON');
const many = serializeConversation({ logs: Array.from({ length: 500 }, (_, i) => ({ id: i, type: 'user', _seq: i })), suggestions: [] });
ok(many.logs.length === MAX_SAVED_ITEMS && many.logs[0]._seq === 300, `capped at the latest ${MAX_SAVED_ITEMS}`);
ok(serializeConversation({ logs: [], suggestions: [] }) === null, 'an empty chat saves nothing');
ok(parseConversation(null).logs.length === 0 && parseConversation({ v: 2 }).logs.length === 0 && parseConversation(saved).logs.length === 2, 'unusable values read as an empty chat');

console.log('\n§3 a command cannot say "done" over an unchanged project');
const tr = [];
ok(isSilentNoop([{ action: 'addClip' }], { tracks: tr, currentTime: 0, past: [] }, { tracks: tr, currentTime: 9, past: [1] }), 'nothing but playhead and history moved → no-op');
ok(!isSilentNoop([{ action: 'addClip' }], { tracks: tr }, { tracks: [] }), 'a new tracks array → changed');
ok(!isSilentNoop([{ action: 'autoCaptions' }], { transcripts: {} }, { transcripts: { a: 1 } }), 'a result stored outside the timeline counts as a change');
ok(!isSilentNoop([{ action: 'recommendLUTs' }], { tracks: tr }, { tracks: tr }), 'read-only commands may change nothing');
ok(['recommendLUTs', 'queueExport', 'seek_to', 'searchAssets', 'chat'].every(isReadOnlyAction) && !['addClip', 'silenceDetect', 'apply_lut', 'virtual_multicam'].some(isReadOnlyAction), 'read-only and editing commands are told apart');
ok(changedKeys({ f: () => 1 }, { f: () => 2 }).length === 0, 'store actions (functions) are ignored');
const ev = read('../client/src/agent/executeVerifiedEdit.js');
ok(/const before = useTimelineStore\.getState\(\);\s*const execution = await mediaExecutionEngine\.execute/.test(ev) && /isSilentNoop\(commands, before, useTimelineStore\.getState\(\)\)/.test(ev), 'every verified edit is checked before it can report success');

console.log('\n§4 wiring');
const store = read('../client/src/store/useTimelineStore.js');
ok(/conversation:\s+serializeConversation\(useAIStore\.getState\(\)\)/.test(store), 'saveProject saves the conversation');
ok(/restoreConversation\(projectData\.conversation\)/.test(store) && /restoreConversation\(_preRestoredProject\.conversation\)/.test(store), 'load and the refresh pre-restore both bring it back');
ok(/useAIStore\.subscribe\(/.test(store) && /useAIStore\.subscribe\(/.test(read('../client/src/hooks/useSupabasePersistence.js')), 'a new message schedules both the local and the cloud save');
ok(/cutDeletedCaptionWords: \(placementId, newText, before = null\)/.test(store) && /beginHistoryGroup\(\);[\s\S]{0,900}cutTimelineRanges\(plan\.ranges\)/.test(store), 'text change + cut is one undo step');
const mob = read('../client/src/components/MobileCaptionSheets.jsx');
ok(/findDeletedWords\(words, clip\.content, text\)/.test(mob) && /onBlur=\{saveOnBlur\}/.test(mob) && /cutDeletedCaptionWords/.test(mob), 'mobile caption sheet asks before cutting and does not save over the choice on blur');
ok(/cutDeletedCaptionWords\(clip\.id/.test(read('../client/src/components/TextPanel.jsx')), 'desktop caption editor offers the same cut');
for (const l of ['en', 'fr']) {
    const e = JSON.parse(read(`../client/src/locales/${l}/editor.json`));
    ok(['cutPrompt_one', 'cutPrompt_other', 'cutToo', 'textOnly'].every((k) => e.mobileCaptions[k] && e.textPanel[k]), `${l}: cut prompt copy exists`);
}
const ide = read('../client/src/layouts/IDELayout.jsx');
ok(/const deferredTracks = aiBusy && previewHold\.tracks \? previewHold\.tracks : liveDeferredTracks;/.test(ide), 'the preview holds its timeline while the AI works');
ok(ide.indexOf('const activeTab    = useAIStore') < ide.indexOf('R168: opening the sheet on a tab'), 'the tab-strip effect comes after activeTab is defined (no TDZ crash)');
ok(/scrollTo\(\{ left: Math\.max\(0, target\)/.test(ide), 'the mobile strip scrolls the active tab into view');
const tp = read('../client/src/components/TemplatePanel.jsx');
ok(/const swatchCache = new Map\(\)/.test(tp) && !/<canvas ref=\{ref\} width=\{48\}/.test(tp), 'illustration swatches are cached images, not 120 live canvases');

console.log('\n§5 R169: an edit never starts playback on its own');
const mee = read('../client/src/agent/MediaExecutionEngine.js');
const apply = mee.slice(mee.indexOf('\n    _applySegmentsToTimeline(segments'), mee.indexOf('async verifyExecution('));
ok(apply.length > 1000 && !/setIsPlaying\(true\)/.test(apply), 'cuts (silences, fillers, retakes) seek to the edit but do not press play');
ok(/if \(isPlaying && useAIStore\.getState\(\)\.isAnalyzing\)/.test(store), 'a programmatic play is refused while the AI is editing');
ok(/const shouldResume = false;/.test(read('../client/src/agent/WorkflowController.js')), 'the workflow does not resume playback after an edit');
ok(/motion route answered \$\{res\.status\}/.test(mee), 'a motion-route failure says why the offline recipe was used');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
