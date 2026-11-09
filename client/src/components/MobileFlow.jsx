import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Loader2, Share2, Sparkles, SlidersHorizontal, History, UserRound, Smartphone, Video, MonitorPlay, ArrowLeft, Minus, Zap, Type, MessageCircle, Music2, Clock, ArrowRight, Film, Play, Pause } from 'lucide-react';
import useMobileFlowStore from '../store/useMobileFlowStore';
import useEditStepsStore from '../store/useEditStepsStore';
import { OUTCOMES, OUTCOME_BY_ID, startOutcome } from '../agent/mobileOutcomes';
import useTimelineStore from '../store/useTimelineStore';
import { editJobManager } from '../agent/EditJobManager';
import useVersionsStore from '../agent/projectVersions';
import PlanSheet from './PlanSheet.jsx';
import { EventBus, EVENT_TYPES } from '../agent/EventBus';
import { contentEnd, togglePreview } from '../timeline/previewPlayback.js';
import { summarizeUploads } from '../lib/uploadProgress.js';
import { trackEvent } from '../utils/trackEvent.js';

/* The flow covers the editor while it is open; the editor keeps running
   underneath, which is what makes "Skip" instant. */
// MobileSheet sits at 60/61 — the plan-first approval, the export sheet and the
// caption sheets all use it. The flow is the surface those open ON TOP of, so it
// sits below them. At equal z-index this was decided by DOM order, which is not
// a thing to leave to chance when the losing case hides an Apply button.
const Z = 55;

const sheet = {
    position: 'fixed', inset: 0, zIndex: Z,
    background: 'radial-gradient(100% 38% at 0% 0%, rgba(0,190,205,.09), transparent 74%), radial-gradient(80% 45% at 100% 100%, rgba(112,35,170,.13), transparent 70%), var(--bg)', color: 'var(--fg)',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--f-sans)',
};

/** A bottom sheet over the editor: the short itself stays visible behind it. */
const panel = {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: Z,
    background: 'var(--bg)', color: 'var(--fg)',
    borderTop: '1px solid var(--line)',
    borderRadius: '20px 20px 0 0',
    padding: '20px 20px 26px',
    fontFamily: 'var(--f-sans)',
    boxShadow: '0 -24px 60px -30px rgba(0,0,0,0.9)',
};

