// R124 — compileApplyCaptionStyle resolves a CAPTION_STYLES preset id into
// the same field-update object the Styles menu/mobile sheet apply, and
// compileLongFormEdit threads captionBrief through to the longFormEdit
// store command args so VideoEditorTools.longFormEdit actually receives it.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');

console.log = realLog;
const ok = (name) => realLog(`✓ ${name}`);

// 1. A known style id compiles to applyCaptionStyleToAll with real field values.
{
    const result = CommandCompiler.compile(
        { steps: [{ step_id: 'step_1', action: 'apply_caption_style', styleId: 'bold-impact' }] },
        {}
    );
    const compiled = result.commands?.[0] || result.results?.[0]?.commands?.[0];
    const cmds = result.commands || (result.results || []).flatMap(r => r.commands || []);
    assert.ok(cmds.length > 0, 'expected at least one compiled command');
    const c = cmds[0];
    assert.equal(c.action, 'applyCaptionStyleToAll');
    assert.equal(c.args.fontFamily, 'Anton'); // bold-impact's font
    assert.equal(c.args.color, '#FACC15');
    ok('apply_caption_style compiles to applyCaptionStyleToAll with the real bold-impact field values');
}

// 2. An unknown style id doesn't throw — it's skipped cleanly.
{
    const result = CommandCompiler.compile(
        { steps: [{ step_id: 'step_1', action: 'apply_caption_style', styleId: 'not-a-real-style' }] },
        {}
    );
    const cmds = result.commands || (result.results || []).flatMap(r => r.commands || []);
    assert.equal(cmds.length, 0, 'an unknown style id should compile to zero commands, not throw');
    ok('an unknown caption style id is skipped cleanly rather than crashing the compile pass');
}

// 3. compileLongFormEdit threads captionBrief through to the store command args.
{
    const brief = { wantsCaptions: true, wantsKeywordEmphasis: true, stylePresetId: 'cinematic', keepClearOfFace: true, safeMargins: true };
    const result = CommandCompiler.compile(
        { steps: [{ step_id: 'step_1', action: 'long_form_edit', editMode: 'FULL_BUILD', captionBrief: brief }] },
        {}
    );
    const cmds = result.commands || (result.results || []).flatMap(r => r.commands || []);
    assert.equal(cmds.length, 1);
    assert.deepEqual(cmds[0].args.captionBrief, brief);
    ok('compileLongFormEdit threads captionBrief through unchanged to the longFormEdit store command');
}

realLog('\nALL APPLY-CAPTION-STYLE COMPILE TESTS PASSED');
