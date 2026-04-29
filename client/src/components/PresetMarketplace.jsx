/**
 * PresetMarketplace — Phase 7
 * Preset management UI with Built-in, My Presets, and Marketplace tabs.
 */
import React, { useState, useEffect, useRef } from 'react';
import PresetSystem, { PRESET_CATEGORIES } from '../presets/PresetSystem.js';

const CATEGORY_ICONS = { color:'🎨', effects:'✨', transitions:'🔀', audio:'🎵', text:'📝', composite:'🧩' };
const CATEGORY_ALL = 'all';

function PresetCard({ preset, onApply, onExport, onDelete, accentColor = '#6366f1' }) {
    return (
        <div style={{ padding:'12px', borderRadius:10, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', marginBottom:8, transition:'all 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.border='1px solid rgba(255,255,255,0.15)'}
            onMouseLeave={e => e.currentTarget.style.border='1px solid rgba(255,255,255,0.07)'}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                <div>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:2 }}>{preset.name}</div>
                    <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>by {preset.author || 'Viral Pilot'}</div>
                </div>
                <span style={{ fontSize:10, padding:'3px 8px', borderRadius:4, background:`${accentColor}25`, color:accentColor, fontWeight:600, textTransform:'capitalize', whiteSpace:'nowrap' }}>
                    {CATEGORY_ICONS[preset.category] || '📦'} {preset.category}
                </span>
            </div>
            {preset.description && <p style={{ margin:'0 0 10px', fontSize:11, color:'rgba(255,255,255,0.5)', lineHeight:1.5 }}>{preset.description}</p>}
            <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => onApply(preset)} style={{ flex:2, padding:'6px', borderRadius:6, border:'none', background:`${accentColor}`, color:'#fff', fontSize:11, fontWeight:600, cursor:'pointer' }}>Apply</button>
                <button onClick={() => onExport(preset.id)} style={{ flex:1, padding:'6px', borderRadius:6, border:'1px solid rgba(255,255,255,0.15)', background:'transparent', color:'rgba(255,255,255,0.6)', fontSize:11, cursor:'pointer' }}>Export</button>
                {preset.isUserPreset && <button onClick={() => onDelete(preset.id)} style={{ padding:'6px 8px', borderRadius:6, border:'1px solid rgba(239,68,68,0.3)', background:'transparent', color:'#f87171', fontSize:11, cursor:'pointer' }}>✕</button>}
            </div>
        </div>
    );
}

