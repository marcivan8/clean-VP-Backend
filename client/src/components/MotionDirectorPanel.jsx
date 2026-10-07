/**
 * client/src/components/MotionDirectorPanel.jsx
 *
 * R92: write the motion of the selected layer.
 *   - "Describe the motion": a sentence goes to /api/motion/compose, where an
 *     LLM writes the beats and keyframes. With no AI configured, the rules
 *     director in MotionComposer.js answers instead.
 *   - Verb chips: one tap per stage (entrance, emphasis, hold, exit). A tap
 *     replaces that stage and keeps the others, so motion is built up beat by
 *     beat the way a motion designer would.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, Loader2 } from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import { VERBS, composeMotion, planMotionFromBrief, COMPOSED } from '../motion/MotionComposer.js';
import { authFetch } from '../utils/authFetch.js';

const GROUPS = ['in', 'emphasis', 'hold', 'out'];

function kindOfClip(clip, trackType) {
    if (!clip) return 'text';
    if (trackType === 'text') return 'text';
    if (clip.type === 'video') return 'video';
    if (clip.type === 'image') return 'image';
    return 'sticker';
}

/** Group of a composed animation, from its presetId "composed:<verb>". */
function groupOf(anim) {
    const id = String(anim?.presetId || '');
    if (!id.startsWith('composed:')) return null;
    return VERBS[id.slice(9)]?.group || null;
}

export default function MotionDirectorPanel({ clip, trackId, trackType }) {
    const { t } = useTranslation('editor');
    const [brief, setBrief] = useState('');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState(null);

    const kind = kindOfClip(clip, trackType);
    const duration = Math.max(0.2, Number(clip?.duration) || 3);

    const activeVerbs = useMemo(() => {
        const out = new Set();
        for (const a of clip?.animations || []) {
            const id = String(a?.presetId || '');
            if (id.startsWith('composed:')) out.add(id.slice(9));
        }
        return out;
    }, [clip]);

    const apply = useCallback((animations) => {
        if (!clip || !trackId) return;
        const st = useTimelineStore.getState();
        st.saveToHistory?.();
        st.updateClip(trackId, clip.id, { animations, animation: 'none' });
    }, [clip, trackId]);

    const handleVerb = useCallback((verb) => {
        if (!clip) return;
        try {
            const group = VERBS[verb]?.group;
            const keep = (clip.animations || []).filter(a => a?.source === COMPOSED && groupOf(a) !== group);
            const { animations } = composeMotion({ beats: [{ verb, at: group === 'hold' ? 0.5 : 0 }] }, { duration, kind });
            if (animations.length === 0) {
                setStatus(t('motionDirector.notForThisLayer'));
                return;
            }
            apply([...keep, ...animations]);
            setStatus(null);
        } catch (err) {
            console.error('[MotionDirectorPanel] verb failed:', err.message);
        }
    }, [clip, duration, kind, apply, t]);

    const handleWrite = useCallback(async () => {
        const text = brief.trim();
        if (!clip || !text || busy) return;
        setBusy(true);
        setStatus(null);
        try {
            let script = null;
            let source = 'rules';
            try {
                const res = await authFetch('/api/motion/compose', {
                    method: 'POST',
                    body: JSON.stringify({
                        brief: text,
                        layers: [{ id: clip.id, kind: kind === 'text' ? 'text' : kind, content: String(clip.content || clip.name || '').slice(0, 120), duration }],
                        editingStyle: useTimelineStore.getState().editingStyle || null,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data?.layers?.[clip.id]) { script = data.layers[clip.id]; source = data.source || 'rules'; }
            } catch (netErr) {
                console.warn('[MotionDirectorPanel] motion route unavailable, using rules:', netErr.message);
            }
            if (!script) script = planMotionFromBrief(text, { duration });
            let { animations } = composeMotion(script, { duration, kind });
            if (animations.length === 0) ({ animations } = composeMotion(planMotionFromBrief(text, { duration }), { duration, kind }));
            if (animations.length === 0) {
                setStatus(t('motionDirector.nothing'));
                return;
            }
            apply(animations);
            setStatus(source === 'llm' ? t('motionDirector.writtenByAI') : t('motionDirector.builtFromLibrary'));
        } catch (err) {
            console.error('[MotionDirectorPanel] write failed:', err.message);
            setStatus(t('motionDirector.failed'));
        } finally {
            setBusy(false);
        }
    }, [brief, busy, clip, duration, kind, apply, t]);

    if (!clip) return null;

    return (
        <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t('motionDirector.title')}</div>
            <div className="flex gap-1.5 mb-2">
                <input
                    value={brief}
                    onChange={e => setBrief(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleWrite(); }}
                    placeholder={t('motionDirector.placeholder')}
                    className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1.5 text-xs"
                    aria-label={t('motionDirector.title')}
                />
                <button
                    type="button"
                    onClick={handleWrite}
                    disabled={busy || !brief.trim()}
                    className="shrink-0 px-2 py-1.5 rounded text-[11px] bg-primary/15 border border-primary/40 text-primary disabled:opacity-40 flex items-center gap-1"
                >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    {t('motionDirector.write')}
                </button>
            </div>
            {status && <p className="text-[10px] text-muted-foreground mb-2">{status}</p>}
            {GROUPS.map(group => {
                const verbs = Object.entries(VERBS).filter(([, v]) => v.group === group)
                    .filter(([, v]) => !(kind === 'video' && (v.group === 'in' || v.group === 'out')))
                    .filter(([name]) => !((name === 'typewriter' || name === 'word-reveal') && kind !== 'text'));
                if (verbs.length === 0) return null;
                return (
                    <div key={group} className="mb-2">
                        <div className="text-[10px] text-muted-foreground mb-1">{t(`motionDirector.groups.${group}`)}</div>
                        <div className="flex flex-wrap gap-1">
                            {verbs.map(([name, v]) => (
                                <button
                                    key={name}
                                    type="button"
                                    title={v.describe}
                                    onClick={() => handleVerb(name)}
                                    className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                                        activeVerbs.has(name)
                                            ? 'bg-primary/15 border-primary/40 text-primary'
                                            : 'bg-secondary border-transparent hover:bg-white/10 text-foreground'
                                    }`}
                                >
                                    {t(`motionDirector.verbs.${name}`, { defaultValue: name })}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
