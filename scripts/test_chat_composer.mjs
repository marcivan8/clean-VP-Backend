// R110: the desktop chat box (ChatComposer) - context chips, Tools menu, send/stop.
// node scripts/test_chat_composer.mjs
import assert from 'assert/strict';
import fs from 'fs';

const log = console.log;
let failures = 0;
const check = async (name, fn) => {
    try { await fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const T = await import('../client/src/components/Assistant/composerTools.js');
const D = await import('../client/src/components/Assistant/assistantDocuments.js');
const { resolveCommand, COMMAND_BY_ID } = await import('../client/src/agent/CommandRegistry.js');

log('\n-- 1. Tools: every menu item is a real command --');
await check('each tool names a registry command that exists', () => {
    for (const tool of T.COMPOSER_TOOLS) assert.ok(COMMAND_BY_ID[tool.command], `${tool.id} -> ${tool.command}`);
});
await check('each prompt resolves to ITS command, with confidence and no ambiguity', () => {
    for (const tool of T.COMPOSER_TOOLS) {
        const r = resolveCommand(tool.prompt);
        assert.equal(r.match?.id, tool.command, `${tool.id}: "${tool.prompt}" went to ${r.match?.id}`);
        assert.equal(r.confidence, 'high', `${tool.id} confidence ${r.confidence}`);
        assert.equal(r.ambiguous, false, `${tool.id} ambiguous`);
    }
});
await check('groups: every tool belongs to exactly one, flattened in menu order', () => {
    const flat = T.TOOL_GROUPS.flatMap(g => g.tools);
    assert.deepEqual(flat.map(t => t.id), T.COMPOSER_TOOLS.map(t => t.id), 'COMPOSER_TOOLS is not the groups flattened');
    assert.equal(new Set(T.TOOL_GROUPS.map(g => g.id)).size, T.TOOL_GROUPS.length, 'duplicate group id');
    for (const g of T.TOOL_GROUPS) assert.ok(g.tools.length > 0, `empty group ${g.id}`);
});
await check('group headings exist in both locales', () => {
    for (const lang of ['en', 'fr']) {
        const a = JSON.parse(read(`../client/src/locales/${lang}/editor.json`)).assistant;
        for (const g of T.TOOL_GROUPS) assert.ok(a.toolGroup?.[g.id], `${lang} toolGroup.${g.id}`);
    }
});
// R116 - TOOL_GROUPS is no longer mounted (the composer's left button is
// Styles). The DATA checks below stay: the sentence-to-command pairing is the
// expensive part and it is what would rot silently if the menu came back.
// The menu-behaviour checks moved to the Styles menu, in section 1b.
await check('tool ids are unique and every one has an icon, in both locales', () => {
    assert.equal(new Set(T.COMPOSER_TOOLS.map(t => t.id)).size, T.COMPOSER_TOOLS.length);
    for (const lang of ['en', 'fr']) {
        const a = JSON.parse(read(`../client/src/locales/${lang}/editor.json`)).assistant;
        for (const k of ['tools', 'send', 'stop', 'contextLabel', 'contextHint', 'contextRemove']) assert.ok(a[k], `${lang}.${k}`);
        for (const tool of T.COMPOSER_TOOLS) assert.ok(a.tool?.[tool.id], `${lang} tool.${tool.id}`);
    }
    // The icon map lived in ChatComposer and went with the Tools button in
    // R116. Every entry still declares an icon name, so the menu can be
    // remounted without picking them again.
    for (const tool of T.COMPOSER_TOOLS) assert.ok(tool.icon && typeof tool.icon === 'string', `no icon on ${tool.id}`);
});

log('\n-- 2. Context chips = the real selection --');
const tracks = [
    { id: 'v', type: 'video', clips: [{ id: 'c1', name: 'Interview.mp4', type: 'video' }, { id: 'c2', name: 'B-roll.mp4', type: 'video' }] },
    { id: 'a', type: 'audio', clips: [{ id: 'c3', name: 'Music.mp3', type: 'audio' }] },
    { id: 't', type: 'text', clips: [{ id: 'c4', content: 'Hello world', type: 'caption' }, { id: 'c5', name: 'Title', type: 'text' }] },
];
await check('one chip per selected clip, in selection order, with a kind', () => {
    const { chips, more } = T.contextChipsFor(tracks, ['c3', 'c1']);
    assert.deepEqual(chips.map(c => [c.id, c.name, c.kind]), [['c3', 'Music.mp3', 'audio'], ['c1', 'Interview.mp4', 'video']]);
    assert.equal(more, 0);
});
await check('no selection, bad input, or stale ids give no chips (never a chip nobody can explain)', () => {
    assert.deepEqual(T.contextChipsFor(tracks, []).chips, []);
    assert.deepEqual(T.contextChipsFor(null, ['c1']).chips, []);
    assert.deepEqual(T.contextChipsFor(tracks, ['gone']).chips, []);
    assert.deepEqual(T.contextChipsFor(tracks, undefined).chips, []);
});
await check('duplicates collapse; extras fold into +N past the cap', () => {
    const r = T.contextChipsFor(tracks, ['c1', 'c1', 'c2', 'c3', 'c4', 'c5']);
    assert.equal(r.chips.length, T.MAX_CONTEXT_CHIPS);
    assert.equal(r.more, 5 - T.MAX_CONTEXT_CHIPS);
});
await check('captions fall back to their text; names are capped', () => {
    assert.equal(T.contextChipsFor(tracks, ['c4']).chips[0].name, 'Hello world');
    const long = [{ id: 'x', clips: [{ id: 'x', name: 'n'.repeat(200) }] }];
    assert.equal(T.contextChipsFor(long, ['x']).chips[0].name.length, 40);
});

log('\n-- 3. A tool never overwrites what was typed --');
const fakeEl = (value = '') => ({ value, setSelectionRange(a, b) { this.sel = [a, b]; } });
await check('empty box: the prompt, caret at the end', () => {
    const el = fakeEl(); assert.equal(T.insertPrompt(el, 'add captions'), true);
    assert.equal(el.value, 'add captions'); assert.deepEqual(el.sel, [12, 12]);
});
await check('typed text is kept; the prompt goes on a new line', () => {
    const el = fakeEl('make it punchy  '); T.insertPrompt(el, 'remove silences');
    assert.equal(el.value, 'make it punchy\nremove silences');
});
await check('no element or an empty prompt does nothing', () => {
    assert.equal(T.insertPrompt(null, 'x'), false);
    const el = fakeEl('keep'); assert.equal(T.insertPrompt(el, '   '), false); assert.equal(el.value, 'keep');
});

log('\n-- 4. Wiring: the old behaviour survived the move --');
const rp = read('../client/src/components/Assistant/ReasoningPanel.jsx');
const cc = read('../client/src/components/Assistant/ChatComposer.jsx');
const css = read('../client/src/index.css');
await check('ReasoningPanel renders ChatComposer with the same input ref, send and stop', () => {
    assert.ok(/<ChatComposer[\s\S]*inputRef=\{inputRef\}[\s\S]*onSend=\{processCommand\}[\s\S]*onStop=\{cancelRun\}/.test(rp));
    assert.ok(!/<textarea/.test(rp), 'a second textarea would split the input');
});
await check('the in-feed Cancel and the stop button share one cancel path', () => {
    assert.equal((rp.match(/cancelCurrentJob\(\)/g) || []).length, 1);
    assert.ok(/onClick=\{cancelRun\}/.test(rp));
});
await check('the textarea is uncontrolled and keeps the onboarding anchor', () => {
    assert.ok(/data-hint="assistant-input"/.test(cc));
    assert.ok(!/<textarea[^>]*\bvalue=/.test(cc), 'controlled textarea breaks suggestions that write .value');
});
await check('the style picker and chips are desktop-only; send is not', () => {
    assert.ok(/hidden md:block">\s*<ContextChips/.test(cc));
    assert.ok(/hidden md:flex[^"]*">\s*<EditingStylePicker/.test(cc));
    assert.ok(/text-\[16px\] md:text-sm/.test(cc), 'iOS zoom guard lost');
});
await check('removing a chip deselects through the store, not a local copy', () => {
    assert.ok(/toggleClipSelection\(chip\.id\)/.test(cc));
});
await check('send and stop are labelled', () => {
    for (const s of ['aria-label={t(\'assistant.send\')}', "aria-label={t('assistant.stop')}"]) {
        assert.ok(cc.includes(s), s);
    }
});
await check('composer floats over the feed while leaving scroll clearance for the last message', () => {
    assert.ok(/<aside className=\{classNames\("relative [^"]+"/.test(rp), 'panel must anchor the floating composer');
    assert.ok(/ref=\{scrollRef\} className="[^"]*overflow-y-auto[^\"]*pb-\[30rem\]/.test(rp), 'scroll feed needs bottom clearance');
    assert.ok(/<div className="chat-composer-float">[\s\S]*?<ChatComposer/.test(rp), 'composer must live in the floating overlay');
    assert.ok(/\.chat-composer-float\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/.test(css), 'overlay must float without blocking feed interaction outside controls');
});
await check('reference documents are parsed locally and included in edit prompts', async () => {
    const file = Object.assign(new Blob(['A clear script brief']), { name: 'brief.md', lastModified: 1 });
    const parsed = await D.readAssistantDocument(file);
    assert.equal(parsed.name, 'brief.md');
    assert.equal(parsed.text, 'A clear script brief');
    assert.match(D.withAssistantDocuments('Add captions', [parsed]), /Add captions[\s\S]*--- brief\.md ---[\s\S]*A clear script brief/);
    assert.match(D.withAssistantDocuments('', [parsed], 'Use the brief'), /^Use the brief/);
    await assert.rejects(() => D.readAssistantDocument(Object.assign(new Blob(['%PDF']), { name: 'brief.pdf' })), /documentUnsupported/);
    assert.ok(/documents=\{referenceDocuments\}[\s\S]*onDocumentsChange=\{setReferenceDocuments\}/.test(rp));
    assert.ok(/withAssistantDocuments\([\s\S]*referenceDocuments/.test(rp));
});

log(failures ? `\n${failures} FAILURES` : '\nALL CHAT COMPOSER TESTS PASSED');
process.exit(failures ? 1 : 0);
