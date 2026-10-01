import React from 'react';
import { Layers, Plus, Palette, Move, Music2, Type, X, Trash2, Scissors, Copy, Gauge, Pencil, Paintbrush, ScrollText } from 'lucide-react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../store/useTimelineStore';
import MobileSheet, { SheetChip } from './MobileSheet';
import useAIStore from '../store/useAIStore';
import { splitIndexAtTime } from '../motion/captionEdits.js';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

/** The selected clip and its track, read at tap time (no subscription). */
function selectedClip() {
    const { activeClipId, tracks } = useTimelineStore.getState();
    if (!activeClipId) return null;
    for (const track of tracks || []) {
        const clip = (track.clips || []).find(c => c.id === activeClipId);
        if (clip) return { clip, track };
    }
    return null;
}

/**
 * Actions available for each track type.
 * Each action maps to a left-panel tab (passed to onClipAction).
 */
const CLIP_ACTIONS = {
    video: [
        { id: 'color',     icon: Palette, label: 'mobileUi.color'     },
        { id: 'transform', icon: Move,    label: 'mobileUi.transform' },
    ],
    image: [
        { id: 'color',     icon: Palette, label: 'mobileUi.color'     },
        { id: 'transform', icon: Move,    label: 'mobileUi.transform' },
    ],
    audio: [
        { id: 'audio',     icon: Music2,  label: 'mobileUi.mixer'     },
    ],
    text: [
        // Full caption list / per-segment styling (TextPanel in the media sheet)
        { id: 'captions',  icon: Type,    label: 'mobileCaptions.panel' },
    ],
};

/** Sparkles icon (inline SVG — avoids a separate Sparkles import) */
const SparklesIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
);

/**
 * Mobile-only bottom toolbar.
 *
 * Two states:
 *  • Default (no clip selected): Media library, AI panel, Import (+)
 *  • Clip selected: track-type label + clip-specific action buttons + Done (X)
 *
 * @param {string|null}   activeSheet      Currently open sheet id, or null
 * @param {function}      onSheetChange    Toggle a sheet by id
 * @param {function}      onImport         Fire the file import picker
 * @param {string|null}   activeTrackType  Type of selected clip's track ('video'|'audio'|'text'), or null
 * @param {function}      onClipAction     Called with a tab name to open the left panel at that tab
 * @param {function}      onDeselect       Deselects the clip and closes any open panel
 */
export default function MobileToolbar({
    activeSheet,
    onSheetChange,
    onImport,
    activeTrackType,
    onClipAction,
    onDeselect,
    onDeleteClip,
}) {
    const hasClip = !!activeTrackType;
    const clipActions = CLIP_ACTIONS[activeTrackType] ?? [];

    return (
        <nav
            className="fixed bottom-0 inset-x-0 z-50 md:hidden flex items-stretch select-none"
            style={{
                background: 'var(--bg-2)',
                borderTop: '0.5px solid var(--line-strong)',
                paddingBottom: 'env(safe-area-inset-bottom)',
                height: 'calc(3.5rem + env(safe-area-inset-bottom))',
                transition: 'border-color 200ms',
                touchAction: 'manipulation',   // prevents 300ms tap delay on Android
            }}
        >
            {hasClip ? (
                /* ── Clip-selected state ───────────────────────────────────────── */
                <ClipContextBar
                    trackType={activeTrackType}
                    actions={clipActions}
                    activeSheet={activeSheet}
                    onClipAction={onClipAction}
                    onDeselect={onDeselect}
                    onDeleteClip={onDeleteClip}
                />
            ) : (
                /* ── Default state ─────────────────────────────────────────────── */
                <DefaultBar
                    activeSheet={activeSheet}
                    onSheetChange={onSheetChange}
                    onImport={onImport}
                />
            )}
        </nav>
    );
}

