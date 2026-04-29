import React, { useState } from 'react';
import useEditorStore from '../store/useEditorStore.js';

const TIER_COLORS = { VIRAL: '#a855f7', HIGH: '#22c55e', MEDIUM: '#f59e0b', LOW: '#ef4444' };
const PLATFORM_ICONS = { tiktok: '🎵', reels: '📸', shorts: '▶️', youtube: '🔴', pinterest: '📌', linkedin: '💼' };

function ScoreGauge({ score, color, label }) {
    const r = 36, circ = 2 * Math.PI * r, offset = circ - (score / 100) * circ;
    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            <svg width={90} height={90}>
                <circle cx={45} cy={45} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={7}/>
                <circle cx={45} cy={45} r={r} fill="none" stroke={color} strokeWidth={7}
                    strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                    style={{ transform:'rotate(-90deg)', transformOrigin:'50% 50%', transition:'stroke-dashoffset 0.8s ease' }}/>
                <text x={45} y={50} textAnchor="middle" fill="#fff" fontSize={18} fontWeight={700}>{score}</text>
            </svg>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.6)', textAlign:'center' }}>{label}</span>
        </div>
    );
}

export function ViralIntelligencePanel({ onAnalyze, onSeek }) {
    const viralAnalysis = useEditorStore(s => s.viralAnalysis);
    const isAnalyzing = useEditorStore(s => s.isAnalyzing);
    const duration = useEditorStore(s => s.duration);
    const [tab, setTab] = useState('overview');
    const tabs = ['overview','hook','dead moments','platforms'];

    return (
        <div id="viral-intelligence-panel" className="flex flex-col h-full bg-card font-sans text-foreground">
            <div className="px-4 pt-4 border-b border-border">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="m-0 text-sm font-semibold text-foreground">Insights</h3>
                    <button id="viral-analyze-btn" onClick={onAnalyze} disabled={isAnalyzing}
                        className="px-3 py-1.5 rounded-md border border-border bg-secondary hover:bg-white/10 text-foreground text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
                    </button>
                </div>
                <div className="flex gap-4">
                    {tabs.map(t => (
                        <button key={t} onClick={() => setTab(t)} className={`pb-2 text-xs font-medium transition-colors border-b-2 ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'} capitalize`}>
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:16 }}>
                {!viralAnalysis && !isAnalyzing && (
                    <div style={{ textAlign:'center', padding:'40px 20px', color:'rgba(255,255,255,0.3)' }}>
                        <div style={{ fontSize:36, marginBottom:12 }}>🎯</div>
                        <p style={{ fontSize:13, margin:0 }}>Click <strong>Analyse</strong> to run viral intelligence on your video.</p>
                    </div>
                )}
                {isAnalyzing && (
                    <div style={{ textAlign:'center', padding:'40px 20px' }}>
                        <p style={{ fontSize:24, marginBottom:8 }}>🔄</p>
                        <p style={{ fontSize:13, color:'rgba(255,255,255,0.5)', margin:0 }}>Running analysis…</p>
                    </div>
                )}
                {viralAnalysis && tab === 'overview'      && <OverviewTab data={viralAnalysis} />}
                {viralAnalysis && tab === 'hook'          && <HookTab hook={viralAnalysis.hook} />}
                {viralAnalysis && tab === 'dead moments'  && <DeadMomentsTab pacing={viralAnalysis.pacing} duration={duration} onSeek={onSeek} />}
                {viralAnalysis && tab === 'platforms'     && <PlatformsTab platformFit={viralAnalysis.platformFit} />}
            </div>
        </div>
    );
}

function OverviewTab({ data }) {
    const eng = data.engagement;
    if (!eng) return null;
    return (
        <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
                <div style={{ padding:'6px 16px', borderRadius:20, background:`${TIER_COLORS[eng.tier]}22`, border:`1px solid ${TIER_COLORS[eng.tier]}55`, color:TIER_COLORS[eng.tier], fontWeight:700, fontSize:13, letterSpacing:1 }}>{eng.tier}</div>
                <div style={{ fontSize:28, fontWeight:800, color:TIER_COLORS[eng.tier] }}>{eng.score}<span style={{ fontSize:14, fontWeight:400, color:'rgba(255,255,255,0.4)' }}>/100</span></div>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8, marginBottom:20 }}>
                {eng.breakdown?.map(b => <ScoreGauge key={b.label} score={b.score} color={b.score>=70?'#22c55e':b.score>=50?'#f59e0b':'#ef4444'} label={b.label} />)}
            </div>
            {eng.actionItems?.map((item, i) => (
                <div key={i} style={{ display:'flex', gap:10, marginBottom:10, padding:'10px 12px', background:'rgba(255,255,255,0.04)', borderRadius:8, borderLeft:`3px solid ${item.impact==='HIGH'?'#ef4444':item.impact==='MEDIUM'?'#f59e0b':'#6b7280'}` }}>
                    <span style={{ fontWeight:700, color:'rgba(255,255,255,0.3)', fontSize:12, minWidth:16 }}>#{i+1}</span>
                    <div>
                        <p style={{ margin:'0 0 2px', fontSize:12, fontWeight:600 }}>{item.area}</p>
                        <p style={{ margin:0, fontSize:11, color:'rgba(255,255,255,0.55)', lineHeight:1.5 }}>{item.action}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

function HookTab({ hook }) {
    if (!hook) return null;
    const gc = { A:'#22c55e', B:'#84cc16', C:'#f59e0b', F:'#ef4444' };
    return (
        <div>
            <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20 }}>
                <ScoreGauge score={hook.score} color={gc[hook.grade]||'#6366f1'} label="Hook Score" />
                <div><div style={{ fontSize:36, fontWeight:900, color:gc[hook.grade] }}>{hook.grade}</div><div style={{ fontSize:11, color:'rgba(255,255,255,0.5)' }}>Hook Quality</div></div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
                {[['🗣 Speech',hook.hasSpeech],['👤 Face',hook.hasFace],['✂️ Fast Cuts',hook.hasFastCuts],['💬 Hook Word',hook.hasHookKeyword]].map(([l,v]) => (
                    <div key={l} style={{ padding:'8px 12px', borderRadius:8, background:v?'rgba(34,197,94,0.1)':'rgba(255,255,255,0.04)', border:`1px solid ${v?'rgba(34,197,94,0.3)':'rgba(255,255,255,0.06)'}`, fontSize:12 }}>
                        {l} <span style={{ float:'right', color:v?'#22c55e':'#ef4444', fontWeight:700 }}>{v?'✓':'✗'}</span>
                    </div>
                ))}
            </div>
            <div style={{ padding:'10px 12px', background:'rgba(255,255,255,0.04)', borderRadius:8, fontSize:12, color:'rgba(255,255,255,0.7)', lineHeight:1.6 }}>{hook.suggestion}</div>
        </div>
    );
}

function DeadMomentsTab({ pacing, duration, onSeek }) {
    const dead = pacing?.deadMoments || [];
    return (
        <div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
                <div style={{ fontSize:28, fontWeight:800, color:dead.length===0?'#22c55e':'#ef4444' }}>{dead.length}</div>
                <div style={{ fontSize:13, color:'rgba(255,255,255,0.6)' }}>Dead moment{dead.length!==1?'s':''} detected</div>
            </div>
            {dead.length === 0
                ? <div style={{ textAlign:'center', padding:'20px 0', color:'#22c55e', fontSize:13 }}>✅ No dead moments — great pacing!</div>
                : dead.map((m, i) => {
                    const sc = m.severity==='HIGH'?'#ef4444':m.severity==='MEDIUM'?'#f59e0b':'#6b7280';
                    return (
                        <div key={i} onClick={() => onSeek?.(m.start)} style={{ cursor:'pointer', marginBottom:8 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'rgba(255,255,255,0.6)', marginBottom:3 }}>
                                <span>{m.start.toFixed(1)}s → {m.end.toFixed(1)}s ({m.length.toFixed(1)}s)</span>
                                <span style={{ color:sc, fontWeight:600 }}>{m.severity}</span>
                            </div>
                            <div style={{ height:6, background:'rgba(255,255,255,0.06)', borderRadius:3, position:'relative' }}>
                                <div style={{ position:'absolute', left:`${(m.start/(duration||60))*100}%`, width:`${((m.end-m.start)/(duration||60))*100}%`, height:'100%', background:sc, borderRadius:3 }}/>
                            </div>
                        </div>
                    );
                })
            }
        </div>
    );
}

function PlatformsTab({ platformFit }) {
    const [sel, setSel] = useState(null);
    if (!platformFit) return null;
    const platforms = ['tiktok','reels','shorts','youtube','pinterest','linkedin'];
    return (
        <div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
                {platforms.map(p => {
                    const score = platformFit[p]||0;
                    const isBest = p === platformFit.bestPlatform;
                    return (
                        <div key={p} onClick={() => setSel(sel===p?null:p)}
                            style={{ padding:'10px 12px', borderRadius:8, cursor:'pointer', background:sel===p?'rgba(168,85,247,0.15)':'rgba(255,255,255,0.04)', border:`1px solid ${isBest?'rgba(168,85,247,0.5)':sel===p?'rgba(168,85,247,0.3)':'rgba(255,255,255,0.06)'}`, transition:'all 0.15s' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                                <span style={{ fontSize:12, fontWeight:600, textTransform:'capitalize' }}>{PLATFORM_ICONS[p]} {p}</span>
                                {isBest && <span style={{ fontSize:9, color:'#a855f7', background:'rgba(168,85,247,0.2)', padding:'2px 6px', borderRadius:4, fontWeight:700 }}>BEST</span>}
                            </div>
                            <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:2 }}>
                                <div style={{ height:'100%', width:`${score}%`, borderRadius:2, background:score>=70?'#22c55e':score>=50?'#f59e0b':'#ef4444', transition:'width 0.6s ease' }}/>
                            </div>
                            <div style={{ marginTop:4, fontSize:11, color:'rgba(255,255,255,0.5)', textAlign:'right' }}>{score}/100</div>
                        </div>
                    );
                })}
            </div>
            {sel && platformFit.optimizations?.[sel]?.map((tip, i) => (
                <div key={i} style={{ display:'flex', gap:8, marginBottom:6, fontSize:12, color:'rgba(255,255,255,0.7)' }}>
                    <span style={{ color:'#f59e0b' }}>→</span><span>{tip.replace(/^[^:]+:\s*/,'')}</span>
                </div>
            ))}
        </div>
    );
}

export default ViralIntelligencePanel;
