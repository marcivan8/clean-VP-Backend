/**
 * client/src/components/Assistant/composerTools.js
 *
 * R110 - the one-click actions behind the chat box's "Tools" button.
 *
 * R116: the composer's left button is now the editing-style picker, so
 * TOOL_GROUPS is NOT MOUNTED anywhere. It is kept, with its test, because the
 * pairing of each sentence to the command it resolves to is expensive to
 * rebuild and the menu may come back somewhere else (a slash menu, the panel
 * rail). `contextChipsFor` below is still live - the composer's context chips
 * use it. `insertPrompt` went unused with the menu and is kept for the same
 * reason. Do not read TOOL_GROUPS as shipped UI.
 *
 * Each tool is a real command from agent/CommandRegistry.js, identified by id.
 * `prompt` is the sentence dropped into the box; it is a phrase the registry
 * itself resolves to that command, and scripts/test_chat_composer.mjs pins
 * that for every entry. A menu item whose sentence the parser sends somewhere
 * else would be a button that looks like it works and edits the wrong thing
 * (the ADR-001 shape), so the pairing is tested rather than trusted.
 *
 * Pure data, no imports: loadable from the Node test harness.
 */

/**
 * The menu, in groups. A group is a heading in the Tools menu; the order here
 * is the order on screen. `command` is the registry id the `prompt` must
 * resolve to - scripts/test_chat_composer.mjs asserts that for every entry, so
 * a menu item can never quietly send the wrong command.
 *
 * R111 widens this from 7 flat items to the editing vocabulary a person would
 * look for in a menu: cleaning, captions, graphics, framing and finishing.
 * Every prompt below was checked against resolveCommand before being added.
 *
 * @type {ReadonlyArray<{id:string, tools:ReadonlyArray<{id:string, command:string, icon:string, prompt:string}>}>}
 */
export const TOOL_GROUPS = Object.freeze([
    {
        id: 'cleanup',
        tools: [
            { id: 'silences',  command: 'silence_removal',     icon: 'scissors', prompt: 'remove silences' },
            { id: 'fillers',   command: 'remove_filler_words', icon: 'eraser',   prompt: 'remove filler words' },
            { id: 'retakes',   command: 'remove_repetition',   icon: 'repeat',   prompt: 'remove retakes' },
            { id: 'denoise',   command: 'denoise_audio',       icon: 'waves',    prompt: 'remove background noise' },
        ],
    },
    {
        id: 'captions',
        tools: [
            { id: 'captions',  command: 'auto_captions',       icon: 'captions',  prompt: 'add captions' },
            { id: 'keywords',  command: 'emphasize_keywords',  icon: 'highlight', prompt: 'highlight key words' },
            { id: 'overlay',   command: 'add_text_overlay',    icon: 'type',      prompt: 'add a text overlay' },
        ],
    },
    {
        id: 'graphics',
        tools: [
            { id: 'rhythm',      command: 'rhythm_zoom',       icon: 'zoom',      prompt: 'add zoom rhythm' },
            { id: 'storyboard',  command: 'storyboard_video',  icon: 'storyboard', prompt: 'storyboard this video' },
            { id: 'design',    command: 'design_scene',        icon: 'sparkle', prompt: 'design a scene' },
            { id: 'chart',     command: 'add_template',        icon: 'chart',   prompt: 'add a bar chart' },
            { id: 'sticker',   command: 'add_sticker',         icon: 'sticker', prompt: 'add a sticker' },
        ],
    },
    {
        id: 'framing',
        tools: [
            { id: 'speaker',   command: 'zoom_speaker',            icon: 'focus',  prompt: 'zoom on the speaker' },
            { id: 'split',     command: 'layout_split_screen',     icon: 'split',  prompt: 'use a split screen layout' },
            { id: 'pip',       command: 'layout_picture_in_picture', icon: 'pip',  prompt: 'use picture in picture' },
            { id: 'nobg',      command: 'remove_background',       icon: 'layers', prompt: 'remove the background' },
        ],
    },
    {
        id: 'finish',
        tools: [
            { id: 'grade',     command: 'color_grade',         icon: 'palette', prompt: 'color grade the video' },
            { id: 'polish',    command: 'polish_short',        icon: 'wand',    prompt: 'pro finish' },
            { id: 'shorts',    command: 'repurpose_shorts',    icon: 'film',    prompt: 'repurpose into shorts' },
        ],
    },
]);

/** Every tool, flattened - the order the menu renders them in. */
export const COMPOSER_TOOLS = Object.freeze(TOOL_GROUPS.flatMap(g => g.tools));

/** How many selected clips get their own chip before the rest fold into "+N". */
export const MAX_CONTEXT_CHIPS = 3;

/**
 * The chips shown above the input: one per selected clip, in selection order,
 * folded past `max`. Ids that no longer exist on the timeline are skipped (a
 * stale selection after a delete must not render a chip nobody can explain).
 *
 * @param {Array} tracks        store `tracks`
 * @param {string[]} selectedIds store `selectedClipIds`
 * @param {number} [max]
 * @returns {{ chips: Array<{id:string,name:string,kind:string}>, more:number }}
 */
export function contextChipsFor(tracks, selectedIds, max = MAX_CONTEXT_CHIPS) {
    const byId = new Map();
    for (const track of Array.isArray(tracks) ? tracks : []) {
        for (const clip of Array.isArray(track?.clips) ? track.clips : []) {
            if (clip?.id != null) byId.set(clip.id, { clip, track });
        }
    }
    const found = [];
    const seen = new Set();
    for (const id of Array.isArray(selectedIds) ? selectedIds : []) {
        if (seen.has(id) || !byId.has(id)) continue;
        seen.add(id);
        const { clip, track } = byId.get(id);
        const kind = clip.type === 'caption' || clip.type === 'text' || track?.type === 'text'
            ? 'text'
            : (track?.type === 'audio' || clip.type === 'audio' ? 'audio' : 'video');
        found.push({ id, name: String(clip.name || clip.content || clip.type || 'clip').slice(0, 40), kind });
    }
    const cap = Math.max(1, max | 0);
    return { chips: found.slice(0, cap), more: Math.max(0, found.length - cap) };
}

/**
 * Put `text` into an uncontrolled textarea the way a person typing would leave
 * it: value set, caret at the end, grown to fit. Returns false when there is no
 * element. A tool never replaces what someone already typed: it is appended on
 * a new line, so a half-written request survives a misclick.
 */
export function insertPrompt(el, text) {
    if (!el) return false;
    const next = String(text || '').trim();
    if (!next) return false;
    const current = String(el.value || '').trim();
    el.value = current ? `${current}\n${next}` : next;
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not focusable */ }
    return true;
}

export default { TOOL_GROUPS, COMPOSER_TOOLS, MAX_CONTEXT_CHIPS, contextChipsFor, insertPrompt };
