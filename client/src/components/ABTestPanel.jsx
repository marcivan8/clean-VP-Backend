/**
 * ABTestPanel — Phase 7
 * A/B variation panel for generating and comparing up to 3 timeline variations.
 */
import React, { useState, useEffect } from 'react';
// The engine writes to useTimelineStore (see IterationEngine's own header).
// This panel read from the legacy useTimelineStore, which nothing writes to any
// more, so it rendered its empty state no matter how many variations existed.
import useTimelineStore from '../store/useTimelineStore.js';
import { getIterationModeForStyle, IterationEngine } from '../agent/IterationEngine.js';

const VARIATION_COLORS = ['#6366f1', '#a855f7', '#ec4899'];

export function ABTestPanel({ currentPrompt = '' }) {
    const variations = useTimelineStore(s => s.variations) || [];
    const activeVariationId = useTimelineStore(s => s.activeVariationId);
    const editingStyle = useTimelineStore(s => s.editingStyle);
    const captions = useTimelineStore(s => s.captions) || [];
    const mode = getIterationModeForStyle(editingStyle);
    const visibleVariations = variations.filter(v => !v.mode || v.mode === mode);
    const [isGenerating, setIsGenerating] = useState(false);
    const [prompt, setPrompt] = useState(currentPrompt);
    const [count, setCount] = useState(3);
    const [compareMode, setCompareMode] = useState(false);
    const [compareIds, setCompareIds] = useState([]);

    const handleGenerate = async () => {
        if (!mode || (mode === 'hooks' && captions.length === 0)) return;
        setIsGenerating(true);
        try { await IterationEngine.generateVariations(prompt.trim(), count); }
        finally { setIsGenerating(false); }
    };

    const handleLoad = (id) => {
        IterationEngine.loadVariation(id);
        useTimelineStore.getState().setActiveVariation(id);
    };

    const handleRestore = () => {
        IterationEngine.restoreOriginal();
        useTimelineStore.getState().setActiveVariation(null);
    };

    const handleClear = () => {
        IterationEngine.clear();
    };

    const toggleCompare = (id) => {
        setCompareIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id]);
    };

    const comparison = compareMode && compareIds.length === 2 ? IterationEngine.compareVariations(compareIds[0], compareIds[1]) : null;

    return (
        <div id="ab-test-panel" className="flex flex-col h-full bg-card font-sans text-foreground">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-border">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="m-0 text-sm font-semibold text-foreground">{mode === 'hooks' ? 'Hook variations' : mode === 'video' ? 'Video variations' : 'Iterations'}</h3>
                    {visibleVariations.length > 0 && (
                        <div className="flex gap-2">
                            <button onClick={() => setCompareMode(!compareMode)} className={`px-2 py-1 rounded border text-[10px] font-medium transition-colors ${compareMode ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>Compare</button>
                            <button onClick={handleClear} className="px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[10px] font-medium transition-colors">Clear</button>
                        </div>
                    )}
                </div>

                {/* Prompt input */}
                {mode === 'hooks' && (
                    <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Optional direction for the opening hook…"
                        className="w-full box-border px-3 py-2 rounded-md border border-border bg-background text-foreground text-xs resize-none h-14 outline-none font-sans focus:border-primary transition-colors" />
                )}
                <p className="mt-0 mb-2 text-[11px] text-muted-foreground">
                    {mode === 'hooks'
                        ? captions.length ? 'Long-form style: compare transcript-grounded opening hooks. The rest of the edit stays intact.' : 'Add captions first to generate hook variations from your spoken content.'
                        : mode === 'video' ? 'Reel style: compare full-video pacing and transition treatments.' : 'Choose a long-form style or Reel style to use iterations.'}
                </p>
                <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">Count:</span>
                    {[1,2,3].map(n => (
                        <button key={n} onClick={() => setCount(n)}
                            className={`w-6 h-6 rounded border flex items-center justify-center text-xs font-semibold transition-colors ${count === n ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>{n}</button>
                    ))}
                    <button id="ab-generate-btn" onClick={handleGenerate} disabled={isGenerating || !mode || (mode === 'hooks' && captions.length === 0)}
                        className="ml-auto px-3 py-1.5 rounded-md border border-border bg-secondary hover:bg-white/10 text-foreground text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {isGenerating ? 'Generating...' : mode === 'hooks' ? 'Generate hooks' : mode === 'video' ? 'Generate videos' : 'Choose a style'}
                    </button>
                </div>
            </div>

            {/* Body */}
            <div style={{ flex:1, overflowY:'auto', padding:16 }}>
                {visibleVariations.length === 0 && !isGenerating && (
                    <div style={{ textAlign:'center', padding:'40px 20px', color:'rgba(255,255,255,0.25)' }}>
                        <div style={{ fontSize:32, marginBottom:10 }}>🎞️</div>
                        <p style={{ fontSize:12, margin:0 }}>{mode === 'hooks' ? 'Generate alternative transcript-led openings, then load one to try it.' : mode === 'video' ? 'Generate full-video treatments with different pacing and transitions.' : 'Choose a long-form or Reel editing style to start.'}</p>
                    </div>
                )}

                {isGenerating && (
                    <div style={{ textAlign:'center', padding:'30px 20px', color:'rgba(255,255,255,0.4)' }}>
                        <p style={{ fontSize:22 }}>🔄</p>
                        <p style={{ fontSize:12, margin:0 }}>Building {count} variation{count>1?'s':''}…</p>
                    </div>
                )}

                {/* Original restore button */}
                {visibleVariations.length > 0 && activeVariationId && (
                    <button onClick={handleRestore} style={{ width:'100%', marginBottom:10, padding:'8px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.04)', color:'rgba(255,255,255,0.6)', fontSize:12, cursor:'pointer' }}>
                        ↩ Restore Original
                    </button>
                )}

                {/* Variation cards */}
                {visibleVariations.map((v, i) => {
                    const color = VARIATION_COLORS[i % VARIATION_COLORS.length];
                    const isActive = activeVariationId === v.id;
                    const isInCompare = compareIds.includes(v.id);
                    return (
                        <div key={v.id} style={{ marginBottom:10, padding:'12px', borderRadius:10, background:isActive?`${color}15`:'rgba(255,255,255,0.04)', border:`1px solid ${isActive?color:isInCompare?`${color}55`:'rgba(255,255,255,0.07)'}`, transition:'all 0.2s' }}>
                            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8 }}>
                                <div>
                                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                        <div style={{ width:8, height:8, borderRadius:'50%', background:color }}/>
                                        <span style={{ fontSize:13, fontWeight:700 }}>{v.name}</span>
                                        {isActive && <span style={{ fontSize:9, padding:'2px 6px', borderRadius:4, background:`${color}33`, color, fontWeight:700 }}>ACTIVE</span>}
                                    </div>
                                    <p style={{ margin:'4px 0 0 16px', fontSize:11, color:'rgba(255,255,255,0.5)' }}>{v.description}</p>
                                </div>
                                <div style={{ textAlign:'right', minWidth:42 }}>
                                    <div style={{ fontSize:18, fontWeight:800, color }}>{v.engagementScore}</div>
                                    <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)' }}>score</div>
                                </div>
                            </div>
                            <div style={{ display:'flex', gap:6 }}>
                                {!isActive
                                    ? <button onClick={() => handleLoad(v.id)} style={{ flex:1, padding:'6px', borderRadius:6, border:`1px solid ${color}55`, background:`${color}20`, color, fontSize:11, fontWeight:600, cursor:'pointer' }}>Load</button>
                                    : <button onClick={handleRestore} style={{ flex:1, padding:'6px', borderRadius:6, border:'1px solid rgba(255,255,255,0.15)', background:'transparent', color:'rgba(255,255,255,0.5)', fontSize:11, cursor:'pointer' }}>Unload</button>
                                }
                                {compareMode && (
                                    <button onClick={() => toggleCompare(v.id)} style={{ padding:'6px 10px', borderRadius:6, border:`1px solid ${isInCompare?color:'rgba(255,255,255,0.15)'}`, background:isInCompare?`${color}25`:'transparent', color:isInCompare?color:'rgba(255,255,255,0.5)', fontSize:11, cursor:'pointer' }}>
                                        {isInCompare ? '✓ In compare' : 'Compare'}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Comparison result */}
                {comparison && (
                    <div style={{ marginTop:12, padding:'12px', background:'rgba(255,255,255,0.04)', borderRadius:10, border:'1px solid rgba(255,255,255,0.08)' }}>
                        <p style={{ margin:'0 0 10px', fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.6)' }}>📊 Comparison</p>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, fontSize:11 }}>
                            {[['Engagement Δ', `${comparison.engagementDelta > 0 ? '+' : ''}${comparison.engagementDelta}`],['Winner', comparison.winner],['Clips A', comparison.clipCountA],['Clips B', comparison.clipCountB]].map(([k,v]) => (
                                <div key={k} style={{ background:'rgba(255,255,255,0.04)', padding:'6px 10px', borderRadius:6 }}>
                                    <div style={{ color:'rgba(255,255,255,0.4)', marginBottom:2 }}>{k}</div>
                                    <div style={{ fontWeight:700, color:'#fff' }}>{v}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ABTestPanel;
