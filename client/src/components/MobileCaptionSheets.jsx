import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Scissors, Merge, Play, Type } from 'lucide-react';
import useAIStore from '../store/useAIStore';
import useTimelineStore from '../store/useTimelineStore';
import { CAPTION_STYLES, FONT_STACK } from './Assistant/captionStylePacks.js';
import { legacyPackToCaptionStyle } from '../motion/CaptionModel.js';
import { submitRokaPrompt } from '../agent/rokaPromptQueue.js';
import MobileSheet, { SheetLabel, SheetRow } from './MobileSheet';

/**
 * Mobile caption sheets (phase 4), opened through
 * useAIStore.openMobileCaptionSheet('style' | 'edit', placementId):
 *  - Style: the same 10 style packs as the desktop Roka card
 *    (Assistant/captionStylePacks.js), applied to every caption, plus a
 *    "highlight the spoken word" switch.
 *  - Edit: one caption's text, its words (tap = jump there), split before a
 *    word, merge with the next caption.
 * Store actions: applyCaptionStyleToAll, setCaptionWordHighlight,
 * editCaptionText, splitCaptionAt, mergeCaptionWithNext (one undo step each).
 * Mounted by IDELayout on mobile only.
 */

const fmt = (s) => {
    const v = Math.max(0, Number(s) || 0);
    const m = Math.floor(v / 60);
    const r = v - m * 60;
    return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
};

function Switch({ on, onChange, label, sub }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15 }}>{label}</span>
                {sub && <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{sub}</span>}
            </div>
            <button
                type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
                style={{ position: 'relative', width: 50, height: 30, flexShrink: 0, borderRadius: 15, border: 0, background: on ? 'var(--accent)' : 'var(--bg-3)', cursor: 'pointer' }}
            >
                <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: 12, background: '#fff', transition: 'left .15s ease' }} />
            </button>
        </div>
    );
}

function StyleSheet({ onClose }) {
    const { t } = useTranslation('editor');
    const textClips = useTimelineStore(useShallow(s => s.tracks.filter(tr => tr.type === 'text').flatMap(tr => tr.clips || [])));
    const first = textClips[0] || null;
    const currentPack = first?.captionStyle?.packId || null;
    const highlightOn = !!first?.captionStyle?.wordHighlight && first.captionStyle.wordHighlight.mode !== 'none';
    const hasWords = textClips.some(c => Array.isArray(c.words) && c.words.length > 0);

    const applyPack = (style) => {
        const captionStyle = legacyPackToCaptionStyle(style.id);
        // Keep the user's highlight choice when switching packs.
        if (first && !highlightOn) captionStyle.wordHighlight = { mode: 'none', scale: 1 };
        // Same fields the desktop Roka card sets (CaptionStylesCard).
        useTimelineStore.getState().applyCaptionStyleToAll({
            fontFamily: style.font,
            fontWeight: style.weight,
            color: style.color,
            stroke: style.stroke || null,
            textShadow: style.textShadow || null,
            fontStyle: style.style || 'normal',
            captionStyle,
            animations: [],
            animation: 'none',
        });
    };

    if (textClips.length === 0) {
        return (
            <MobileSheet open title={t('mobileCaptions.styleTitle')} onClose={onClose}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.5 }}>{t('mobileCaptions.noCaptions')}</p>
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
        <MobileSheet open title={t('mobileCaptions.styleTitle')} onClose={onClose}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {CAPTION_STYLES.map(style => {
                    const active = currentPack === style.id;
                    return (
                        <button
                            key={style.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => applyPack(style)}
                            style={{
                                height: 84, borderRadius: 'var(--r-sm)', padding: '0 8px', cursor: 'pointer',
                                border: active ? '2px solid var(--accent)' : '1px solid var(--line)',
                                background: '#111215', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}
                        >
                            <span style={{
                                fontFamily: FONT_STACK(style.font), fontWeight: style.weight, fontStyle: style.style || 'normal',
                                fontSize: 22, color: style.color, textShadow: style.textShadow || 'none',
                                textTransform: style.transform === 'uppercase' ? 'uppercase' : 'none',
                                WebkitTextStroke: style.stroke ? `${Math.min(1, style.stroke.width / 2)}px ${style.stroke.color}` : undefined,
                            }}>
                                {style.sample}
                            </span>
                            <span style={{ fontFamily: 'var(--f-sans)', fontSize: 11.5, color: 'var(--fg-2)' }}>{style.name}</span>
                        </button>
                    );
                })}
            </div>
            <Switch
                on={highlightOn}
                onChange={(on) => useTimelineStore.getState().setCaptionWordHighlight(on)}
                label={t('mobileCaptions.highlight')}
                sub={hasWords ? t('mobileCaptions.highlightSub') : t('mobileCaptions.highlightNoWords')}
            />
        </MobileSheet>
    );
}