export function PresetMarketplace({ isOpen, onClose, onApplyPreset }) {
    const [tab, setTab] = useState('built-in');
    const [category, setCategory] = useState(CATEGORY_ALL);
    const [presets, setPresets] = useState([]);
    const [marketplacePresets, setMarketplacePresets] = useState([]);
    const [search, setSearch] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [toast, setToast] = useState(null);
    const fileInputRef = useRef();

    const refresh = () => setPresets(PresetSystem.getAll());

    useEffect(() => { if (isOpen) { refresh(); PresetSystem.getMarketplacePresets().then(setMarketplacePresets); } }, [isOpen]);

    const showToast = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleApply = (preset) => { onApplyPreset?.(preset); showToast(`✅ Applied: ${preset.name}`); };

    const handleExport = (id) => {
        const json = PresetSystem.export(id);
        const blob = new Blob([json], { type:'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `preset-${id}.json`; a.click();
        URL.revokeObjectURL(url);
        showToast('📥 Preset exported');
    };

    const handleExportAll = () => {
        const json = PresetSystem.exportAll();
        const blob = new Blob([json], { type:'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'vp-presets-bundle.json'; a.click();
        URL.revokeObjectURL(url);
        showToast('📦 Bundle exported');
    };

    const handleDelete = (id) => { PresetSystem.delete(id); refresh(); showToast('🗑 Preset deleted'); };

    const handleImportFile = async (file) => {
        const text = await file.text();
        try {
            const parsed = JSON.parse(text);
            if (parsed.presets) { const n = PresetSystem.importBundle(parsed); showToast(`📦 Imported ${n} preset(s)`); }
            else { PresetSystem.import(parsed); showToast('✅ Preset imported'); }
            refresh();
        } catch { showToast('❌ Invalid JSON file', 'error'); }
    };

    const handleFilePick = (e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); };

    const handleDrop = (e) => {
        e.preventDefault(); setIsDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.name.endsWith('.json')) handleImportFile(f);
    };

    const categories = [CATEGORY_ALL, ...Object.values(PRESET_CATEGORIES)];

    const filterPresets = (list) => list
        .filter(p => category === CATEGORY_ALL || p.category === category)
        .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase()));

    const tabPresets = {
        'built-in': filterPresets(presets.filter(p => !p.isUserPreset)),
        'my presets': filterPresets(presets.filter(p => p.isUserPreset)),
        'marketplace': filterPresets(marketplacePresets)
    };

    if (!isOpen) return null;

    return (
        <div id="preset-marketplace-overlay" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Inter,sans-serif' }}>
            <div id="preset-marketplace-modal" style={{ width:'90%', maxWidth:620, maxHeight:'85vh', display:'flex', flexDirection:'column', background:'linear-gradient(145deg,#1a1a2e,#24243e)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:18, boxShadow:'0 25px 70px rgba(0,0,0,0.6)', color:'#fff', overflow:'hidden' }}>

                {/* Header */}
                <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                        <h2 style={{ margin:0, fontSize:16, fontWeight:800, background:'linear-gradient(135deg,#6366f1,#a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>🧩 Preset Marketplace</h2>
                        <div style={{ display:'flex', gap:8 }}>
                            <button onClick={() => fileInputRef.current?.click()} style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(99,102,241,0.4)', background:'rgba(99,102,241,0.15)', color:'#818cf8', fontSize:11, fontWeight:600, cursor:'pointer' }}>📥 Import</button>
                            {tab === 'my presets' && presets.filter(p => p.isUserPreset).length > 0 && (
                                <button onClick={handleExportAll} style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(168,85,247,0.4)', background:'rgba(168,85,247,0.15)', color:'#c084fc', fontSize:11, fontWeight:600, cursor:'pointer' }}>📦 Export All</button>
                            )}
                            <button onClick={onClose} style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'transparent', color:'rgba(255,255,255,0.5)', fontSize:11, cursor:'pointer' }}>Close</button>
                        </div>
                    </div>
                    {/* Tabs */}
                    <div style={{ display:'flex', gap:4, marginBottom:12 }}>
                        {['built-in','my presets','marketplace'].map(t => (
                            <button key={t} onClick={() => setTab(t)} style={{ padding:'7px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, textTransform:'capitalize', background:tab===t?'rgba(99,102,241,0.25)':'transparent', color:tab===t?'#818cf8':'rgba(255,255,255,0.45)' }}>
                                {t === 'marketplace' ? '🌐 Marketplace' : t === 'my presets' ? '⭐ My Presets' : '📦 Built-in'}
                            </button>
                        ))}
                    </div>
                    {/* Search */}
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search presets…"
                        style={{ width:'100%', boxSizing:'border-box', padding:'8px 12px', borderRadius:8, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)', color:'#fff', fontSize:12, outline:'none' }}/>
                </div>

                {/* Category filter */}
                <div style={{ padding:'10px 20px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:6, overflowX:'auto' }}>
                    {categories.map(c => (
                        <button key={c} onClick={() => setCategory(c)} style={{ padding:'4px 12px', borderRadius:20, border:'none', cursor:'pointer', fontSize:11, fontWeight:600, whiteSpace:'nowrap', background:category===c?'rgba(99,102,241,0.3)':'rgba(255,255,255,0.05)', color:category===c?'#818cf8':'rgba(255,255,255,0.45)', textTransform:'capitalize' }}>
                            {c === CATEGORY_ALL ? '🔍 All' : `${CATEGORY_ICONS[c]||''} ${c}`}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div style={{ flex:1, overflowY:'auto', padding:20 }}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}>

                    {isDragging && (
                        <div style={{ position:'absolute', inset:0, background:'rgba(99,102,241,0.15)', border:'2px dashed #6366f1', borderRadius:18, display:'flex', alignItems:'center', justifyContent:'center', zIndex:10, fontSize:16, color:'#818cf8', fontWeight:700, pointerEvents:'none' }}>
                            Drop JSON preset here
                        </div>
                    )}

                    {tab === 'marketplace' && (
                        <div style={{ marginBottom:14, padding:'10px 14px', background:'rgba(168,85,247,0.1)', borderRadius:8, border:'1px solid rgba(168,85,247,0.25)', fontSize:12, color:'rgba(255,255,255,0.6)' }}>
                            🌐 Community marketplace coming in Phase 8 — showing curated presets for now.
                        </div>
                    )}

                    {tabPresets[tab]?.length === 0 && (
                        <div style={{ textAlign:'center', padding:'40px 20px', color:'rgba(255,255,255,0.25)' }}>
                            <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                            <p style={{ fontSize:12 }}>{tab === 'my presets' ? 'No saved presets yet — create one by applying edits and saving.' : 'No presets found.'}</p>
                        </div>
                    )}

                    {tabPresets[tab]?.map(p => (
                        <PresetCard key={p.id} preset={p} onApply={handleApply} onExport={handleExport} onDelete={handleDelete}
                            accentColor={p.category === 'color' ? '#6366f1' : p.category === 'audio' ? '#22c55e' : p.category === 'effects' ? '#a855f7' : '#f59e0b'} />
                    ))}
                </div>

                {/* Toast */}
                {toast && (
                    <div style={{ position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)', padding:'8px 18px', borderRadius:8, background:toast.type==='error'?'rgba(239,68,68,0.9)':'rgba(34,197,94,0.9)', color:'#fff', fontSize:12, fontWeight:600, boxShadow:'0 4px 14px rgba(0,0,0,0.4)', pointerEvents:'none' }}>{toast.msg}</div>
                )}
            </div>

            <input ref={fileInputRef} type="file" accept=".json" style={{ display:'none' }} onChange={handleFilePick}/>
        </div>
    );
}

export default PresetMarketplace;
