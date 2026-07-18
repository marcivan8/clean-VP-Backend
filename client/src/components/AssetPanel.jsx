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
import { Search, Music2, Palette, Layers, Loader2, RefreshCw, Download } from 'lucide-react';
import { useAudioEngine }        from '../hooks/useAudioEngine.js';
import useTimelineStore          from '../store/useTimelineStore.js';
import SoundCard                 from './SoundCard.jsx';
import LUTCard                   from './LUTCard.jsx';
import PresetCard                from './PresetCard.jsx';
import PresetApprovalModal       from './PresetApprovalModal.jsx';
import AudioExportPanel          from './AudioExportPanel.jsx';

const TABS = [
    { key: 'sfx',     label: 'SFX',    icon: Music2  },
    { key: 'luts',    label: 'Color',  icon: Palette },
    { key: 'presets', label: 'Presets',icon: Layers  },
];

const PANEL = {
    width:      320,
    background: 'rgba(10,10,14,0.97)',
    border:     '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    display:    'flex',
    flexDirection: 'column',
    fontFamily: 'var(--f-sans)',
    overflow:   'hidden',
    height:     '100%',
    maxHeight:  560,
};

export default function AssetPanel({ onClose }) {
    const [tab,          setTab]          = useState('sfx');
    const [query,        setQuery]        = useState('');
    const [approvalPreset, setApprovalPreset] = useState(null);
    const [showExport,   setShowExport]   = useState(false);
    const [applyResult,  setApplyResult]  = useState(null); // { success, executed }

    const projectLUTId = useTimelineStore(s => s.projectLUTId);

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

    const handleSearch = useCallback(e => {
        e.preventDefault();
        if (tab === 'sfx')     searchSFX(query);
        if (tab === 'luts')    searchLUTs(query);
        if (tab === 'presets') searchPresets(null, 20);
    }, [tab, query, searchSFX, searchLUTs, searchPresets]);

    // SFX → add to audio track
    const handleAddSFX = useCallback(sfx => {
        const state = useTimelineStore.getState();
        const audioTrack = state.tracks?.find(t => t.type === 'audio');
        if (!audioTrack) return;
        // Naive placement at playhead — executor resolves $playhead
        const atTime = state.playheadTime || 0;
        state.addClip?.(audioTrack.id, {
            id:       `sfx_${Date.now()}`,
            type:     'audio',
            src:      sfx.preview_url || sfx.asset_url || sfx.id,
            assetId:  sfx.id,
            start:    atTime,
            duration: 2,
            volume:   0.8,
            name:     sfx.display_name || sfx.name,
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

    if (showExport) {
        return <AudioExportPanel onClose={() => setShowExport(false)} />;
    }

    return (
        <>
            <div style={PANEL}>
                {/* Top accent bar */}
                <div style={{ height: '0.5px', background: 'linear-gradient(90deg, var(--accent), var(--violet))' }} />

                {/* Header */}
                <div style={{ padding: '10px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.01em' }}>Assets</span>
                    <button
                        onClick={() => setShowExport(true)}
                        title="Export audio"
                        style={{
                            background: 'rgba(0,229,255,0.1)', border: 'none', borderRadius: 5,
                            color: 'var(--accent)', cursor: 'pointer', padding: '3px 7px',
                            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
                        }}
                    >
                        <Download size={10} /> Export Audio
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 2, padding: '8px 14px 0', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
                    {TABS.map(t => {
                        const Icon    = t.icon;
                        const active  = tab === t.key;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
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
                                <Icon size={11} /> {t.label}
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
                                tab === 'sfx'     ? 'whoosh, impact, comedy beat…'  :
                                tab === 'luts'    ? 'cinematic, warm, vintage…'      :
                                                   'color grade, captions, full edit…'
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
                        Applied: {applyResult.executed?.join(', ')}
                        {applyResult.skipped?.length > 0 && ` · skipped: ${applyResult.skipped.join(', ')}`}
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
                                    {sfxResults.length === 0 && (
                                        <Empty label="Search for a sound effect above" />
                                    )}
                                    {sfxResults.map((r, i) => (
                                        <SoundCard
                                            key={r.asset?.id || i}
                                            sfx={r.asset || r}
                                            onSelect={handleAddSFX}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* LUTs tab */}
                            {tab === 'luts' && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 4 }}>
                                    {lutResults.length === 0 && (
                                        <div style={{ gridColumn: '1/-1' }}><Empty label="Search for a color style above" /></div>
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
                                        <Empty label="No presets found" />
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
