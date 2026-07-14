import React from 'react';
import { Layers, Sparkles, Plus, Music2, MoreHorizontal } from 'lucide-react';
import classNames from 'classnames';

const TOOLS = [
    { id: 'media', icon: Layers,          label: 'Media' },
    { id: 'ai',    icon: Sparkles,         label: 'AI' },
    { id: 'add',   icon: Plus,             label: 'Add',   isAction: true },
    { id: 'audio', icon: Music2,           label: 'Audio' },
    { id: 'more',  icon: MoreHorizontal,   label: 'More' },
];

/**
 * Mobile-only bottom toolbar.
 * Replaces the old MobileBottomNav tab model with a sheet-toggle model:
 * pressing an icon opens/closes its bottom sheet rather than switching full-screen tabs.
 *
 * @param {string|null} activeSheet   - Currently open sheet id, or null
 * @param {function}    onSheetChange - Called with the sheet id when a button is tapped
 * @param {function}    onImport      - Called when the + (add) button is tapped
 */
export default function MobileToolbar({ activeSheet, onSheetChange, onImport }) {
    return (
        <nav
            className="fixed bottom-0 inset-x-0 z-50 md:hidden flex items-stretch select-none"
            style={{
                background: 'var(--bg-2)',
                borderTop: '0.5px solid var(--line-strong)',
                paddingBottom: 'env(safe-area-inset-bottom)',
                height: 'calc(3.5rem + env(safe-area-inset-bottom))',
            }}
        >
            {TOOLS.map(({ id, icon: Icon, label, isAction }) => {
                const isActive = !isAction && activeSheet === id;
                return (
                    <button
                        key={id}
                        onClick={() => (isAction ? onImport() : onSheetChange(id))}
                        className={classNames(
                            'flex-1 flex flex-col items-center justify-center gap-0.5 relative',
                            'transition-all duration-150 active:opacity-70',
                        )}
                        style={{ color: isActive ? 'var(--accent)' : 'var(--fg-3)' }}
                    >
                        {/* Active indicator — top glow bar */}
                        {isActive && (
                            <span
                                className="absolute top-0 inset-x-3 h-0.5 rounded-b-full"
                                style={{
                                    background: 'var(--accent)',
                                    boxShadow: '0 0 8px var(--accent)',
                                }}
                            />
                        )}

                        {isAction ? (
                            /* + button — gradient pill */
                            <span
                                className="w-8 h-8 rounded-full flex items-center justify-center"
                                style={{
                                    background: 'linear-gradient(135deg, var(--accent), var(--violet))',
                                    boxShadow: '0 0 14px rgba(0,229,255,0.35)',
                                }}
                            >
                                <Icon className="w-4 h-4" style={{ color: '#000' }} />
                            </span>
                        ) : (
                            <Icon className="w-5 h-5" />
                        )}

                        <span
                            className="text-[9px] font-medium tracking-wide"
                            style={{ fontFamily: 'var(--f-mono)' }}
                        >
                            {label}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}
