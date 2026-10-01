import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Scissors, Check, Undo2 } from 'lucide-react';
import useAIStore from '../store/useAIStore';
import useTimelineStore from '../store/useTimelineStore';
import { getDisplayWords, findFillerIndices, rangesForIndices, selectionSummary, activeWordIndexAt } from '../timeline/transcriptSelect.js';
import { submitRokaPrompt } from '../agent/rokaPromptQueue.js';
import MobileSheet from './MobileSheet';

/**
 * MobileTranscriptSheet — edit the video by editing its words (phase 5).
 *   - tap a word: jump there
 *   - press and hold a word, then drag: select; while a selection exists,
 *     tapping another word extends it
 *   - Cut removes exactly that stretch of the timeline (store.cutTimelineRange:
 *     only the clip that plays those words is cut, captions follow)
 *   - filler words ("um", "euh"…) are flagged; Remove all cuts them in one
 *     undo step (store.cutTimelineRanges)
 * Opened from the bottom bar (useAIStore.setMobileTranscriptOpen). Mobile only.
 */

const LONG_PRESS_MS = 380;
const MOVE_TOLERANCE = 10;

const fmt = (s) => {
    const v = Math.max(0, Number(s) || 0);
    return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
};
const displayName = (key) => String(key || '').replace(/^\d{10,}-/, '');

