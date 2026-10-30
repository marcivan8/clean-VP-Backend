import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Square, X, Plus, FileText } from 'lucide-react';
import EditingStylePicker from './EditingStylePicker.jsx';
import { MAX_ASSISTANT_DOCUMENTS, readAssistantDocument } from './assistantDocuments.js';

/**
 * R110 - the assistant's chat box, desktop-first.
 *
 *   [ textarea ........................................... ]
 *   [ Vlog v ]  [ Normal | Auto ]                     ( send )
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

const ChatComposer = ({ inputRef, placeholder, busy, onSend, onStop, onKeyDown, newlineHint, documents = [], onDocumentsChange, mediaAttachments = [], onMediaAttachmentsChange, onImportMedia }) => {
    const { t } = useTranslation('editor');
    const fileInputRef = useRef(null);
    const [readingDocuments, setReadingDocuments] = useState(false);
    const [documentError, setDocumentError] = useState('');

    const onChooseDocuments = async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        setDocumentError('');
        const docFiles = files.filter(file => /\.(txt|md|markdown|csv|json|docx)$/i.test(file.name));
        const mediaFiles = files.filter(file => file.type.startsWith('video/') || file.type.startsWith('image/'));
        const unsupported = files.filter(file => !docFiles.includes(file) && !mediaFiles.includes(file));
        if (unsupported.length) {
            setDocumentError(t('assistant.attachmentUnsupported'));
            return;
        }
        const available = MAX_ASSISTANT_DOCUMENTS - documents.length;
        if (docFiles.length > available) {
            setDocumentError(t('assistant.documentLimit', { count: MAX_ASSISTANT_DOCUMENTS }));
            return;
        }
        setReadingDocuments(true);
        try {
            const parsed = [];
            for (const file of docFiles) parsed.push(await readAssistantDocument(file));
            if (parsed.length) onDocumentsChange([...documents, ...parsed]);
            if (mediaFiles.length) {
                if (!onImportMedia) throw new Error('Media import is unavailable.');
                const imported = await onImportMedia(mediaFiles);
                if (imported?.length) {
                    const additions = imported.map(({ id, name, type }) => ({ id, name, type }));
                    onMediaAttachmentsChange?.([...mediaAttachments, ...additions.filter(item => !mediaAttachments.some(existing => existing.id === item.id))]);
                }
            }
        } catch (error) {
            setDocumentError(error.code ? t(`assistant.${error.code}`) : (error.message || t('assistant.documentReadError')));
        } finally {
            setReadingDocuments(false);
        }
    };

    const onInput = (e) => {
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    };

    return (
        <div className="chat-composer">
            <div className="chat-composer__attachments">
                <button
                    type="button"
                    className="chat-composer__attach"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy || readingDocuments}
                    aria-label={t('assistant.attachFiles')}
                    title={t('assistant.attachFilesHint')}
                >
                    {readingDocuments ? <span className="chat-composer__attach-spinner" /> : <Plus className="w-4 h-4" />}
                </button>
                <input
                    ref={fileInputRef}
                    className="sr-only"
                    type="file"
                    accept=".txt,.md,.markdown,.csv,.json,.docx,text/plain,text/markdown,text/csv,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/*,image/*"
                    multiple
                    onChange={onChooseDocuments}
                    tabIndex={-1}
                />
                {documents.map(document => (
                    <span key={document.id} className="chat-composer__document" title={document.truncated ? t('assistant.documentTruncated') : document.name}>
                        <FileText className="w-3 h-3 shrink-0" />
                        <span className="chat-composer__document-name">{document.name}</span>
                        <button
                            type="button"
                            className="chat-composer__document-remove"
                            aria-label={t('assistant.removeDocument', { name: document.name })}
                            onClick={() => onDocumentsChange(documents.filter(item => item.id !== document.id))}
                        ><X className="w-3 h-3" /></button>
                    </span>
                ))}
                {mediaAttachments.map(asset => (
                    <span key={asset.id} className="chat-composer__document" title={asset.name}>
                        <FileText className="w-3 h-3 shrink-0" />
                        <span className="chat-composer__document-name">{asset.name}</span>
                        <button
                            type="button"
                            className="chat-composer__document-remove"
                            aria-label={t('assistant.removeDocument', { name: asset.name })}
                            onClick={() => onMediaAttachmentsChange?.(mediaAttachments.filter(item => item.id !== asset.id))}
                        ><X className="w-3 h-3" /></button>
                    </span>
                ))}
            </div>
            {documentError && <p className="chat-composer__document-error" role="alert">{documentError}</p>}
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
