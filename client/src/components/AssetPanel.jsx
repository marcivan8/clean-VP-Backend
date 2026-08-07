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
import { Search, Music2, Palette, Layers, Loader2, RefreshCw, Upload } from 'lucide-react';
import { useAudioEngine }        from '../hooks/useAudioEngine.js';
import useTimelineStore          from '../store/useTimelineStore.js';
import { audioEngineAPI }        from '../audio-engine/AudioEngineAPI.js';
import SoundCard                 from './SoundCard.jsx';
import LUTCard                   from './LUTCard.jsx';
import PresetCard                from './PresetCard.jsx';
import PresetApprovalModal       from './PresetApprovalModal.jsx';

const TABS = [
    { key: 'sfx',     labelKey: 'assetPanel.tabSfx',     icon: Music2  },
    { key: 'luts',    labelKey: 'assetPanel.tabColor',   icon: Palette },
    { key: 'presets', labelKey: 'assetPanel.tabPresets', icon: Layers  },
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

export default function AssetPanel({ onClose }) {
    const { t } = useTranslation('editor');
    const [tab,          setTab]          = useState('sfx');
    const [query,        setQuery]        = useState('');
    const [approvalPreset, setApprovalPreset] = useState(null);
    const [applyResult,  setApplyResult]  = useState(null); // { success, executed }
    const [favoriteAssetIds, setFavoriteAssetIds] = useState(() => new Set());

    const projectLUTId = useTimelineStore(s => s.projectLUTId);

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

    // Load defaults on tab change
    useEffect(() => {
        if (tab === 'sfx'     && sfxResults.length === 0)     searchSFX('');
        if (tab === 'luts'    && lutResults.length === 0)     searchLUTs('');
        if (tab === 'presets' && presetResults.length === 0)  searchPresets();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

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
    }, [tab, query, searchSFX, searchLUTs, searchPresets]);

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
    const handleLUTApply = useCallback(async lut => {
        if (projectLUTId === lut.id) {
            clearLUT();
        } else {
            await applyLUT(lut.id);
        }
    }, [projectLUTId, applyLUT, clearLUT]);

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
                        return (
                            <button
                                key={tabItem.key}
                                onClick={() => setTab(tabItem.key)}
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
                                    gap:          5,
                                    transition:   'color 0.15s',
                                }}
                            >
                                <Icon size={11} /> {t(tabItem.labelKey)}
                            </button>
                        );
                    })}
                </div>

                {/* Search bar */}
                <form onSubmit={handleSearch} style={{ padding: '10px 12px 8px', display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <Search size={11} color="var(--fg-3)" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={
                                tab === 'sfx'     ? t('assetPanel.searchPlaceholderSfx')  :
                                tab === 'luts'    ? t('assetPanel.searchPlaceholderLuts')  :
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