/* ── Default state: Media · AI · Add ──────────────────────────────────────── */
function DefaultBar({ activeSheet, onSheetChange, onImport }) {
    const { t } = useTranslation('editor');
    const transcriptOpen = useAIStore(s => s.mobileTranscriptOpen);
    return (
        <>
            <ToolbarBtn
                label={t('mobileUi.media', 'Media')}
                isActive={activeSheet === 'media'}
                onClick={() => onSheetChange('media')}
            >
                <Layers className="w-5 h-5" />
            </ToolbarBtn>

            <ToolbarBtn
                label={t('mobileUi.ai', 'AI')}
                isActive={activeSheet === 'ai'}
                onClick={() => onSheetChange('ai')}
            >
                <SparklesIcon className="w-5 h-5" />
            </ToolbarBtn>

            {/* Edit by text (MobileTranscriptSheet) */}
            <ToolbarBtn
                label={t('mobileTranscript.tab')}
                isActive={transcriptOpen}
                onClick={() => useAIStore.getState().setMobileTranscriptOpen(true)}
            >
                <ScrollText className="w-5 h-5" />
            </ToolbarBtn>

            {/* Add / Import — gradient pill */}
            <button
                onClick={onImport}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 active:scale-95"
            >
                <span
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{
                        background: 'linear-gradient(135deg, var(--accent), var(--violet))',
                        boxShadow: '0 0 14px rgba(0,229,255,0.35)',
                    }}
                >
                    <Plus className="w-4 h-4" style={{ color: '#000' }} />
                </span>
                <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)', color: 'var(--fg-3)' }}>
                    {t('mobileUi.add', 'Add')}
                </span>
            </button>
        </>
    );
}