/** The words, rendered once per data change (not per playhead tick). */
const WordsBlock = memo(function WordsBlock({ words, selFirst, selLast, fillerSet }) {
    const out = [];
    let lastKey;
    words.forEach((w, i) => {
        const newSource = i === 0 || w.sourceKey !== lastKey;
        lastKey = w.sourceKey;
        if (newSource && w.sourceKey) {
            out.push(
                <span key={`h${i}`} style={{ display: 'block', margin: i === 0 ? '0 0 4px' : '14px 0 4px', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                    {displayName(w.sourceKey)} · {fmt(w.start)}
                </span>
            );
        }
        const selected = i >= selFirst && i <= selLast;
        const filler = fillerSet.has(i);
        out.push(
            <span
                key={i}
                data-idx={i}
                style={{
                    borderRadius: 4,
                    padding: '1px 0',
                    background: selected ? 'color-mix(in oklch, var(--accent) 30%, transparent)' : undefined,
                    color: filler ? 'var(--coral)' : undefined,
                    textDecoration: filler ? 'underline dotted' : undefined,
                    textUnderlineOffset: 4,
                }}
            >
                {w.word}
            </span>
        );
        out.push(' ');
    });
    return out;
});

function TranscriptBody({ onClose }) {
    const { t } = useTranslation('editor');
    const data = useTimelineStore(useShallow(s => ({
        transcripts: s.transcripts, transcriptVerified: s.transcriptVerified,
        tracks: s.tracks, assets: s.assets, captions: s.captions,
    })));
    const words = useMemo(() => getDisplayWords(data), [data]);
    const fillers = useMemo(() => findFillerIndices(words), [words]);
    const fillerSet = useMemo(() => new Set(fillers), [fillers]);
    const hasWords = words.length > 0;

    // { anchor, focus, words }: a selection belongs to the word list it was
    // made on; after a cut the list changes and the old selection is ignored.
    const [rawSel, setSel] = useState(null);
    const sel = rawSel && rawSel.words === words ? rawSel : null;
    const [toast, setToast] = useState(null);   // { text }
    const summary = sel ? selectionSummary(words, sel.anchor, sel.focus) : null;

    // Active word: styled imperatively so playback doesn't re-render every word.
    const boxRef = useRef(null);
    const activeIdx = useTimelineStore(s => activeWordIndexAt(words, s.currentTime));
    useEffect(() => {
        const box = boxRef.current;
        if (!box) return undefined;
        const el = activeIdx >= 0 ? box.querySelector(`[data-idx="${activeIdx}"]`) : null;
        if (el) { el.style.boxShadow = 'inset 0 -2px 0 var(--accent)'; el.style.color = 'var(--fg)'; }
        return () => { if (el) { el.style.boxShadow = ''; el.style.color = ''; } };
    }, [activeIdx, words, sel]);

    // ── Touch / mouse selection ─────────────────────────────────────────────
    const press = useRef(null);       // { idx, x, y, timer, moved }
    const selecting = useRef(false);
    const idxAt = (x, y) => {
        const el = document.elementFromPoint(x, y)?.closest?.('[data-idx]');
        return el ? Number(el.dataset.idx) : null;
    };
    // Stop the sheet from scrolling while a drag-selection is in progress (iOS
    // needs a non-passive touchmove listener for this).
    useEffect(() => {
        const box = boxRef.current;
        if (!box) return undefined;
        const onTouchMove = (e) => { if (selecting.current) e.preventDefault(); };
        box.addEventListener('touchmove', onTouchMove, { passive: false });
        return () => box.removeEventListener('touchmove', onTouchMove);
    }, [hasWords]); // re-attach once the word list (and boxRef) first renders

    const onPointerDown = (e) => {
        const el = e.target.closest?.('[data-idx]');
        if (!el) return;
        const idx = Number(el.dataset.idx);
        const timer = setTimeout(() => {
            if (!press.current || press.current.moved) return;
            press.current.timer = null;
            selecting.current = true;
            setSel({ anchor: idx, focus: idx, words });
            try { navigator.vibrate?.(15); } catch { /* not supported */ }
        }, LONG_PRESS_MS);
        press.current = { idx, x: e.clientX, y: e.clientY, timer, moved: false };
    };
    const onPointerMove = (e) => {
        const p = press.current;
        if (!p) return;
        if (selecting.current) {
            const idx = idxAt(e.clientX, e.clientY);
            if (idx != null) setSel(prev => (prev ? { ...prev, focus: idx } : prev));
            return;
        }
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) {
            p.moved = true;
            if (p.timer) { clearTimeout(p.timer); p.timer = null; }
        }
    };
    const endPress = (e, cancelled) => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        if (p.timer) clearTimeout(p.timer);
        if (selecting.current) { selecting.current = false; return; }
        if (cancelled || p.moved) return;
        // A plain tap: extend an existing selection, else jump to the word.
        if (sel) setSel(prev => ({ ...prev, focus: p.idx }));
        else useTimelineStore.getState().seek(Number(words[p.idx]?.start) || 0);
    };

    const st = () => useTimelineStore.getState();
    const cutSelection = () => {
        if (!summary) return;
        if (st().cutTimelineRange(summary.start, summary.end)) {
            setToast({ text: t('mobileTranscript.cutDone', { count: summary.count, seconds: summary.seconds.toFixed(1) }) });
        }
        setSel(null);
    };
    const removeFillers = () => {
        const n = st().cutTimelineRanges(rangesForIndices(words, fillers));
        if (n > 0) setToast({ text: t('mobileTranscript.fillersDone', { count: fillers.length }) });
    };
    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 6000);
        return () => clearTimeout(timer);
    }, [toast]);

    if (words.length === 0) {
        return (
            <MobileSheet open title={t('mobileTranscript.title')} onClose={onClose}>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--fg-2)' }}>{t('mobileTranscript.empty')}</p>
                <button
                    type="button"
                    onClick={() => { onClose(); submitRokaPrompt('Add captions', t); }}
                    style={{ height: 48, borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600 }}
                >
                    {t('mobileCaptions.addCaptions')}
                </button>
            </MobileSheet>
        );
    }

    return (
        <MobileSheet open title={t('mobileTranscript.title')} onClose={onClose}>
            <span style={{ marginTop: -10, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{t('mobileTranscript.hint')}</span>

            {toast && (
                <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 12px', borderRadius: 'var(--r-sm)', background: 'var(--bg-3)', border: '1px solid color-mix(in oklch, var(--mint) 40%, transparent)' }}>
                    <Check size={17} style={{ color: 'var(--mint)', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13.5 }}>{toast.text}</span>
                    <button
                        type="button"
                        onClick={() => { st().undo(); setToast(null); }}
                        style={{ height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        <Undo2 size={14} /> {t('mobileRoka.undo')}
                    </button>
                </div>
            )}

            {fillers.length > 0 && !summary && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 12px', borderRadius: 'var(--r-sm)', background: 'color-mix(in oklch, var(--coral) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--coral) 40%, transparent)' }}>
                    <span style={{ flex: 1, fontSize: 13.5 }}>{t('mobileTranscript.fillersFound', { count: fillers.length })}</span>
                    <button
                        type="button"
                        onClick={removeFillers}
                        style={{ height: 36, padding: '0 12px', borderRadius: 10, border: 0, background: 'var(--coral)', color: '#1A0A06', fontSize: 13, fontWeight: 600 }}
                    >
                        {t('mobileTranscript.removeAll')}
                    </button>
                </div>
            )}

            <div
                ref={boxRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endPress(e, false)}
                onPointerCancel={(e) => endPress(e, true)}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                    fontSize: 17, lineHeight: 1.75, color: 'var(--fg-2)',
                    userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
                    paddingBottom: summary ? 72 : 8,
                }}
            >
                <WordsBlock words={words} selFirst={summary ? summary.first : -1} selLast={summary ? summary.last : -2} fillerSet={fillerSet} />
            </div>

            {summary && (
                <div style={{
                    position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 8, padding: 8,
                    borderRadius: 16, background: 'var(--bg-3)', border: '1px solid var(--line-strong)', boxShadow: '0 10px 30px rgba(0,0,0,.5)',
                }}>
                    <span style={{ flex: 1, paddingLeft: 6, fontFamily: 'var(--f-mono)', fontSize: 12 }}>
                        {t('mobileTranscript.selection', { count: summary.count, seconds: summary.seconds.toFixed(1) })}
                    </span>
                    <button
                        type="button"
                        onClick={cutSelection}
                        style={{ height: 44, padding: '0 16px', borderRadius: 12, border: 0, background: 'var(--coral)', color: '#1A0A06', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        <Scissors size={16} /> {t('mobileTranscript.cut')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setSel(null)}
                        style={{ height: 44, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--fg)', fontSize: 14, fontWeight: 600 }}
                    >
                        {t('mobileTranscript.clear')}
                    </button>
                </div>
            )}
        </MobileSheet>
    );
}

export default function MobileTranscriptSheet() {
    const open = useAIStore(s => s.mobileTranscriptOpen);
    const setOpen = useAIStore(s => s.setMobileTranscriptOpen);
    if (!open) return null;
    return <TranscriptBody onClose={() => setOpen(false)} />;
}