const fmt = (secs) => {
    const s = Math.max(0, Math.round(Number(secs) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function outcomeFromPrompt(prompt, fallback) {
    const text = String(prompt || '').toLowerCase();
    if (/photo\s*(?:collage|montage)|collage\s*(?:of\s*)?photos?|montage\s*photo/.test(text)) return 'photo_collage';
    if (/story\s*time|storytime|tell(?:ing)?\s+(?:my\s+)?story/.test(text)) return 'story_time';
    if (/how[- ]?to|tutorial|step[- ]by[- ]step/.test(text)) return 'howto';
    if (/\bvlog\b/.test(text)) return 'vlog';
    if (/talking\s*head|face\s*camera|\binterview\b/.test(text)) return 'talking_head';
    if (/\breel\b|\btiktok\b|\bshorts?\b/.test(text)) return 'reel';
    return fallback || 'reel';
}

/* ── What are you making? ─────────────────────────────────────────────────── */

function OutcomeStep() {
    const { t } = useTranslation('editor');
    const choose = useMobileFlowStore(s => s.choose);
    const beginProgress = useMobileFlowStore(s => s.beginProgress);
    const updateProgress = useMobileFlowStore(s => s.updateProgress);
    const close = useMobileFlowStore(s => s.close);
    const error = useMobileFlowStore(s => s.error);
    const creationDraft = useMobileFlowStore(s => s.creationDraft);
    const setCreationDraft = useMobileFlowStore(s => s.setCreationDraft);
    const assets = useTimelineStore(s => s.assets) || [];
    // One number for the whole import, not the first file's.
    const upload = summarizeUploads(assets);
    const selectedOutcome = creationDraft?.outcomeId || 'reel';
    const request = creationDraft?.request || '';
    const editableAssets = assets.filter(asset => !asset.assistantReference && ['video', 'image', 'audio'].includes(asset.type));
    const hasVisualAssets = editableAssets.some(asset => ['video', 'image'].includes(asset.type));
    const pendingAssets = editableAssets.filter(asset => asset.isProxying || (asset.uploadPhase && !['ready', 'complete'].includes(asset.uploadPhase)));
    const failedAssets = editableAssets.filter(asset => asset.uploadError);
    const canCreate = hasVisualAssets && pendingAssets.length === 0 && failedAssets.length === 0;

    const create = () => {
        if (!canCreate) return;
        const id = outcomeFromPrompt(request, selectedOutcome);
        const asksForMusic = /\b(music|soundtrack|song|background track)\b/i.test(request)
            && !/\b(?:no|without|remove|mute)\s+(?:any\s+)?(?:background\s+)?(?:music|soundtrack|song)\b/i.test(request);
        if (asksForMusic) {
            const live = useTimelineStore.getState();
            const placedAssetIds = new Set((live.tracks || []).flatMap(track => (track.clips || []).map(clip => clip.assetId)));
            // Audio stays in the bin until the user asks for it. At that point,
            // add their uploaded track to the edit before the playbook runs.
            editableAssets
                .filter(asset => asset.type === 'audio' && !placedAssetIds.has(asset.id))
                .forEach(asset => live.addAssetToTimeline?.(asset));
        }
        trackEvent('mobile_short_creation_started', {
            outcome: id,
            has_prompt: Boolean(request.trim()),
            asset_count: editableAssets.length,
        });
        choose(id);
        // The run is fired and watched here rather than in the store: a store
        // that starts work is a store you cannot reason about in a test.
        startOutcome(id, {
            request: request.trim(),
            onPlan: beginProgress,
            onStep: ({ index, state, message }) => updateProgress(index, state, message),
        })
            .then((result) => {
                if (!result?.success) throw new Error(result?.message || t('mobileFlow.editFailed', 'The edit could not be completed.'));
                // A version per finished run is what makes "go back" possible
                // without asking a beginner to count undo steps.
                useVersionsStore.getState().capture(t(`mobileFlow.outcome.${id}`, id));
                trackEvent('mobile_short_preview_ready', { outcome: id });
                useMobileFlowStore.getState().finished();
            })
            .catch((err) => useMobileFlowStore.getState().failed(err?.message));
    };

    return (
        <div style={{ ...sheet, overflowY: 'auto', paddingBottom: 'calc(190px + env(safe-area-inset-bottom))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px 0' }}>
                <button type="button" onClick={close} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 42, padding: 0, border: 0, background: 'transparent', color: 'var(--fg-3)', fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.16em' }}><ArrowLeft size={17} /> {t('mobileFlow.newShortEyebrow', 'NEW SHORT')}</button>
                <button
                    type="button"
                    onClick={close}
                    style={{ minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14.5, cursor: 'pointer' }}
                >
                    {t('mobileFlow.skip', 'Skip')}
                </button>
            </div>

            <div style={{ padding: '6px 20px 0' }}>
                <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                    {t('mobileFlow.title', 'What are you making?')}
                </h1>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--fg-2)' }}>
                    {t('mobileFlow.subtitle', 'Tell us what you want. We’ll shape your footage into a short.')}
                </p>
                {error && (
                    <p role="alert" style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--coral)' }}>{error}</p>
                )}
            </div>

            <label htmlFor="mobile-short-request" style={{ display: 'block', margin: '18px 20px 8px', fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>
                {t('mobileFlow.promptLabel', 'Describe your short')}
            </label>
            <textarea
                id="mobile-short-request"
                value={request}
                onChange={event => setCreationDraft({ request: event.target.value })}
                placeholder={t('mobileFlow.promptPlaceholder', 'Make a 30 second reel from my clips with upbeat music and captions')}
                rows={3}
                style={{ margin: '0 20px', padding: '13px 15px', minHeight: 88, resize: 'vertical', borderRadius: 15, border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--fg)', font: 'inherit', fontSize: 15, lineHeight: 1.45, outlineColor: 'var(--accent)' }}
            />

            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                {OUTCOMES.map(o => (
                    <button
                        key={o.id}
                        type="button"
                        aria-pressed={selectedOutcome === o.id}
                        onClick={() => setCreationDraft({ outcomeId: o.id })}
                        style={{
                            minHeight: 112, padding: 18, borderRadius: 18, cursor: 'pointer', textAlign: 'left',
                            background: selectedOutcome === o.id ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-2))' : 'linear-gradient(145deg, rgba(255,255,255,.035), rgba(255,255,255,.015))', border: `1px solid ${selectedOutcome === o.id ? 'var(--accent)' : 'var(--line)'}`, color: 'var(--fg)',
                            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8,
                            fontFamily: 'var(--f-sans)',
                        }}
                    >
                        <span aria-hidden="true" style={{ color: '#61e8f1', marginBottom: 2 }}>{o.id === 'talking_head' || o.id === 'story_time' ? <UserRound size={19} /> : o.id === 'reel' ? <Smartphone size={19} /> : o.id === 'vlog' ? <Video size={19} /> : o.id === 'photo_collage' ? <Film size={19} /> : <MonitorPlay size={19} />}</span>
                        <span style={{ fontSize: 16.5, fontWeight: 650, lineHeight: 1.2 }}>
                            {t(`mobileFlow.outcome.${o.id}`, o.id)}
                        </span>
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: '#67e5ed' }}>{o.range}</span>
                    </button>
                ))}
            </div>
            {(upload || failedAssets.length > 0) && <div style={{ margin: '0 20px 16px', padding: 15, border: '1px solid var(--line)', borderRadius: 15, background: 'var(--bg-2)' }} aria-live="polite">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {upload && upload.total > 1
                            ? t('mobileFlow.uploadBatch', { defaultValue: '{{done}} of {{total}} files ready', done: upload.done, total: upload.total })
                            : (upload?.activeName || failedAssets[0]?.name || t('mobileFlow.uploading', 'Uploading your video'))}
                    </span>
                    {upload && <span style={{ flex: 'none', color: '#6ee5eb' }}>{upload.percent}%</span>}
                </div>
                {upload && <div style={{ height: 4, margin: '9px 0 10px', background: 'var(--line)', borderRadius: 8 }}><div style={{ width: `${upload.percent}%`, height: '100%', borderRadius: 8, background: 'linear-gradient(90deg,#09d6e6,#8529df)', transition: 'width .3s ease' }} /></div>}
                {/* With several files the name of the one currently moving is the
                    reassuring part; the count above already carries the progress. */}
                {upload?.total > 1 && upload.activeName && (
                    <p style={{ margin: '0 0 6px', color: 'var(--fg-2)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{upload.activeName}</p>
                )}
                <p style={{ margin: 0, color: failedAssets.length ? 'var(--coral)' : 'var(--fg-3)', fontSize: 12.5 }}>{failedAssets.length
                    ? t('mobileFlow.uploadFailedNote', 'An upload needs attention. Retry it before creating your short.')
                    : t('mobileFlow.uploadNote', 'Your prompt is saved here. You can create your short when the uploads are ready.')}</p>
            </div>}
            <button
                type="button"
                onClick={create}
                disabled={!canCreate}
                style={{ margin: '0 20px 24px', minHeight: 54, border: 0, borderRadius: 999, background: 'var(--fg)', color: 'var(--bg)', fontSize: 16, fontWeight: 700, fontFamily: 'var(--f-sans)', opacity: canCreate ? 1 : .45, cursor: canCreate ? 'pointer' : 'not-allowed' }}
            >
                {pendingAssets.length ? t('mobileFlow.waitingForUploads', 'Preparing your footage…') : t('mobileFlow.createShort', 'Create my short')}
            </button>
        </div>
    );
}

/* ── It edits ─────────────────────────────────────────────────────────────── */

function WorkingStep() {
    const { t } = useTranslation('editor');
    const steps = useEditStepsStore(s => s.steps);
    const startedAt = useEditStepsStore(s => s.startedAt);
    const flowSteps = useMobileFlowStore(s => s.progressSteps);
    const flowStartedAt = useMobileFlowStore(s => s.progressStartedAt);
    const visibleSteps = flowSteps.length ? flowSteps : steps;
    const doneCount = visibleSteps.filter(s => s.state === 'done').length;
    const progress = visibleSteps.length ? Math.round((doneCount / visibleSteps.length) * 100) : 0;
    const stage = !visibleSteps.length
        ? 'starting'
        : progress >= 70
            ? 'finishingShort'
            : progress >= 30
                ? 'shapingStory'
                : 'reviewingFootage';

    // Only the finished steps carry a sentence; the running one is the heading
    // of the list, not a line in it.
    const progressTime = flowStartedAt || startedAt;

    return (
        <div style={sheet}>
            <div style={{ padding: '26px 20px 0' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.16em', color: '#62e5ed' }}>
                    {t('mobileFlow.workingEyebrow', 'WORKING')}
                </span>
                <h1 style={{ margin: '12px 0 0', fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                    {t('mobileFlow.working', 'Making your short')}
                </h1>
            </div>

            <div aria-live="polite" role="status" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
                <Loader2 size={32} className="animate-spin" style={{ color: '#62e5ed' }} />
                <span style={{ fontSize: 17, fontWeight: 600 }}>{t(`mobileFlow.${stage}`, stage)}</span>
            </div>

            <div style={{ padding: '0 20px 26px' }}>
                <p style={{ margin: '0 0 14px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13.5 }}>{progressTime ? t('mobileFlow.waitingForPreview', 'Your preview will appear here when it’s ready.') : t('mobileFlow.starting', 'Getting started')}</p>
            </div>
        </div>
    );
}


/* ── The finished short ───────────────────────────────────────────────────── */

/* The editor's own preview is behind this sheet, already showing the result, so
   the player is not rebuilt here — it would mean duplicating the derived project
   and variables IDELayout computes for it. */
/* ── Playing the short ────────────────────────────────────────────────────── */

/* The result screen is where someone watches what the AI made, so it has to
   play. The editor's own transport (MobileTransportBar) sits under the preview
   and this sheet covers it, and reusing it here would bring undo, redo, clip
   skip and the More sheet back into a flow built to keep them out. A review
   screen wants one thing: tap to play. The logic lives in
   timeline/previewPlayback.js, because this file may only export components. */

/* The playhead, written straight to the DOM every frame. Subscribing React to
   currentTime would re-render this whole sheet sixty times a second. Same
   reason MobileTransportBar keeps its clock in a ref. */
function Scrubber() {
    const barRef = useRef(null);
    const fillRef = useRef(null);
    const timeRef = useRef(null);
    const draggingRef = useRef(false);

    React.useEffect(() => {
        let raf;
        const tick = () => {
            const st = useTimelineStore.getState();
            const end = contentEnd(st);
            const at = Math.min(Math.max(0, Number(st.currentTime) || 0), end);
            if (fillRef.current) fillRef.current.style.width = end > 0 ? `${(at / end) * 100}%` : '0%';
            if (timeRef.current) timeRef.current.textContent = fmt(at);
            // A short loops, the way it will wherever it gets posted.
            if (st.isPlaying && !draggingRef.current && end > 0 && at >= end - 0.05) st.seek(0);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    const seekFrom = (clientX) => {
        const el = barRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0) return;
        const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        const st = useTimelineStore.getState();
        st.seek(frac * contentEnd(st));
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div
                ref={barRef}
                role="presentation"
                onPointerDown={(e) => {
                    draggingRef.current = true;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    seekFrom(e.clientX);
                }}
                onPointerMove={(e) => { if (draggingRef.current) seekFrom(e.clientX); }}
                onPointerUp={(e) => {
                    draggingRef.current = false;
                    e.currentTarget.releasePointerCapture?.(e.pointerId);
                }}
                onPointerCancel={() => { draggingRef.current = false; }}
                // A 3px line is impossible to hit with a thumb, so the padding
                // is the touch target and the line inside it is the visual.
                style={{ flex: 1, padding: '14px 0', cursor: 'pointer', touchAction: 'none' }}
            >
                <div style={{ height: 3, borderRadius: 3, background: 'var(--line-strong)', overflow: 'hidden' }}>
                    <div ref={fillRef} style={{ width: '0%', height: '100%', borderRadius: 3, background: 'var(--accent-2, #00E5FF)' }} />
                </div>
            </div>
            <span ref={timeRef} style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)', minWidth: 34, textAlign: 'right' }}>0:00</span>
        </div>
    );
}

function ResultStep({ onShare }) {
    const { t } = useTranslation('editor');
    const close = useMobileFlowStore(s => s.close);
    const toChange = useMobileFlowStore(s => s.toChange);
    const outcomeId = useMobileFlowStore(s => s.outcomeId);
    const error = useMobileFlowStore(s => s.error);
    const duration = useTimelineStore(s => s.duration);
    const aspect = useTimelineStore(s => s.aspectRatio);
    const toVersions = useMobileFlowStore(s => s.toVersions);
    const versionCount = useVersionsStore(s => s.versions.length);

    const isPlaying = useTimelineStore(s => s.isPlaying);

    // The sheet's height varies with its content, so the tappable video area is
    // measured rather than guessed: a fixed percentage would either swallow the
    // top of the sheet or leave a dead strip above it.
    const sheetRef = useRef(null);
    const [sheetH, setSheetH] = React.useState(0);
    React.useEffect(() => {
        const el = sheetRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setSheetH(entry.contentRect.height));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Leaving the result with the short still talking is not what anyone means
    // by "change something", so playback stops when this screen goes away.
    React.useEffect(() => () => {
        const st = useTimelineStore.getState();
        if (st.isPlaying) st.setIsPlaying(false);
    }, []);

    const outcome = OUTCOME_BY_ID[outcomeId];
    const chip = {
        fontFamily: 'var(--f-mono)', fontSize: 11.5, padding: '6px 11px', borderRadius: 999,
        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg-2)',
    };
    const btn = {
        flex: 1, minHeight: 50, borderRadius: 999, cursor: 'pointer',
        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
        fontSize: 14.5, fontWeight: 600, fontFamily: 'var(--f-sans)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: Z, pointerEvents: 'none' }}>
            {/* Tap the short to play or pause it. Covers the visible video and
                stops short of the sheet, so the buttons below still work. It is
                also what keeps a tap from reaching the editor underneath and
                selecting a clip. */}
            <button
                type="button"
                onClick={togglePreview}
                aria-label={isPlaying ? t('mobileFlow.pause', 'Pause') : t('mobileFlow.play', 'Play')}
                style={{
                    pointerEvents: 'auto', position: 'absolute', top: 0, left: 0, right: 0,
                    bottom: sheetH, border: 0, background: 'transparent', padding: 0,
                    cursor: 'pointer', display: 'grid', placeItems: 'center',
                }}
            >
                {/* Shown while paused, the way every short does it. While it
                    plays, nothing sits on top of the picture. */}
                <span
                    aria-hidden="true"
                    style={{
                        width: 62, height: 62, borderRadius: 999, display: 'grid', placeItems: 'center',
                        background: 'rgba(5,7,11,.56)', border: '1px solid rgba(255,255,255,.22)',
                        backdropFilter: 'blur(10px)', color: 'white',
                        opacity: isPlaying ? 0 : 1,
                        transform: isPlaying ? 'scale(.86)' : 'scale(1)',
                        transition: 'opacity .18s ease, transform .18s ease',
                    }}
                >
                    {isPlaying ? <Pause size={24} /> : <Play size={24} style={{ marginLeft: 3 }} />}
                </span>
            </button>

            <button type="button" onClick={close} aria-label={t('mobileFlow.back', 'Back')} style={{ pointerEvents: 'auto', position: 'absolute', top: 'calc(14px + env(safe-area-inset-top))', left: 14, width: 42, height: 42, display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,.18)', borderRadius: 999, background: 'rgba(5,7,11,.72)', color: 'white', backdropFilter: 'blur(10px)' }}><ArrowLeft size={19} /></button>
            <span style={{ position: 'absolute', top: 'calc(18px + env(safe-area-inset-top))', right: 14, padding: '8px 12px', borderRadius: 99, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(5,7,11,.72)', color: 'white', fontFamily: 'var(--f-mono)', fontSize: 11, pointerEvents: 'none' }}>{fmt(duration)}</span>
            <div ref={sheetRef} style={{ ...panel, pointerEvents: 'auto', zIndex: Z + 1, maxHeight: '53dvh', overflowY: 'auto', borderRadius: '20px 20px 0 0', paddingBottom: 'calc(22px + env(safe-area-inset-bottom))' }} role="region" aria-label={t('mobileFlow.resultTitle', 'Your short')}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--line-strong)', margin: '-8px auto 12px' }} />

            <Scrubber />

            {error && (
                <p role="alert" style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--coral)' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {outcome && <span style={chip}>{t(`mobileFlow.outcome.${outcome.id}`, outcome.id)}</span>}
                <span style={chip}>{fmt(duration)}</span>
                <span style={chip}>{aspect || '9:16'}</span>
            </div>

            <button type="button" onClick={onShare} style={{ width: '100%', minHeight: 54, marginBottom: 11, borderRadius: 999, cursor: 'pointer', background: '#f7f8fb', color: '#080a0e', border: 'none', fontSize: 16, fontWeight: 700, fontFamily: 'var(--f-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Share2 size={17} /> {t('mobileFlow.share', 'Share it')}
            </button>

            <div style={{ display: 'flex', gap: 10, marginBottom: versionCount > 1 ? 10 : 0 }}>
                <button type="button" onClick={toChange} style={btn}><Sparkles size={15} />{t('mobileFlow.change', 'Change something')}</button>
                <button type="button" onClick={close} style={btn}><SlidersHorizontal size={15} />{t('mobileFlow.byHand', 'Edit by hand')}</button>
            </div>

            {versionCount > 1 && (
                <button
                    type="button"
                    onClick={toVersions}
                    style={{ ...btn, width: '100%', marginTop: 0, minHeight: 46, fontSize: 14, borderRadius: 14, background: 'linear-gradient(110deg,rgba(0,190,205,.08),rgba(122,42,190,.12))', borderColor: 'rgba(0,190,205,.38)' }}
                >
                    <History size={16} />
                    {t('mobileFlow.versionsCount', { count: versionCount, defaultValue: '{{count}} versions' })}
                </button>
            )}

            </div>
        </div>
    );
}

/* ── Change something ─────────────────────────────────────────────────────── */

/* Each chip and typed request goes through the normal edit pipeline. Sending
   from this guided change screen authorizes Roka to apply that requested edit,
   so the mobile flow does not wait for an approval sheet hidden underneath. */
const CHANGES = [
    { id: 'shorter', prompt: 'make it shorter', icon: Minus },
    { id: 'punchier', prompt: 'make it punchier', icon: Zap },
    { id: 'captions', prompt: 'make the captions bigger', icon: Type },
    { id: 'moment', prompt: 'use a different moment', icon: MessageCircle },
    { id: 'music', prompt: 'add music', icon: Music2 },
    { id: 'slower', prompt: 'slow it down', icon: Clock },
];

function ChangeStep() {
    const { t } = useTranslation('editor');
    const toResult = useMobileFlowStore(s => s.toResult);
    const toOutcome = useMobileFlowStore(s => s.toOutcome);
    const choose = useMobileFlowStore(s => s.choose);
    const outcomeId = useMobileFlowStore(s => s.outcomeId);
    const describeOnly = useMobileFlowStore(s => s.changeMode) === 'describe';
    // Describe mode is entered from the first screen, so back goes there. Going
    // 'back' to a result that does not exist yet leaves an empty screen.
    const back = describeOnly ? toOutcome : toResult;
    const [typed, setTyped] = React.useState('');
    const refinementInFlight = React.useRef(false);
    const beginProgress = useMobileFlowStore(s => s.beginProgress);
    const updateProgress = useMobileFlowStore(s => s.updateProgress);

    const run = (prompt, label) => {
        const text = String(prompt || '').trim();
        if (!text || refinementInFlight.current) return;
        refinementInFlight.current = true;
        const checkpoint = useVersionsStore.getState().checkpoint();
        trackEvent('mobile_short_refinement_started', { has_prompt: true });
        // Back to the working screen so the change is narrated like the first run.
        choose(outcomeId, text);
        beginProgress([{ label: t('mobileFlow.applyingChange', 'Apply your change') }]);
        updateProgress(0, 'running');
        // Let EditJobManager's mobile plan gate ask for confirmation on
        // destructive or high impact changes. Additive refinements still run
        // immediately, as defined by planFirst.js.
        editJobManager.processEditRequest(text)
            .then((result) => {
                if (!result?.success) throw new Error(result?.message || t('mobileFlow.changeFailed', 'The change could not be applied.'));
                if (['chat', 'query_session_summary'].includes(result.operation)) {
                    throw new Error(t('mobileFlow.changeNotApplied', 'Roka did not apply an edit. Try describing the change you want to make.'));
                }
                updateProgress(0, 'done', result.message || null);
                useVersionsStore.getState().capture(label || text);
                refinementInFlight.current = false;
                useMobileFlowStore.getState().finished();
            })
            .catch((err) => {
                // A plan can contain several commands. If one fails after an
                // earlier command already changed the timeline, restore the
                // exact pre-request state instead of leaving a partial edit.
                try {
                    useVersionsStore.getState().restoreCheckpoint(checkpoint);
                } catch (rollbackError) {
                    console.error('[MobileFlow] Could not restore failed refinement checkpoint:', rollbackError);
                }
                refinementInFlight.current = false;
                updateProgress(0, 'failed', err?.message || null);
                useMobileFlowStore.getState().failed(err?.message);
            });
    };

    const chip = {
        minHeight: 76, padding: '12px 14px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
        fontSize: 14, fontWeight: 600, fontFamily: 'var(--f-sans)', display: 'flex', alignItems: 'center', gap: 12,
    };

    return (
        <>
        <button type="button" tabIndex={-1} aria-label={t('mobileFlow.back', 'Back')} onClick={back} style={{ position: 'fixed', inset: 0, zIndex: Z, border: 0, background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(3px)' }} />
        <div style={{ ...panel, zIndex: Z + 1, bottom: 0, maxHeight: '100dvh', overflowY: 'auto', paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }} role="region" aria-label={describeOnly ? t('mobileFlow.describeTitle', 'Describe your idea') : t('mobileFlow.change', 'Change something')}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--line-strong)', margin: '-8px auto 18px' }} />

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 23, fontWeight: 750, letterSpacing: '-.03em' }}>{describeOnly ? t('mobileFlow.describeTitle', 'Describe your idea') : t('mobileFlow.change', 'Change something')}</h2>
                <button type="button" onClick={back} style={{ minHeight: 44, padding: '0 10px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14, cursor: 'pointer' }}>
                    {t('mobileFlow.back', 'Back')}
                </button>
            </div>

            <p style={{ margin: '-8px 0 18px', color: 'var(--fg-2)', fontSize: 13.5 }}>{describeOnly
                ? t('mobileFlow.describeSubtitle', 'Say what you want in your own words. Roka makes it.')
                : t('mobileFlow.changeSubtitle', 'Tap one. It redoes the edit and keeps everything else.')}</p>

            {!describeOnly && (<>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
                    {CHANGES.map(c => (
                        <button key={c.id} type="button" onClick={() => run(c.prompt, t(`mobileFlow.changes.${c.id}`, c.prompt))} style={chip}>
                            <c.icon size={17} color="#71e6ed" /> {t(`mobileFlow.changes.${c.id}`, c.prompt)}
                        </button>
                    ))}
                </div>

                <label htmlFor="flow-ask" style={{ display: 'block', fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.14em', color: 'var(--fg-3)', marginBottom: 9 }}>
                    {t('mobileFlow.orSay', 'OR SAY IT IN YOUR OWN WORDS')}
                </label>
            </>)}
            <form
                onSubmit={(e) => { e.preventDefault(); run(typed); setTyped(''); }}
                style={{ display: 'flex', gap: 9, alignItems: 'center' }}
            >
                <input
                    id="flow-ask"
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoFocus={describeOnly}
                    placeholder={describeOnly
                        ? t('mobileFlow.describePlaceholder', 'A punchy 30s reel from my clip')
                        : t('mobileFlow.askPlaceholder', 'Keep only the part about pricing')}
                    style={{
                        flex: 1, minWidth: 0, minHeight: 48, padding: '0 16px', borderRadius: 999,
                        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
                        // The design draws this at 14.5px. iOS Safari zooms the whole
                        // page on focus for any field under 16px, which on a phone is
                        // a worse trade than half a pixel of type.
                        fontSize: 16, fontFamily: 'var(--f-sans)', outline: 'none',
                    }}
                />
                <button
                    type="submit"
                    disabled={!typed.trim()}
                    aria-label={t('mobileFlow.send', 'Send')}
                    style={{
                        width: 48, height: 48, flex: 'none', borderRadius: 999, cursor: 'pointer',
                        background: 'var(--fg)', color: 'var(--bg)', border: 'none',
                        opacity: typed.trim() ? 1 : 0.4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >
                        <ArrowRight size={18} />
                </button>
            </form>
            <p style={{ margin: '16px 0 0', textAlign: 'center', fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>{t('mobileFlow.changeCost', 'Each change uses one AI edit')}</p>
        </div>
        </>
    );
}


/* ── Your versions ────────────────────────────────────────────────────────── */

/* Every finished run left one. Going back is a normal undoable step, not a
   trapdoor: projectVersions.restore pushes the state being left onto the undo
   stack first. */
function VersionsStep() {
    const { t } = useTranslation('editor');
    const toResult = useMobileFlowStore(s => s.toResult);
    const toChange = useMobileFlowStore(s => s.toChange);
    const versions = useVersionsStore(s => s.versions);
    const currentId = useVersionsStore(s => s.currentId);
    const restore = useVersionsStore(s => s.restore);
    const returnToEditor = useMobileFlowStore(s => s.returnToEditor);
    const close = useMobileFlowStore(s => s.close);
    const projectName = useTimelineStore(s => s.projectName);
    const assets = useTimelineStore(s => s.assets) || [];
    const thumb = assets.find(a => a.thumbnailUrl || a.thumbnail_url)?.thumbnailUrl || assets.find(a => a.thumbnailUrl || a.thumbnail_url)?.thumbnail_url;

    // "just now" and "3 min ago" were read straight off Date.now() while
    // rendering, so the label changed whenever React happened to re-render and
    // never changed when it did not. Read once when the list opens instead.
    // Deliberately not a ticking timer: this screen is looked at for a few
    // seconds, and MobileFlow must stay free of intervals so the guard against
    // a faked progress bar on the working screen can keep being a simple one.
    const [now] = React.useState(() => Date.now());
    const ageLabel = (createdAt) => {
        if (!createdAt) return '';
        const elapsed = now - createdAt;
        return elapsed < 60_000
            ? t('mobileFlow.justNow', 'just now')
            : t('mobileFlow.minutesAgo', { count: Math.max(1, Math.floor(elapsed / 60_000)), defaultValue: '{{count}} min ago' });
    };

    const row = (isCurrent) => ({
        display: 'flex', alignItems: 'center', gap: 13, padding: '12px 13px', borderRadius: 14,
        background: isCurrent ? 'rgba(0,205,220,.10)' : 'var(--glass)',
        border: `1px solid ${isCurrent ? 'rgba(0,205,220,.7)' : 'var(--line)'}`,
    });

    return (
        <div style={{ ...sheet, padding: 'max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))', background: 'radial-gradient(90% 40% at 100% 100%,rgba(112,35,170,.15),transparent 75%),radial-gradient(90% 40% at 0% 0%,rgba(0,190,205,.08),transparent 75%),var(--bg)' }} role="region" aria-label={t('mobileFlow.versions', 'Your versions')}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, marginBottom: 18 }}>
                <button type="button" onClick={returnToEditor ? close : toResult} aria-label={returnToEditor ? t('mobileFlow.editTimeline', 'Edit on timeline') : t('mobileFlow.back', 'Back')} style={{ display: 'grid', placeItems: 'center', width: 34, height: 40, padding: 0, border: 0, background: 'transparent', color: 'var(--fg-2)' }}><ArrowLeft size={19} /></button>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.16em', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName || t('mobileFlow.newShortEyebrow', 'NEW SHORT')}</span>
            </header>
            <h1 style={{ margin: '0 0 7px', fontSize: 28, lineHeight: 1.12, letterSpacing: '-.04em', fontWeight: 750 }}>{t('mobileFlow.versions', 'Your versions')}</h1>
            <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.45, color: 'var(--fg-2)' }}>{t('mobileFlow.versionsBody', 'Every change makes a new one. Go back to any of them.')}</p>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {versions.map(v => {
                    const isCurrent = v.id === currentId;
                    return (
                        <li key={v.id} style={{ ...row(isCurrent), minHeight: 92, padding: '10px 12px', borderRadius: 16, background: isCurrent ? 'rgba(0,205,220,.08)' : 'linear-gradient(100deg,var(--glass),rgba(112,35,170,.035))' }}>
                            <span style={{ width: 55, height: 70, flex: 'none', overflow: 'hidden', borderRadius: 10, display: 'grid', placeItems: 'center', background: '#111820', color: '#72e5ec' }}>{thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Film size={21} />}</span>
                            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--fg)' }}>{v.label}</span>
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)' }}>
                                    {fmt(v.duration)} · {ageLabel(v.createdAt)}
                                </span>
                            </span>
                            {isCurrent ? (
                                <span style={{ padding: '6px 9px', borderRadius: 99, background: '#08d7e7', color: '#031014', fontFamily: 'var(--f-mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em' }}>
                                    {t('mobileFlow.now', 'NOW')}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { restore(v.id); toResult(); }}
                                    style={{
                                        flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 999, cursor: 'pointer',
                                        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
                                        fontSize: 12.5, fontWeight: 650, fontFamily: 'var(--f-sans)',
                                        display: 'flex', alignItems: 'center', gap: 7,
                                    }}
                                >
                                    {t('mobileFlow.goBack', 'Go back')}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            <button type="button" onClick={toChange} style={{ width: '100%', minHeight: 54, marginTop: 14, border: 0, borderRadius: 999, background: '#f7f8fb', color: '#080a0e', fontSize: 15.5, fontWeight: 700, fontFamily: 'var(--f-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Sparkles size={16} /> {t('mobileFlow.tryAnotherChange', 'Try another change')}</button>
            <p style={{ margin: '12px 0 0', fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--fg-3)', textAlign: 'center' }}>
                {t('mobileFlow.versionsFree', 'Going back is free. Only a new edit costs one.')}
            </p>
        </div>
    );
}

/* ── Out of free Auto edits ───────────────────────────────────────────────── */

/* Deliberately not a hand-rolled screen. PlanSheet is already the mobile
   plan-limit sheet, already wired to the same Polar checkout the pricing page
   uses, and already shows the target plan's real price and features. A second
   upgrade surface would drift from it within a release. It rides on
   MobileSheet (z 60/61), so it sits above the flow and whatever the user
   already had stays behind it.

   What is behind it is chosen by whether anything exists to go back to: a
   saved version means a real short, so the result screen; nothing means the
   run was refused before it made anything, so the question. */
function LimitStep({ onShare }) {
    const limitInfo = useMobileFlowStore(s => s.limitInfo);
    const toResult = useMobileFlowStore(s => s.toResult);
    const close = useMobileFlowStore(s => s.close);
    const hasSomething = useVersionsStore(s => s.versions.length) > 0;

    return (
        <>
            {hasSomething ? <ResultStep onShare={onShare} /> : <OutcomeStep />}
            <PlanSheet
                open
                reason={limitInfo?.reason || 'ai_ops'}
                upgradeTo={limitInfo?.upgradeRequired || 'creator'}
                onClose={() => (hasSomething ? toResult() : close())}
            />
        </>
    );
}

/* ── The flow ─────────────────────────────────────────────────────────────── */

export default function MobileFlow({ onShare }) {
    const active = useMobileFlowStore(s => s.active);
    const step = useMobileFlowStore(s => s.step);
    const limited = useMobileFlowStore(s => s.limited);

    // A 402 from the usage gate arrives on the shared QUOTA_EXCEEDED channel,
    // the same one the editor listens to. While the flow is open the refusal
    // becomes a step of the flow rather than a sheet thrown over it, and
    // IDELayout stands down so there is one prompt and not two. R148.
    React.useEffect(() => {
        if (!active) return undefined;
        return EventBus.on(EVENT_TYPES.QUOTA_EXCEEDED, (payload) => limited(payload || {}));
    }, [active, limited]);

    if (!active) return null;
    if (step === 'outcome') return <OutcomeStep />;
    if (step === 'working') return <WorkingStep />;
    if (step === 'change') return <ChangeStep />;
    if (step === 'versions') return <VersionsStep />;
    if (step === 'limit') return <LimitStep onShare={onShare} />;
    return <ResultStep onShare={() => {
        trackEvent('mobile_short_share_started');
        onShare?.();
    }} />;
}
