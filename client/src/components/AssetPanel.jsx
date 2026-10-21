/**
 * client/src/components/AssetPanel.jsx
 *
 * Creative Asset Intelligence Panel.
 * Tabs: SFX | Color (LUTs) | Presets
 *
 * - Search via the audio engine API (three-pass: taxonomy + embedding + context)
 * - LUT preview rendered as CSS filter — NEVER FFmpeg in the editor
 * - FULL_EDIT presets route through PresetApprovalModal
 * - SFX → added to audio track via useTimelineStore
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Music2, Palette, Layers, Loader2, RefreshCw, Upload, Film, Sparkles, Lock } from 'lucide-react';
import { useAudioEngine }        from '../hooks/useAudioEngine.js';
import useTimelineStore          from '../store/useTimelineStore.js';
import { audioEngineAPI }        from '../audio-engine/AudioEngineAPI.js';
import { stockMediaApi }          from '../services/stockMediaApi.js';
import { lutToGrading }          from '../utils/lutGrading.js';
import { useUserPlan }           from '../hooks/useUserPlan.js';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';
import SoundCard                 from './SoundCard.jsx';
import LUTCard                   from './LUTCard.jsx';
import PresetCard                from './PresetCard.jsx';
import StockCard                 from './StockCard.jsx';
import BrollSuggestionCard       from './BrollSuggestionCard.jsx';
import PresetApprovalModal       from './PresetApprovalModal.jsx';

const TABS = [
    { key: 'sfx',     labelKey: 'assetPanel.tabSfx',     icon: Music2  },
    { key: 'luts',    labelKey: 'assetPanel.tabColor',   icon: Palette },
    { key: 'presets', labelKey: 'assetPanel.tabPresets', icon: Layers  },
    { key: 'stock',   labelKey: 'assetPanel.tabStock',   icon: Film, isPaid: true },
];

const PANEL = {
    width:      '100%',
    background: 'rgba(10,10,14,0.97)',
    border:     '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    display:    'flex',
    flexDirection: 'column',
    fontFamily: 'var(--f-sans)',
    overflow:   'hidden',
    height:     '100%',
};

export default function AssetPanel({ onClose, initialTab = 'sfx' }) {
    const { t } = useTranslation('editor');
    const { plan: userPlan } = useUserPlan();
    const isFree = userPlan === 'free';
    const [tab,          setTab]          = useState(initialTab);

    useEffect(() => {
        if (initialTab) setTab(initialTab);
    }, [initialTab]);
    const [query,        setQuery]        = useState('');
    const [approvalPreset, setApprovalPreset] = useState(null);
    const [applyResult,  setApplyResult]  = useState(null); // { success, executed }
    const [favoriteAssetIds, setFavoriteAssetIds] = useState(() => new Set());

    // Stock Media state
    const [stockResults,   setStockResults]   = useState([]);
    const [stockLoading,   setStockLoading]   = useState(false);
    const [stockError,     setStockError]     = useState(null);
    const [stockMediaType, setStockMediaType] = useState('video'); // 'video' | 'photo'

    // Context-Aware B-Roll Suggestions state (Level 2)
    const [brollSuggestions,   setBrollSuggestions]   = useState([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);
    const [suggestionsError,   setSuggestionsError]   = useState(null);
    const [stockViewMode,      setStockViewMode]      = useState('search'); // 'search' | 'suggestions'

    const projectLUTId = useTimelineStore(s => s.projectLUTId);
    const projectAssets = useTimelineStore(s => s.assets) || [];
    const captions = useTimelineStore(s => s.captions) || [];
    const binAssetIds = new Set(projectAssets.map(a => a.id));

    // Load favorited SFX/asset ids once — used to render the heart toggle on SoundCard
    useEffect(() => {
        let cancelled = false;
        audioEngineAPI.getFavorites()
            .then(({ assetIds }) => { if (!cancelled) setFavoriteAssetIds(new Set(assetIds || [])); })
            .catch(err => console.error('[AssetPanel] getFavorites failed:', err.message));
        return () => { cancelled = true; };
    }, []);

    // Toggle favorite for an SFX asset — optimistic update, rolls back on failure
    const handleToggleSFXFavorite = useCallback(async sfx => {
        const assetId = sfx.id;
        if (!assetId) return;
        const wasFavorited = favoriteAssetIds.has(assetId);

        setFavoriteAssetIds(prev => {
            const next = new Set(prev);
            if (wasFavorited) next.delete(assetId); else next.add(assetId);
            return next;
        });

        try {
            if (wasFavorited) {
                await audioEngineAPI.removeFavorite({ assetId });
            } else {
                await audioEngineAPI.addFavorite({ assetId });
            }
        } catch (err) {
            console.error('[AssetPanel] toggleFavorite failed:', err.message);
            // Roll back on failure
            setFavoriteAssetIds(prev => {
                const next = new Set(prev);
                if (wasFavorited) next.add(assetId); else next.delete(assetId);
                return next;
            });
        }
    }, [favoriteAssetIds]);

    const {
        sfxResults, lutResults, presetResults,
        loading, error,
        searchSFX, searchLUTs, searchPresets,
        applyLUT, clearLUT,
        applyPreset,
    } = useAudioEngine();

    const [stockProvider, setStockProvider] = useState('vecteezy');

    // Search stock media
    const searchStock = useCallback(async (q, mediaType = stockMediaType) => {
        if (isFree) {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                message: t('assetPanel.stockLockedMessage', 'Stock media is available on Creator and Pro plans.'),
                upgradeRequired: 'creator',
            });
            return;
        }
        setStockLoading(true);
        setStockError(null);
        try {
            const data = await stockMediaApi.search({
                query: q || 'nature',
                type: mediaType,
                perPage: 20,
            });
            if (data.provider) setStockProvider(data.provider);
            setStockResults(data.results || []);
        } catch (err) {
            console.error('[AssetPanel] Stock search failed:', err.message);
            setStockError(err.message || 'Failed to search stock media');
            setStockResults([]);
        } finally {
            setStockLoading(false);
        }
    }, [stockMediaType, isFree, t]);

    // Load defaults on tab change
    useEffect(() => {
        if (tab === 'sfx'     && sfxResults.length === 0)     searchSFX('');
        if (tab === 'luts'    && lutResults.length === 0)     searchLUTs('');
        if (tab === 'presets' && presetResults.length === 0)  searchPresets();
        if (tab === 'stock'   && stockResults.length === 0 && !isFree)   searchStock(query || 'landscape');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, isFree]);

    // ── Custom .cube LUT import ───────────────────────────────────────────────
    const [lutUploading,   setLutUploading]   = useState(false);
    const [lutUploadError, setLutUploadError] = useState(null);

    const handleLutUpload = useCallback(async (e) => {
        const file = e.target.files?.[0];
        // Reset the input immediately so re-selecting the SAME file still fires
        // a change event (the browser suppresses it otherwise, which reads as
        // "the import silently did nothing" after a failed first attempt).
        e.target.value = '';
        if (!file) return;

        setLutUploadError(null);
        setLutUploading(true);
        try {
            await audioEngineAPI.uploadLUT(file);
            // Refresh so the new LUT appears in the grid straight away.
            await searchLUTs(query || '');
        } catch (err) {
            console.error('[AssetPanel] LUT upload failed:', err.message);
            setLutUploadError(err.message);
        } finally {
            setLutUploading(false);
        }
    }, [searchLUTs, query]);

    const handleSearch = useCallback(e => {
        e.preventDefault();
        if (tab === 'sfx')     searchSFX(query);
        if (tab === 'luts')    searchLUTs(query);
        if (tab === 'presets') searchPresets(null, 20);
        if (tab === 'stock')   searchStock(query);
    }, [tab, query, searchSFX, searchLUTs, searchPresets, searchStock]);

    // Stock action handlers
    const handleStockAddToTimeline = useCallback(item => {
        const store = useTimelineStore.getState();
        const exists = (store.assets || []).some(a => a.id === item.id);
        if (!exists) {
            store.addAssets?.([item]);
        }
        store.addAssetToTimeline?.(item);
    }, []);

    const handleStockAddToBin = useCallback(item => {
        const store = useTimelineStore.getState();
        const exists = (store.assets || []).some(a => a.id === item.id);
        if (!exists) {
            store.addAssets?.([item]);
        }
    }, []);

    const handleStockAddAsOverlay = useCallback(item => {
        const store = useTimelineStore.getState();
        const exists = (store.assets || []).some(a => a.id === item.id);
        if (!exists) {
            store.addAssets?.([item]);
        }
        store.addOverlayClip?.(item, {
            scale: 4,
            x: 50,
            y: 50,
            duration: item.duration || 4,
            kind: item.type === 'video' ? 'video' : 'image',
        });
    }, []);

    // Level 2: Context-Aware B-Roll suggestion handlers
    const handleGenerateBrollSuggestions = useCallback(async () => {
        if (isFree) {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                message: t('assetPanel.stockLockedMessage', 'Stock media is available on Creator and Pro plans.'),
                upgradeRequired: 'creator',
            });
            return;
        }
        const store = useTimelineStore.getState();
        const words = store.captions || [];
        if (!Array.isArray(words) || words.length === 0) {
            setSuggestionsError('No transcript available. Please transcribe your video first to generate context-aware B-roll.');
            setStockViewMode('suggestions');
            return;
        }

        setSuggestionsLoading(true);
        setSuggestionsError(null);
        setStockViewMode('suggestions');

        try {
            const data = await stockMediaApi.suggestBroll({ words, maxSuggestions: 6 });
            setBrollSuggestions(data.suggestions || []);
            if (!data.suggestions || data.suggestions.length === 0) {
                setSuggestionsError('No strong visual moments found to illustrate in this transcript.');
            }
        } catch (err) {
            console.error('[AssetPanel] Suggest B-roll failed:', err.message);
            setSuggestionsError(err.message || 'Failed to generate B-roll suggestions.');
            setBrollSuggestions([]);
        } finally {
            setSuggestionsLoading(false);
        }
    }, [isFree, t]);

    const handleApproveBrollSuggestion = useCallback((suggestion, asset) => {
        const store = useTimelineStore.getState();
        const exists = (store.assets || []).some(a => a.id === asset.id);
        if (!exists) {
            store.addAssets?.([asset]);
        }
        store.addOverlayClip?.(asset, {
            scale: 4,
            x: 50,
            y: 50,
            start: suggestion.timelineTime,
            duration: suggestion.duration || asset.duration || 3.5,
            kind: 'video',
            transitions: suggestion.transitions,
            behindSubject: suggestion.behindSubject || (suggestion.speakerLayout === 'behind_speaker'),
        });
        // Remove approved suggestion from pending list
        setBrollSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    }, []);

    const handleRejectBrollSuggestion = useCallback((id) => {
        setBrollSuggestions(prev => prev.filter(s => s.id !== id));
    }, []);

    const handleReplaceBrollSuggestion = useCallback((suggestion) => {
        if (suggestion.query) {
            setQuery(suggestion.query);
            setStockViewMode('search');
            searchStock(suggestion.query, 'video');
        }
    }, [searchStock]);

    // SFX → add to audio track
    const handleAddSFX = useCallback(sfx => {
        const state = useTimelineStore.getState();

        // A sound effect with no playable URL cannot become a clip. The old code
        // fell back to `sfx.id` — not a URL at all — which produced a clip
        // pointing at nothing. Refuse loudly instead of adding a dead clip.
        const src = sfx.preview_url || sfx.asset_url || sfx.file_url || null;
        if (!src) {
            console.warn(`[AssetPanel] SFX "${sfx.display_name || sfx.name || sfx.id}" has no playable URL — not adding.`);
            return;
        }

        // CREATE the audio track when there isn't one.
        //
        // This used to be `if (!audioTrack) return;` — a silent no-op. Projects
        // do not start with an audio track, so on most projects clicking a sound
        // effect did literally nothing, with no error and no feedback: the exact
        // "looks complete in the UI, does nothing underneath" pattern this
        // codebase keeps hitting (R33/R37/R46/R52).
        let audioTrack = state.tracks?.find(t => t.type === 'audio');
        if (!audioTrack) {
            const newId = state.addTrack?.('audio');
            audioTrack = useTimelineStore.getState().tracks?.find(
                t => t.id === newId || t.type === 'audio'
            );
            if (!audioTrack) {
                console.error('[AssetPanel] Could not create an audio track for the SFX.');
                return;
            }
        }

        // Use the sound's REAL length. The hardcoded 2s made every effect the
        // same size on the timeline regardless of what it actually is — a 0.3s
        // whoosh and a 6s riser both became 2s, so the clip never matched the
        // audio the user just previewed.
        const duration = Number(sfx.duration) > 0 ? Number(sfx.duration) : 2;

        const atTime = state.playheadTime ?? state.currentTime ?? 0;

        state.addClip?.(audioTrack.id, {
            id:       `sfx_${Date.now()}`,
            type:     'audio',
            src,
            url:      src,          // some consumers read `url`, others `src`
            assetId:  sfx.id,
            start:    atTime,
            duration,
            // The library ships a per-sound recommended level; fall back to 0.8.
            volume:   Number(sfx.recommended_volume) > 0 ? Number(sfx.recommended_volume) : 0.8,
            name:     sfx.display_name || sfx.name || 'SFX',
            isSFX:    true,
        });
    }, []);

    // LUT toggle
    /**
     * Convert a LUT's stored parameters into the `clip.grading` shape the
     * playback engine already consumes.
     *
     * WHY THIS EXISTS: applying a LUT only set `projectLUTId` + a CSS filter.
     * Nothing in the app has ever written `clip.grading` — yet VideoPlayer reads
     * it every frame and pushes it into the engine's brightness/contrast/
     * saturation/hue uniforms. That is the live, proven grading path, and it was
     * sitting unused while the LUT tried to grade via a canvas CSS filter.
     *
     * setGrading() takes PERCENTAGES (it divides by 100); the LUT columns are on
     * a -3..+3 scale. The 1 + x/10 mapping is the editor's own
     * (LUTCard.buildColorPresetSettings), so the numbers here agree with the CSS
     * preview and with the FFmpeg export filter (R55b) by construction.
     *
     * R75: extracted to client/src/utils/lutGrading.js so VideoEditorTools.js's
     * AI-executable applyLUT() computes the identical grade instead of a
     * separate, out-of-sync formula (it previously only set the CSS-filter
     * preview and never wrote real per-clip grading at all).
     */
    const handleLUTApply = useCallback(async lut => {
        const store   = useTimelineStore.getState();
        const clearing = projectLUTId === lut.id;

        // Write the grade onto every video clip, so it is visible on the
        // timeline immediately and survives as normal clip state the user can
        // later edit per clip — the same mechanism the engine already uses.
        //
        // SKIP any clip the user has since hand-tuned in the Colour panel
        // (`grading._manuallyAdjusted`, set by handleGradingChange /
        // handleSelectiveGradingChange in IDELayout.jsx). Without this, simply
        // re-clicking the SAME LUT to toggle it off — or picking a DIFFERENT
        // one — silently overwrote every per-clip tweak project-wide. That
        // defeats the entire point of making the grade editable per clip: an
        // edit a user can lose by touching an unrelated button isn't a real
        // per-clip edit.
        const grading = clearing ? null : lutToGrading(lut);
        let skipped = 0;
        for (const track of (store.tracks || [])) {
            if (track.type !== 'video') continue;
            for (const clip of (track.clips || [])) {
                if (clip.grading?._manuallyAdjusted) { skipped++; continue; }
                store.updateClip?.(track.id, clip.id, { grading });
            }
        }
        if (skipped > 0) {
            console.log(`[AssetPanel] handleLUTApply: left ${skipped} manually-graded clip(s) untouched`);
        }

        // Keep the project-level id/CSS filter too: the id is what the EXPORT
        // reads (R55/R55b), and the CSS filter still grades the canvas.
        if (clearing) clearLUT();
        else          await applyLUT(lut.id);
    }, [projectLUTId, applyLUT, clearLUT, lutToGrading]);

    // Preset apply
    const handlePresetApply = useCallback(async (preset, approved) => {
        try {
            const result = await applyPreset(preset.id, { approved });
            setApplyResult(result);
            setTimeout(() => setApplyResult(null), 4000);
        } catch (e) {
            console.error('[AssetPanel] applyPreset error:', e.message);
        }
    }, [applyPreset]);

    const handleFullEditApproved = useCallback(() => {
        if (!approvalPreset) return;
        handlePresetApply(approvalPreset, true);
        setApprovalPreset(null);
    }, [approvalPreset, handlePresetApply]);

    return (
        <>
            <div style={PANEL}>
                {/* Top accent bar */}
                <div style={{ height: '0.5px', background: 'linear-gradient(90deg, var(--accent), var(--violet))' }} />

                {/* Header */}
                <div style={{ padding: '10px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.01em' }}>{t('assetPanel.assets')}</span>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 2, padding: '8px 14px 0', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
                    {TABS.map(tabItem => {
                        const Icon    = tabItem.icon;
                        const active  = tab === tabItem.key;
                        const isLocked = tabItem.isPaid && isFree;
                        return (
                            <button
                                key={tabItem.key}
                                onClick={() => {
                                    setTab(tabItem.key);
                                    if (isLocked) {
                                        EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                                            reason: 'paid_feature',
                                            message: t('assetPanel.stockLockedMessage', 'Stock media is available on Creator and Pro plans.'),
                                            upgradeRequired: 'creator',
                                        });
                                    }
                                }}
                                style={{
                                    flex:         1,
                                    padding:      '5px 0 7px',
                                    border:       'none',
                                    borderBottom: active ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                                    background:   'none',
                                    color:        active ? 'var(--accent)' : 'var(--fg-3)',
                                    fontSize:     11,
                                    fontWeight:   active ? 700 : 500,
                                    fontFamily:   'var(--f-sans)',
                                    cursor:       'pointer',
                                    display:      'flex',
                                    alignItems:   'center',
                                    justifyContent: 'center',
                                    gap:          4,
                                    transition:   'color 0.15s',
                                }}
                            >
                                <Icon size={11} /> {t(tabItem.labelKey)}
                                {isLocked && <Lock size={9} style={{ color: 'var(--accent)' }} />}
                            </button>
                        );
                    })}
                </div>

                {/* Search bar */}
                {!(tab === 'stock' && isFree) && (
                    <form onSubmit={handleSearch} style={{ padding: '10px 12px 8px', display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1, position: 'relative' }}>
                            <Search size={11} color="var(--fg-3)" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} />
                            <input
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder={
                                    tab === 'sfx'     ? t('assetPanel.searchPlaceholderSfx')   :
                                    tab === 'luts'    ? t('assetPanel.searchPlaceholderLuts')  :
                                    tab === 'stock'   ? t('assetPanel.searchPlaceholderStock') :
                                                       t('assetPanel.searchPlaceholderPresets')
                                }
                                style={{
                                    width:        '100%',
                                    padding:      '5px 8px 5px 26px',
                                    boxSizing:    'border-box',
                                    background:   'rgba(255,255,255,0.05)',
                                    border:       '0.5px solid rgba(255,255,255,0.1)',
                                    borderRadius: 6,
                                    color:        'var(--fg)',
                                    fontSize:     11,
                                    fontFamily:   'var(--f-sans)',
                                    outline:      'none',
                                }}
                            />
                        </div>
                        <button
                            type="submit"
                            style={{
                                padding: '0 10px', border: 'none', borderRadius: 6, cursor: 'pointer',
                                background: 'rgba(0,229,255,0.12)', color: 'var(--accent)',
                            }}
                        >
                            <Search size={12} />
                        </button>
                    </form>
                )}

                {/* Custom .cube LUT import — Color tab only.
                    The server route (POST /api/luts/upload) was already built,
                    mounted and export-integrated; there was simply no way to
                    reach it from the UI, which is why LUT import read as
                    "broken" rather than "missing". */}
                {tab === 'luts' && (
                    <div style={{ padding: '0 12px 8px' }}>
                        <label
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                padding: '6px 10px', borderRadius: 6,
                                border: '0.5px dashed rgba(255,255,255,0.18)',
                                background: 'rgba(255,255,255,0.03)',
                                color: lutUploading ? 'var(--fg-3)' : 'var(--fg-2)',
                                fontSize: 11, fontFamily: 'var(--f-sans)',
                                cursor: lutUploading ? 'default' : 'pointer',
                            }}
                        >
                            {lutUploading
                                ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Upload size={11} />}
                            {lutUploading ? t('assetPanel.lutUploading') : t('assetPanel.lutImport')}
                            <input
                                type="file"
                                accept=".cube"
                                disabled={lutUploading}
                                onChange={handleLutUpload}
                                style={{ display: 'none' }}
                            />
                        </label>
                        {lutUploadError && (
                            <div style={{ marginTop: 5, fontSize: 10, color: '#ff8faa' }}>{lutUploadError}</div>
                        )}
                    </div>
                )}

                {/* Apply result toast */}
                {applyResult && (
                    <div style={{
                        margin: '0 12px 8px',
                        padding: '6px 10px',
                        background: 'rgba(0,229,255,0.1)',
                        border: '0.5px solid rgba(0,229,255,0.25)',
                        borderRadius: 6,
                        fontSize: 11, color: 'var(--accent)',
                    }}>
                        {t('assetPanel.applied')}: {applyResult.executed?.join(', ')}
                        {applyResult.skipped?.length > 0 && ` · ${t('assetPanel.skipped')}: ${applyResult.skipped.join(', ')}`}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div style={{ margin: '0 12px 6px', fontSize: 11, color: '#ff8faa' }}>{error}</div>
                )}

                {/* Results */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                            <Loader2 size={18} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                        </div>
                    ) : (
                        <>
                            {/* SFX tab */}
                            {tab === 'sfx' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                                    {sfxResults.length === 0 && !loading && (
                                        <Empty label={query ? t('assetPanel.noResultsFoundTryDifferentKeyword') : t('assetPanel.searchForSoundEffectAbove')} />
                                    )}
                                    {sfxResults.map((r, i) => {
                                        const sfx = r.asset || r;
                                        return (
                                            <SoundCard
                                                key={sfx.id || i}
                                                sfx={sfx}
                                                onSelect={handleAddSFX}
                                                favorited={favoriteAssetIds.has(sfx.id)}
                                                onToggleFavorite={handleToggleSFXFavorite}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            {/* LUTs tab */}
                            {tab === 'luts' && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 4 }}>
                                    {lutResults.length === 0 && (
                                        <div style={{ gridColumn: '1/-1' }}><Empty label={t('assetPanel.searchForColorStyleAbove')} /></div>
                                    )}
                                    {lutResults.map((r, i) => {
                                        const lut = r.asset || r;
                                        return (
                                            <LUTCard
                                                key={lut.id || i}
                                                lut={lut}
                                                applied={projectLUTId === lut.id}
                                                onApply={handleLUTApply}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            {/* Presets tab */}
                            {tab === 'presets' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                                    {presetResults.length === 0 && (
                                        <Empty label={t('assetPanel.noPresetsFound')} />
                                    )}
                                    {presetResults.map((r, i) => {
                                        const preset = r.asset || r;
                                        return (
                                            <PresetCard
                                                key={preset.id || i}
                                                preset={preset}
                                                onApply={handlePresetApply}
                                                onRequestApproval={p => setApprovalPreset(p)}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            {/* Stock tab */}
                            {tab === 'stock' && (
                                isFree ? (
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        textAlign: 'center',
                                        padding: '40px 20px',
                                        background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
                                        borderRadius: 12,
                                        border: '0.5px solid rgba(255,255,255,0.08)',
                                        margin: '12px 4px',
                                    }}>
                                        <div style={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: '50%',
                                            background: 'color-mix(in oklch, var(--accent) 18%, transparent)',
                                            border: '1px solid color-mix(in oklch, var(--accent) 35%, transparent)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            marginBottom: 12,
                                            color: 'var(--accent)',
                                        }}>
                                            <Lock size={20} />
                                        </div>
                                        <h3 style={{
                                            fontSize: 13,
                                            fontWeight: 700,
                                            color: 'var(--fg)',
                                            marginBottom: 6,
                                            fontFamily: 'var(--f-sans)',
                                        }}>
                                            {t('assetPanel.stockLockedTitle')}
                                        </h3>
                                        <p style={{
                                            fontSize: 11,
                                            color: 'var(--fg-3)',
                                            lineHeight: 1.5,
                                            maxWidth: 260,
                                            marginBottom: 16,
                                            fontFamily: 'var(--f-sans)',
                                        }}>
                                            {t('assetPanel.stockLockedDescription')}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                                                reason: 'paid_feature',
                                                message: t('assetPanel.stockLockedMessage', 'Stock media is available on Creator and Pro plans.'),
                                                upgradeRequired: 'creator',
                                            })}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                padding: '8px 16px',
                                                borderRadius: 8,
                                                background: 'var(--accent)',
                                                color: '#000',
                                                fontSize: 11.5,
                                                fontWeight: 600,
                                                fontFamily: 'var(--f-sans)',
                                                border: 'none',
                                                cursor: 'pointer',
                                                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                                            }}
                                        >
                                            <Sparkles size={12} />
                                            <span>{t('assetPanel.stockLockedCta')}</span>
                                        </button>
                                    </div>
                                ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                                    {/* View Mode Toggle: Search vs AI Suggestions */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 }}>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button
                                                type="button"
                                                onClick={() => setStockViewMode('search')}
                                                style={{
                                                    padding: '3px 8px',
                                                    borderRadius: 4,
                                                    fontSize: 10,
                                                    fontWeight: stockViewMode === 'search' ? 600 : 400,
                                                    background: stockViewMode === 'search' ? 'rgba(0,229,255,0.18)' : 'rgba(255,255,255,0.04)',
                                                    color: stockViewMode === 'search' ? 'var(--accent)' : 'var(--fg-3)',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                Search
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setStockViewMode('suggestions');
                                                    if (brollSuggestions.length === 0 && !suggestionsLoading) {
                                                        handleGenerateBrollSuggestions();
                                                    }
                                                }}
                                                style={{
                                                    padding: '3px 8px',
                                                    borderRadius: 4,
                                                    fontSize: 10,
                                                    fontWeight: stockViewMode === 'suggestions' ? 600 : 400,
                                                    background: stockViewMode === 'suggestions' ? 'rgba(0,229,255,0.18)' : 'rgba(255,255,255,0.04)',
                                                    color: stockViewMode === 'suggestions' ? 'var(--accent)' : 'var(--fg-3)',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 3,
                                                }}
                                            >
                                                <Sparkles size={10} />
                                                <span>AI Suggestions {brollSuggestions.length > 0 ? `(${brollSuggestions.length})` : ''}</span>
                                            </button>
                                        </div>

                                        <div style={{ fontSize: 9.5, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <span>Photos & Videos by</span>
                                            <a
                                                href={stockProvider === 'vecteezy' ? 'https://www.vecteezy.com' : 'https://www.pexels.com'}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ color: stockProvider === 'vecteezy' ? '#ff6c00' : '#05a081', fontWeight: 600, textDecoration: 'none' }}
                                            >
                                                {stockProvider === 'vecteezy' ? 'Vecteezy' : 'Pexels'}
                                            </a>
                                        </div>
                                    </div>

                                    {/* Sub-bar in Search Mode: Videos vs Photos */}
                                    {stockViewMode === 'search' && (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setStockMediaType('video');
                                                        searchStock(query, 'video');
                                                    }}
                                                    style={{
                                                        padding: '2px 7px',
                                                        borderRadius: 3,
                                                        fontSize: 9.5,
                                                        fontWeight: stockMediaType === 'video' ? 600 : 400,
                                                        background: stockMediaType === 'video' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                                        color: stockMediaType === 'video' ? 'var(--fg)' : 'var(--fg-4)',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    Videos
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setStockMediaType('photo');
                                                        searchStock(query, 'photo');
                                                    }}
                                                    style={{
                                                        padding: '2px 7px',
                                                        borderRadius: 3,
                                                        fontSize: 9.5,
                                                        fontWeight: stockMediaType === 'photo' ? 600 : 400,
                                                        background: stockMediaType === 'photo' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                                        color: stockMediaType === 'photo' ? 'var(--fg)' : 'var(--fg-4)',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    Photos
                                                </button>
                                            </div>

                                            {captions.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={handleGenerateBrollSuggestions}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 3,
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        background: 'rgba(0,229,255,0.08)',
                                                        border: '0.5px solid rgba(0,229,255,0.2)',
                                                        color: 'var(--accent)',
                                                        fontSize: 9.5,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <Sparkles size={9} />
                                                    <span>Scan transcript</span>
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {/* Error in Search Mode */}
                                    {stockViewMode === 'search' && stockError && (
                                        <div style={{ padding: '6px 10px', background: 'rgba(255,80,80,0.1)', border: '0.5px solid rgba(255,80,80,0.25)', borderRadius: 6, fontSize: 10.5, color: '#ff8faa' }}>
                                            {stockError}
                                        </div>
                                    )}

                                    {/* Search Mode Results */}
                                    {stockViewMode === 'search' && (
                                        stockLoading ? (
                                            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                                                <Loader2 size={18} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                                            </div>
                                        ) : (
                                            <>
                                                {stockResults.length === 0 && !stockError && (
                                                    <Empty label={query ? t('assetPanel.noStockFound') : t('assetPanel.searchForStockAbove')} />
                                                )}
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                    {stockResults.map((item, idx) => (
                                                        <StockCard
                                                            key={item.id || idx}
                                                            item={item}
                                                            isAdded={binAssetIds.has(item.id)}
                                                            onAddToTimeline={handleStockAddToTimeline}
                                                            onAddToBin={handleStockAddToBin}
                                                            onAddAsOverlay={handleStockAddAsOverlay}
                                                        />
                                                    ))}
                                                </div>
                                            </>
                                        )
                                    )}

                                    {/* AI B-Roll Suggestions Mode */}
                                    {stockViewMode === 'suggestions' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <div style={{ fontSize: 10.5, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <Sparkles size={11} color="var(--accent)" />
                                                    <span>Context-Aware B-Roll</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleGenerateBrollSuggestions}
                                                    disabled={suggestionsLoading}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 3,
                                                        padding: '3px 8px',
                                                        borderRadius: 4,
                                                        background: 'rgba(255,255,255,0.06)',
                                                        border: '0.5px solid rgba(255,255,255,0.1)',
                                                        color: 'var(--fg)',
                                                        fontSize: 9.5,
                                                        cursor: suggestionsLoading ? 'not-allowed' : 'pointer',
                                                    }}
                                                >
                                                    {suggestionsLoading ? (
                                                        <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />
                                                    ) : (
                                                        <RefreshCw size={9} />
                                                    )}
                                                    <span>Re-scan</span>
                                                </button>
                                            </div>

                                            {suggestionsError && (
                                                <div style={{ padding: '6px 10px', background: 'rgba(255,180,0,0.1)', border: '0.5px solid rgba(255,180,0,0.25)', borderRadius: 6, fontSize: 10.5, color: '#ffcc66' }}>
                                                    {suggestionsError}
                                                </div>
                                            )}

                                            {suggestionsLoading ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }}>
                                                    <Loader2 size={20} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                                                    <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>Analyzing transcript & matching stock footage...</span>
                                                </div>
                                            ) : (
                                                <>
                                                    {brollSuggestions.length === 0 && !suggestionsError && (
                                                        <Empty label="Click 'Re-scan' to find visual moments in your video transcript." />
                                                    )}
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        {brollSuggestions.map(sugg => (
                                                            <BrollSuggestionCard
                                                                key={sugg.id}
                                                                suggestion={sugg}
                                                                onApprove={handleApproveBrollSuggestion}
                                                                onReject={handleRejectBrollSuggestion}
                                                                onReplace={handleReplaceBrollSuggestion}
                                                            />
                                                        ))}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                                )
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* FULL_EDIT approval modal */}
            {approvalPreset && (
                <PresetApprovalModal
                    preset={approvalPreset}
                    onApply={handleFullEditApproved}
                    onCancel={() => setApprovalPreset(null)}
                />
            )}
        </>
    );
}

function Empty({ label }) {
    return (
        <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--f-sans)' }}>
            {label}
        </div>
    );
}
