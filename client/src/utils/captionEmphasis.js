/**
 * captionEmphasis.js — keyword emphasis on captions (R88, to-do A2).
 *
 * Picking runs in two tiers, per Marc's choice ("rules + LLM fallback"):
 *   1. CaptionModel.pickKeywords — free, instant JS rules (numbers, prices,
 *      emphatic words, long content words; FR + EN stopwords).
 *   2. Only for short captions where the rules were NOT confident, one batched
 *      call to POST /api/captions/keywords (free Groq/Gemini provider). If that
 *      call fails for any reason, the rule pick stays — never an empty caption.
 *
 * Writes go through applyCaptionUpdate, which keeps `emphasis` per clip in any
 * scope (it is a list of word indices into that clip's own text). One history
 * entry per operation.
 */
import useTimelineStore from '../store/useTimelineStore';
import { pickKeywords } from '../motion/CaptionModel.js';
import { authFetch } from './authFetch.js';

const LLM_BATCH = 60;

function textOf(clip) {
    return String(clip?.content || clip?.name || '');
}

function captionClips(tracks) {
    const out = [];
    for (const track of (tracks || [])) {
        if (track?.type !== 'text') continue;
        for (const clip of (track.clips || [])) {
            if (clip && textOf(clip).trim()) out.push({ trackId: track.id, clip });
        }
    }
    return out;
}

/**
 * Pure planning step (no store, no network) — exported for tests.
 *
 * @returns {{ picks: Map<string, number[]>, unsure: Array<{id:string, text:string}>, skippedUser: number }}
 */
export function planAutoEmphasis(tracks, { overwrite = false } = {}) {
    const picks = new Map();
    const unsure = [];
    let skippedUser = 0;
    for (const { clip } of captionClips(tracks)) {
        if (!overwrite && clip.emphasis?.source === 'user') { skippedUser++; continue; }
        const text = textOf(clip);
        const { indices, confident } = pickKeywords(text);
        picks.set(clip.id, indices);
        // The LLM answers one word per caption, so it is only asked about
        // single-keyword captions the rules could not settle.
        if (!confident && indices.length <= 1) unsure.push({ id: clip.id, text });
    }
    return { picks, unsure, skippedUser };
}

/** Ask the server for the unsure ones. Returns Map<clipId, index>; empty on any failure. */
export async function fetchLLMKeywords(unsure) {
    const result = new Map();
    for (let i = 0; i < unsure.length; i += LLM_BATCH) {
        const batch = unsure.slice(i, i + LLM_BATCH);
        try {
            const res = await authFetch('/api/captions/keywords', {
                method: 'POST',
                body: JSON.stringify({ phrases: batch }),
            });
            if (!res.ok) {
                console.warn(`[captionEmphasis] keyword service answered ${res.status}; keeping the rule picks`);
                break;
            }
            const data = await res.json();
            for (const p of (Array.isArray(data?.picks) ? data.picks : [])) {
                if (p && typeof p.id === 'string' && Number.isInteger(p.index)) result.set(p.id, p.index);
            }
        } catch (err) {
            console.warn('[captionEmphasis] keyword service failed; keeping the rule picks:', err?.message);
            break;
        }
    }
    return result;
}

/**
 * Emphasise the key word(s) of every caption.
 *
 * @param {{useLLM?:boolean, overwrite?:boolean, source?:string}} opts
 *   overwrite: also replace picks the user made by hand (default false).
 * @returns {Promise<{updated:number, total:number, llmPicked:number, skippedUser:number}>}
 */
export async function autoEmphasizeCaptions({ useLLM = true, overwrite = false, source = 'auto' } = {}) {
    const store = useTimelineStore.getState();
    const { picks, unsure, skippedUser } = planAutoEmphasis(store.tracks, { overwrite });
    let llmPicked = 0;
    if (useLLM && unsure.length > 0) {
        const llm = await fetchLLMKeywords(unsure);
        for (const [id, index] of llm) {
            picks.set(id, [index]);
            llmPicked++;
        }
    }

    // Re-read after the await: the user may have edited during the request.
    const fresh = useTimelineStore.getState();
    const live = new Map(captionClips(fresh.tracks).map(({ clip }) => [clip.id, clip]));
    let updated = 0;
    let historySaved = false;
    for (const [clipId, indices] of picks) {
        const clip = live.get(clipId);
        if (!clip) continue;
        if (!overwrite && clip.emphasis?.source === 'user') continue;
        const next = indices.length > 0 ? { indices, source } : null;
        if (JSON.stringify(clip.emphasis || null) === JSON.stringify(next)) continue;
        if (!historySaved) { fresh.saveToHistory(); historySaved = true; }
        fresh.applyCaptionUpdate({ emphasis: next }, { clipId, scope: 'individual', skipHistory: true });
        updated++;
    }
    return { updated, total: picks.size, llmPicked, skippedUser };
}

/** Remove emphasis from every caption. Returns how many changed. */
export function clearAllEmphasis() {
    const store = useTimelineStore.getState();
    const withEmphasis = captionClips(store.tracks).filter(({ clip }) => clip.emphasis);
    if (withEmphasis.length === 0) return 0;
    store.saveToHistory();
    for (const { clip } of withEmphasis) {
        store.applyCaptionUpdate({ emphasis: null }, { clipId: clip.id, scope: 'individual', skipHistory: true });
    }
    return withEmphasis.length;
}

/** Toggle one word of one caption by hand (marks the caption as user-picked). */
export function toggleEmphasisWord(clipId, index) {
    const store = useTimelineStore.getState();
    const found = captionClips(store.tracks).find(({ clip }) => clip.id === clipId);
    if (!found || !Number.isInteger(index) || index < 0) return;
    const current = new Set(found.clip.emphasis?.indices || []);
    if (current.has(index)) current.delete(index); else current.add(index);
    const indices = [...current].sort((a, b) => a - b);
    store.applyCaptionUpdate(
        { emphasis: indices.length > 0 ? { indices, source: 'user' } : null },
        { clipId, scope: 'individual' },
    );
}