function EditSheet({ placementId, onClose }) {
    const { t } = useTranslation('editor');
    const clip = useTimelineStore(s => s.tracks.flatMap(tr => (tr.type === 'text' ? tr.clips || [] : [])).find(c => c.id === placementId) || null);
    const hasNext = useTimelineStore(s => {
        const tr = s.tracks.find(x => x.type === 'text' && (x.clips || []).some(c => c.id === placementId));
        if (!tr) return false;
        const me = tr.clips.find(c => c.id === placementId);
        return tr.clips.some(c => c.id !== placementId && (Number(c.start) || 0) > (Number(me.start) || 0));
    });
    // Fresh state per caption / per saved text: the parent keys this component
    // on placementId + content, so no effect is needed to reset it.
    const [text, setText] = useState(clip?.content || '');
    const [picked, setPicked] = useState(-1);

    const words = Array.isArray(clip?.words) ? clip.words : [];
    if (!clip) return null;

    const st = () => useTimelineStore.getState();
    const dirty = text.replace(/\s+/g, ' ').trim() !== String(clip.content || '').trim();
    const save = () => { if (dirty) st().editCaptionText(placementId, text); };

    return (
        <MobileSheet open title={t('mobileCaptions.editTitle')} onClose={() => { save(); onClose(); }}>
            <span style={{ marginTop: -10, fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)' }}>
                {fmt(clip.start)} → {fmt((Number(clip.start) || 0) + (Number(clip.duration) || 0))}
            </span>
            <label htmlFor="mobile-caption-text" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{t('mobileCaptions.textLabel')}</label>
            <input
                id="mobile-caption-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); e.currentTarget.blur(); } }}
                style={{
                    marginTop: -8, height: 48, boxSizing: 'border-box', padding: '0 14px', borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 16, outline: 'none',
                }}
            />

            {words.length > 0 && (
                <>
                    <SheetLabel>{t('mobileCaptions.wordsLabel')}</SheetLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {words.map((w, i) => (
                            <button
                                key={i}
                                type="button"
                                aria-pressed={picked === i}
                                onClick={() => { setPicked(i); st().seek(Number(w.start) || 0); }}
                                style={{
                                    minHeight: 44, padding: '4px 10px', borderRadius: 10, cursor: 'pointer',
                                    border: `1px solid ${picked === i ? 'var(--accent)' : 'var(--line-strong)'}`,
                                    background: picked === i ? 'var(--accent-soft)' : 'var(--bg-3)', color: 'var(--fg)',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                                }}
                            >
                                <span style={{ fontFamily: 'var(--f-sans)', fontSize: 14 }}>{w.text ?? w.word}</span>
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--fg-3)' }}>{fmt(w.start)}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SheetRow
                    icon={<Scissors size={20} />}
                    label={t('mobileCaptions.splitHere')}
                    sub={picked >= 1 ? t('mobileCaptions.splitHereSub', { word: words[picked]?.text ?? words[picked]?.word ?? '' }) : t('mobileCaptions.splitPick')}
                    disabled={!(picked >= 1) || dirty}
                    onClick={() => { if (st().splitCaptionAt(placementId, picked)) onClose(); }}
                />
                <SheetRow
                    icon={<Merge size={20} />}
                    label={t('mobileCaptions.mergeNext')}
                    disabled={!hasNext || dirty}
                    onClick={() => { st().mergeCaptionWithNext(placementId); }}
                />
                <SheetRow
                    icon={<Play size={20} />}
                    label={t('mobileCaptions.playIt')}
                    onClick={() => { save(); st().seek(Number(clip.start) || 0); onClose(); }}
                />
            </div>
            {dirty && (
                <button
                    type="button"
                    onClick={save}
                    style={{ height: 48, borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600 }}
                >
                    {t('mobileCaptions.saveText')}
                </button>
            )}
        </MobileSheet>
    );
}

/** Remounts EditSheet when the caption or its saved text changes (fresh input state). */
function EditSheetKeyed({ placementId, onClose }) {
    const content = useTimelineStore(s => s.tracks.flatMap(tr => (tr.type === 'text' ? tr.clips || [] : [])).find(c => c.id === placementId)?.content ?? '');
    return <EditSheet key={`${placementId}:${content}`} placementId={placementId} onClose={onClose} />;
}

export default function MobileCaptionSheets() {
    const sheet = useAIStore(s => s.mobileCaptionSheet);
    const close = useAIStore(s => s.closeMobileCaptionSheet);
    if (!sheet) return null;
    if (sheet.kind === 'style') return <StyleSheet onClose={close} />;
    if (sheet.kind === 'edit' && sheet.placementId) return <EditSheetKeyed placementId={sheet.placementId} onClose={close} />;
    return null;
}

/** Small card in the Roka bar after captions are generated: opens the Style sheet. */
export function CaptionStyleCallout() {
    const { t } = useTranslation('editor');
    const open = useAIStore(s => s.openMobileCaptionSheet);
    return (
        <button
            type="button"
            onClick={() => open('style')}
            className="mb-2"
            style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '0 12px', textAlign: 'left',
                borderRadius: 'var(--r-sm)', border: '1px solid var(--line-strong)', background: 'var(--bg-3)', color: 'var(--fg)', cursor: 'pointer',
            }}
        >
            <Type size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ flex: 1, fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 600 }}>{t('mobileCaptions.styleCallout')}</span>
        </button>
    );
}
