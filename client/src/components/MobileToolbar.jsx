import React from 'react';
import { Layers, Plus, Palette, Move, Music2, Type, X, Trash2 } from 'lucide-react';
import classNames from 'classnames';

/**
 * Actions available for each track type.
 * Each action maps to a left-panel tab (passed to onClipAction).
 */
const CLIP_ACTIONS = {
    video: [
        { id: 'color',     icon: Palette, label: 'Color'     },
        { id: 'transform', icon: Move,    label: 'Transform' },
    ],
    image: [
        { id: 'color',     icon: Palette, label: 'Color'     },
        { id: 'transform', icon: Move,    label: 'Transform' },
    ],
    audio: [
        { id: 'audio',     icon: Music2,  label: 'Mixer'     },
    ],
    text: [
        { id: 'captions',  icon: Type,    label: 'Captions'  },
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
    return (
        <>
            <ToolbarBtn
                label="Media"
                isActive={activeSheet === 'media'}
                onClick={() => onSheetChange('media')}
            >
                <Layers className="w-5 h-5" />
            </ToolbarBtn>

            <ToolbarBtn
                label="AI"
                isActive={activeSheet === 'ai'}
                onClick={() => onSheetChange('ai')}
            >
                <SparklesIcon className="w-5 h-5" />
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
                    Add
                </span>
            </button>
        </>
    );
}

/* ── Clip-selected state ──────────────────────────────────────────────────── */
function ClipContextBar({ trackType, actions, activeSheet, onClipAction, onDeselect, onDeleteClip }) {
    const typeLabel = { video: 'VIDEO', audio: 'AUDIO', text: 'TEXT', image: 'IMAGE' }[trackType] ?? trackType.toUpperCase();
    const [confirmDelete, setConfirmDelete] = React.useState(false);

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
            {/* Track type chip */}
            <div
                className="flex items-center pl-3 pr-1 shrink-0"
                style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 8,
                    letterSpacing: '0.1em',
                    color: 'var(--accent)',
                    opacity: 0.7,
                    textTransform: 'uppercase',
                }}
            >
                {typeLabel}
            </div>

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
                            {label}
                        </span>
                    </button>
                );
            })}

            {/* Push right-side buttons to the right */}
            <div className="flex-1" />

            {/* Delete — tap once to arm (turns red), tap again to confirm */}
            <button
                onClick={handleDeletePress}
                className="flex flex-col items-center justify-center gap-0.5 px-4 transition-all duration-150 active:scale-95"
                style={{ color: confirmDelete ? '#FF5A5A' : 'var(--fg-3)' }}
            >
                <Trash2 className="w-5 h-5" />
                <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)' }}>
                    {confirmDelete ? 'Confirm' : 'Delete'}
                </span>
            </button>

            {/* Done / Deselect */}
            <button
                onClick={onDeselect}
                className="flex flex-col items-center justify-center gap-0.5 px-4 transition-all duration-150 active:opacity-70"
                style={{ color: 'var(--fg-3)' }}
            >
                <X className="w-5 h-5" />
                <span className="text-[9px] font-medium tracking-wide" style={{ fontFamily: 'var(--f-mono)' }}>
                    Done
                </span>
            </button>
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
