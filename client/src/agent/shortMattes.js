/**
 * client/src/agent/shortMattes.js — bake the free background mask on the
 * main-edit video clips a short uses (speaker pop-out). Shared by the Shorts
 * panel and the shorts agent run (R176b); moved out of ShortsPanel.jsx.
 */
import useTimelineStore from '../store/useTimelineStore';

/** Bake the free background mask on the main-edit video clips a short uses. */
export async function ensureMattesFor(short) {
    useTimelineStore.getState().exitShortPreview();
    const st = useTimelineStore.getState();
    const { mediaExecutionEngine } = await import('./MediaExecutionEngine.js');
    let videoCount = 0;
    let personCount = 0;
    for (const t of (st.tracks || []).filter(tr => tr.type === 'video')) {
        for (const c of t.clips || []) {
            const cs = Number(c.start) || 0;
            const ce = cs + (Number(c.duration) || 0);
            if (ce <= short.start || cs >= short.end || (c.type && c.type !== 'video')) continue;
            videoCount += 1;
            const r = await mediaExecutionEngine._ensureMatte(t.id, c.id, null);
            if (!r?.ok) throw new Error(r?.error || 'The background mask could not be made.');
            if (r.people !== false) personCount += 1;
        }
    }
    if (!videoCount) throw new Error('There is no video clip in this short to separate from its background.');
    if (!personCount) throw new Error('No person was detected in this short, so the speaker highlight could not be applied.');
    return short;
}