/* ── Clip-selected state ──────────────────────────────────────────────────── */
function ClipContextBar({ trackType, actions, activeSheet, onClipAction, onDeselect, onDeleteClip }) {
    const { t } = useTranslation('editor');
    const typeLabel = {
        video: t('mobileUi.typeVideo'), audio: t('mobileUi.typeAudio'), text: t('mobileUi.typeText'), image: t('mobileUi.typeImage'),
    }[trackType] ?? trackType;
    const [confirmDelete, setConfirmDelete] = React.useState(false);
    const [speedOpen, setSpeedOpen] = React.useState(false);
    const currentSpeed = useTimelineStore(s => {
        if (!s.activeClipId) return 1;
        for (const tr of s.tracks || []) {
            const c = (tr.clips || []).find(cl => cl.id === s.activeClipId);
            if (c) return Number(c.speed) || 1;
        }
        return 1;
    });
    const isText = trackType === 'text';

    // Same store actions the desktop timeline toolbar uses.
    const split = () => {
        const sel = selectedClip();
        if (!sel) return;
        const st = useTimelineStore.getState();
        // A caption with word timings splits between words (each half keeps its
        // own text and timing); anything else uses the normal clip split.
        if (sel.track.type === 'text' && Array.isArray(sel.clip.words) && sel.clip.words.length > 1) {
            const idx = splitIndexAtTime(sel.clip.words, st.currentTime);
            if (idx >= 1) st.splitCaptionAt(sel.clip.id, idx);
            return;
        }
        st.splitClip(sel.track.id, sel.clip.id, st.currentTime);
    };
    const duplicate = () => {
        const sel = selectedClip();
        if (sel) useTimelineStore.getState().duplicateClip(sel.track.id, sel.clip.id);
    };
    const setSpeed = (speed) => {
        const sel = selectedClip();
        if (sel) useTimelineStore.getState().setClipSpeed(sel.track.id, sel.clip.id, speed);
        setSpeedOpen(false);
    };
    const openCaptionSheet = (kind) => {
        const sel = selectedClip();
        useAIStore.getState().openMobileCaptionSheet(kind, sel?.clip?.id || null);
    };
    // A caption (has word timings) edits through the caption sheets; a text
    // the user added by hand edits through the text sheet (font, colour, animation).
    const isCaption = useTimelineStore(st => {
        if (!st.activeClipId) return false;
        for (const tr of st.tracks || []) {
            const c = (tr.clips || []).find(cl => cl.id === st.activeClipId);
            if (c) return Array.isArray(c.words) && c.words.length > 0;
        }
        return false;
    });
    const editTools = isText && isCaption
        ? [
            { id: 'edit', icon: <Pencil className="w-5 h-5" />, label: t('mobileCaptions.edit'), onClick: () => openCaptionSheet('edit') },
            { id: 'style', icon: <Paintbrush className="w-5 h-5" />, label: t('mobileCaptions.style'), onClick: () => openCaptionSheet('style') },
            { id: 'split', icon: <Scissors className="w-5 h-5" />, label: t('mobileUi.split'), onClick: split },
        ]
        : isText
        ? [
            { id: 'edit', icon: <Pencil className="w-5 h-5" />, label: t('mobileCaptions.edit'), onClick: () => openCaptionSheet('text') },
            { id: 'split', icon: <Scissors className="w-5 h-5" />, label: t('mobileUi.split'), onClick: split },
            { id: 'duplicate', icon: <Copy className="w-5 h-5" />, label: t('mobileUi.duplicate'), onClick: duplicate },
        ]
        : [
            { id: 'split', icon: <Scissors className="w-5 h-5" />, label: t('mobileUi.split'), onClick: split },
            { id: 'duplicate', icon: <Copy className="w-5 h-5" />, label: t('mobileUi.duplicate'), onClick: duplicate },
            { id: 'speed', icon: <Gauge className="w-5 h-5" />, label: t('mobileUi.speed'), onClick: () => setSpeedOpen(true) },
        ];

    const handleDeletePress = () => {
        if (confirmDelete) {
            onDeleteClip?.();
        } else {
            setConfirmDelete(true);
            // Auto-reset after 2.5s if user doesn't confirm
            setTimeout(() => setConfirmDelete(false), 2500);
        }
    };

    return (
        <>
            {/* Track type, for screen readers (no room for a visible chip next to 7 actions) */}
            <span className="sr-only">{typeLabel}</span>

            {editTools.map(({ id, icon, label, onClick }) => (
                <button
                    key={id}
                    type="button"
                    onClick={onClick}
                    className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 active:opacity-70"
                    style={{ color: 'var(--fg)', minWidth: 48 }}
                >
                    {icon}
                    <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)' }}>{label}</span>
                </button>
            ))}

            {/* Clip-specific action buttons */}
            {actions.map(({ id, icon: Icon, label }) => {
                const isActive = activeSheet === 'media';
                return (
                    <button
                        key={id}
                        onClick={() => onClipAction(id)}
                        className={classNames(
                            'flex-1 flex flex-col items-center justify-center gap-0.5 relative',
                            'transition-all duration-150 active:opacity-70',
                        )}
                        style={{ color: isActive ? 'var(--accent)' : 'var(--fg)' }}
                    >
                        {isActive && (
                            <span
                                className="absolute top-0 inset-x-3 h-0.5 rounded-b-full"
                                style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}
                            />
                        )}
                        <Icon className="w-5 h-5" />
                        <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)' }}>
                            {t(label)}
                        </span>
                    </button>
                );
            })}

            {/* Push right-side buttons to the right */}
            <div className="flex-1" style={{ minWidth: 0 }} />

            {/* Delete — tap once to arm (turns red), tap again to confirm */}
            <button
                onClick={handleDeletePress}
                className="flex flex-col items-center justify-center gap-0.5 px-3 transition-all duration-150 active:scale-95"
                style={{ color: confirmDelete ? '#FF5A5A' : 'var(--fg-3)' }}
            >
                <Trash2 className="w-5 h-5" />
                <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)' }}>
                    {confirmDelete ? t('mobileUi.confirm') : t('mobileUi.delete')}
                </span>
            </button>

            {/* Done / Deselect */}
            <button
                onClick={onDeselect}
                className="flex flex-col items-center justify-center gap-0.5 px-3 transition-all duration-150 active:opacity-70"
                style={{ color: 'var(--fg-3)' }}
            >
                <X className="w-5 h-5" />
                <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)' }}>
                    {t('mobileUi.done')}
                </span>
            </button>

            <MobileSheet open={speedOpen} title={t('mobileUi.speedTitle')} onClose={() => setSpeedOpen(false)}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {SPEEDS.map(sp => (
                        <SheetChip key={sp} active={Math.abs(currentSpeed - sp) < 1e-6} onClick={() => setSpeed(sp)}>{sp}x</SheetChip>
                    ))}
                </div>
            </MobileSheet>
        </>
    );
}

/* ── Shared button primitive ──────────────────────────────────────────────── */
function ToolbarBtn({ label, isActive, onClick, children }) {
    return (
        <button
            onClick={onClick}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-all duration-150 active:opacity-70"
            style={{ color: isActive ? 'var(--accent)' : 'var(--fg-3)' }}
        >
            {isActive && (
                <span
                    className="absolute top-0 inset-x-3 h-0.5 rounded-b-full"
                    style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}
                />
            )}
            {children}
            <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)' }}>
                {label}
            </span>
        </button>
    );
}
