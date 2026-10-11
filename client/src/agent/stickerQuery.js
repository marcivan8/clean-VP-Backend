/**
 * client/src/agent/stickerQuery.js
 *
 * R97 — parses "add a fire emoji" / "insert a heart icon" / "add 🔥" style
 * prompts for the new `add_sticker` command: either a literal emoji glyph
 * the user already typed, or a keyword to resolve against the sticker
 * library (server/audio-engine/search/TaxonomyService.js's
 * getStickersByKeywords, via the new /api/stickers/search route).
 *
 * Mirrors sfxCues.js's sfxQueryFromText() shape and intent on purpose — same
 * kind of "pull the one word that matters out of a loose sentence" job, kept
 * in its own file since it resolves to a different asset family.
 */

// Covers the ranges real human prompts actually type: emoticons, symbols &
// pictographs, transport & map, dingbats, and the supplemental pictograph
// planes (where most modern emoji, like U+1FAB5 "wood", live). Not an
// exhaustive Unicode-emoji classifier — good enough to detect "the user
// pasted or typed an emoji character" without a dependency.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/u;

// "a/an <word(s)> emoji|icon|sticker" — the keyword is what sits between the
// article and the kind noun, e.g. "add a fire emoji" -> "fire",
// "insert a thumbs up icon" -> "thumbs up". Anchored on the article (not just
// "add"/"insert") so a leading verb never gets swallowed into the keyword.
const KEYWORD_BEFORE_KIND = /\b(?:a|an)\s+([a-z][a-z\s-]{0,30}?)\s+(emoji|emojis|icon|icons|sticker|stickers)\b/i;
// "an emoji of fire" / "a sticker of a heart"
const KEYWORD_OF_KIND = /\b(?:emoji|icon|sticker)\s+of\s+(?:an?\s+)?([a-z][a-z\s-]{1,30}?)\b/i;

/**
 * @param {string} text the user's prompt
 * @returns {{ emoji: string }|{ keyword: string, kind: ?('icon'|'emoji') }|null}
 *   null means no literal emoji and no resolvable keyword — the caller
 *   should fall back to a sensible default rather than failing.
 */
export function stickerQueryFromText(text) {
    const raw = String(text || '');

    const emojiMatch = raw.match(EMOJI_PATTERN);
    if (emojiMatch) return { emoji: emojiMatch[0] };

    const lower = raw.toLowerCase();
    const kindOf = (word) => (/emoji/.test(word) ? 'emoji' : /icon/.test(word) ? 'icon' : null);

    const before = lower.match(KEYWORD_BEFORE_KIND);
    if (before) {
        const keyword = before[1].trim();
        if (keyword) return { keyword, kind: kindOf(before[2]) };
    }

    const of = lower.match(KEYWORD_OF_KIND);
    if (of) {
        const keyword = of[1].trim();
        if (keyword) return { keyword, kind: kindOf(lower.match(/emoji|icon|sticker/)?.[0] || '') };
    }

    return null;
}

export default { stickerQueryFromText };
