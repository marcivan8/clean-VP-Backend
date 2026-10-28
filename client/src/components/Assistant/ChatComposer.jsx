import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUp, Square, X, Video, Music, Type } from 'lucide-react';
import useTimelineStore from '../../store/useTimelineStore';
import EditingStylePicker from './EditingStylePicker.jsx';
import { contextChipsFor } from './composerTools.js';

/**
 * R110 - the assistant's chat box, desktop-first.
 *
 *   [ clip chips ........................................ ]   what the request is about
 *   [ textarea ........................................... ]
 *   [ Vlog v ]  [ Normal | Auto ]                     ( send )
 *
 * Chips are the real selection (`selectedClipIds`), which the agent already
 * honours for clip-level commands, and removing one deselects it - nothing
 * here is decoration.
 *
 * R116 - the left button is the EDITING STYLE (EditingStylePicker.jsx), in
 * the slot R110/R111 gave to Tools. The style is what a person sets before
 * they say anything - it steers every prompt in Normal mode and IS the
 * playbook in Auto - so it earns the primary control rather than a small pill
 * beside one. The one-click command menu that used to live here is still in
 * composerTools.js, no longer mounted.
 *
 * The textarea stays UNCONTROLLED and keeps `data-hint="assistant-input"`:
 * suggestions, quick chips and the brain write to `inputRef.current.value`,
 * and the onboarding hint anchors on that element.
 *
 * Chips, Tools and the style picker are desktop-only: this panel is also the
 * mobile AI bar's expanded view, which has its own strip and no room for them.
 */

const KIND_ICONS = { video: Video, audio: Music, text: Type };

const ContextChips = () => {
    const { t } = useTranslation('editor');
    const { tracks, selectedClipIds, toggleClipSelection } = useTimelineStore(useShallow(s => ({
        tracks: s.tracks, selectedClipIds: s.selectedClipIds, toggleClipSelection: s.toggleClipSelection,
    })));
    const { chips, more } = contextChipsFor(tracks, selectedClipIds);
    if (chips.length === 0) return null;
    return (
        <div className="chat-composer__chips" role="list" aria-label={t('assistant.contextLabel')}>
            {chips.map(chip => {
                const Icon = KIND_ICONS[chip.kind] || Video;
                return (
                    <span key={chip.id} role="listitem" className="chat-composer__chip" title={t('assistant.contextHint')}>
                        <Icon className="w-3.5 h-3.5 shrink-0 chat-composer__chip-icon" />
                        <span className="chat-composer__chip-name">{chip.name}</span>
                        <button
                            type="button"
                            onClick={() => toggleClipSelection(chip.id)}
                            aria-label={t('assistant.contextRemove', { name: chip.name })}
                            className="chat-composer__chip-x"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                );
            })}
            {more > 0 && <span className="chat-composer__chip chat-composer__chip--more">+{more}</span>}
        </div>
    );
};

const ChatComposer = ({ inputRef, placeholder, busy, onSend, onStop, onKeyDown, newlineHint }) => {
    const { t } = useTranslation('editor');

    const onInput = (e) => {
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    };

    return (
        <div className="chat-composer">
            <div className="hidden md:block"><ContextChips /></div>
            <textarea
                ref={inputRef}
                rows={2}
                // R105 anchor: the `first_upload` hint lands here (the move people
                // do not make is asking for something).
                data-hint="assistant-input"
                disabled={busy}
                onKeyDown={onKeyDown}
                onInput={onInput}
                placeholder={placeholder}
                // 16px below md: iOS Safari zooms the page on focus under 16px
                // (this panel is also the mobile AI bar's expanded view).
                className="chat-composer__input text-[16px] md:text-sm placeholder:opacity-40"
            />
            <div className="chat-composer__bar">
                <div className="hidden md:flex items-center gap-1.5 min-w-0">
                    <EditingStylePicker disabled={busy} />
                </div>
                <div className="ml-auto flex items-center gap-2.5">
                    {newlineHint && !busy && (
                        <span className="text-[10px] opacity-30 hidden 2xl:inline" style={{ color: 'var(--fg)', fontFamily: 'var(--f-mono)' }}>{newlineHint}</span>
                    )}
                    {busy ? (
                        <button type="button" onClick={onStop} className="chat-composer__send chat-composer__send--stop" aria-label={t('assistant.stop')} title={t('assistant.stop')}>
                            <Square className="w-3.5 h-3.5" fill="currentColor" />
                        </button>
                    ) : (
                        <button type="button" onClick={onSend} className="chat-composer__send" aria-label={t('assistant.send')} title={t('assistant.send')}>
                            <ArrowUp className="w-4 h-4" strokeWidth={2.4} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChatComposer;
