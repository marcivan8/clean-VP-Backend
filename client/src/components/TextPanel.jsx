import { useShallow } from 'zustand/react/shallow';
import React, { useState } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { Type, AlignLeft, AlignCenter, AlignRight, Plus, Bold, Italic, Underline, CheckSquare, Square } from 'lucide-react';
import classNames from 'classnames';

const FONTS = [
    { name: 'Inter', value: 'Inter, sans-serif' },
    { name: 'Roboto', value: '"Roboto", sans-serif' },
    { name: 'Lato', value: '"Lato", sans-serif' },
    { name: 'Montserrat', value: '"Montserrat", sans-serif' },
    { name: 'Oswald', value: '"Oswald", sans-serif' },
    { name: 'Merriweather', value: '"Merriweather", serif' },
    { name: 'Playfair', value: '"Playfair Display", serif' },
    { name: 'Handwriting', value: '"Dancing Script", cursive' },
];

const TextPanel = () => {
    const { activeClipId, tracks, updateClip, addClip, addTextTrack, setActiveClip } = useTimelineStore(useShallow(state => ({
    activeClipId: state.activeClipId,
    tracks: state.tracks,
    updateClip: state.updateClip,
    addClip: state.addClip,
    addTextTrack: state.addTextTrack,
    setActiveClip: state.setActiveClip
})));
    const [applyToAll, setApplyToAll] = useState(false);

    // Derive active clip
    const activeTrack = tracks.find(t => t.clips.some(c => c.id === activeClipId));
    const activeClip = activeTrack?.clips.find(c => c.id === activeClipId);

    const isTextClip = activeTrack?.type === 'text';

    const handleAddText = (preset) => {
        let textTrack = tracks.find(t => t.type === 'text');
        if (!textTrack) {
            useTimelineStore.getState().addTextTrack();
            textTrack = useTimelineStore.getState().tracks.find(t => t.type === 'text');
        }

        const id = `clip-text-${Date.now()}`;
        addClip(textTrack.id, {
            id,
            start: useTimelineStore.getState().currentTime,
            duration: 5,
            name: preset.name,
            content: preset.content || 'New Text',
            fontFamily: preset.fontFamily || 'Inter',
            fontSize: preset.fontSize || 48,
            color: preset.color || '#ffffff',
            type: 'text'
        });
        setActiveClip(id);
    };

    const handleUpdate = (updates) => {
        if (!activeTrack || !activeClip) return;

        if (applyToAll) {
            // Split updates into styling and content
            const styleUpdates = { ...updates };
            delete styleUpdates.content; // Never apply content to all captions!

            // Apply style updates to ALL text clips in the track
            if (Object.keys(styleUpdates).length > 0) {
                activeTrack.clips.forEach(clip => {
                    updateClip(activeTrack.id, clip.id, styleUpdates);
                });
            }

            // If there's a content update, only apply it to the active clip
            if (updates.content !== undefined) {
                updateClip(activeTrack.id, activeClip.id, { content: updates.content });
            }
        } else {
            // Just apply to the active clip
            updateClip(activeTrack.id, activeClip.id, updates);
        }
    };

    if (activeClip && isTextClip) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Text Properties</div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 cursor-pointer group">
                            <input 
                                type="checkbox" 
                                checked={applyToAll} 
                                onChange={(e) => setApplyToAll(e.target.checked)}
                                className="w-3.5 h-3.5 rounded-sm bg-secondary border-border text-primary focus:ring-primary/50"
                            />
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold group-hover:text-white transition-colors">Apply to All</span>
                        </label>
                        <div className="text-[10px] text-green-400 font-mono">EDITING</div>
                    </div>
                </div>

                {/* Content */}
                <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Content</label>
                    <textarea
                        value={activeClip.content || ''}
                        onChange={(e) => handleUpdate({ content: e.target.value })}
                        className="w-full bg-secondary rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        rows={3}
                    />
                </div>

                {/* Size & Scale */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Size (px)</label>
                        <input
                            type="number"
                            value={activeClip.fontSize || 48}
                            onChange={(e) => handleUpdate({ fontSize: parseInt(e.target.value) })}
                            className="w-full bg-secondary rounded-md p-2 text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Scale (x)</label>
                        <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="5.0"
                            value={activeClip.scale || 1.0}
                            onChange={(e) => handleUpdate({ scale: parseFloat(e.target.value) })}
                            className="w-full bg-secondary rounded-md p-2 text-sm"
                        />
                    </div>
                </div>

                {/* Font Family */}
                <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Font</label>
                    <select
                        value={activeClip.fontFamily || 'Inter'}
                        onChange={(e) => handleUpdate({ fontFamily: e.target.value })}
                        className="w-full bg-secondary rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        {FONTS.map(font => (
                            <option key={font.name} value={font.name}>{font.name}</option>
                        ))}
                    </select>
                </div>

                {/* Text Styles (Bold, Italic, Shadow, Stroke) */}
                <div className="flex gap-2 p-2 bg-secondary/30 rounded-lg">
                    <button
                        onClick={() => handleUpdate({ fontWeight: activeClip.fontWeight === 'bold' ? 'normal' : 'bold' })}
                        className={classNames("p-2 rounded hover:bg-white/10 transition-colors", activeClip.fontWeight === 'bold' ? "bg-white/20 text-white" : "text-muted-foreground")}
                        title="Bold"
                    >
                        <Bold className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => handleUpdate({ fontStyle: activeClip.fontStyle === 'italic' ? 'normal' : 'italic' })}
                        className={classNames("p-2 rounded hover:bg-white/10 transition-colors", activeClip.fontStyle === 'italic' ? "bg-white/20 text-white" : "text-muted-foreground")}
                        title="Italic"
                    >
                        <Italic className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => handleUpdate({ textDecoration: activeClip.textDecoration === 'underline' ? 'none' : 'underline' })}
                        className={classNames("p-2 rounded hover:bg-white/10 transition-colors", activeClip.textDecoration === 'underline' ? "bg-white/20 text-white" : "text-muted-foreground")}
                        title="Underline"
                    >
                        <Underline className="w-4 h-4" />
                    </button>

                    <div className="w-px bg-border mx-1" />

                    {/* Shadow Toggle */}
                    <button
                        onClick={() => handleUpdate({ textShadow: activeClip.textShadow ? null : '2px 2px 4px rgba(0,0,0,0.8)' })}
                        className={classNames("px-2 py-1 text-[10px] rounded hover:bg-white/10 transition-colors border border-transparent", activeClip.textShadow ? "bg-white/10 border-white/20 text-white" : "text-muted-foreground")}
                    >
                        Shadow
                    </button>

                    {/* Stroke Toggle */}
                    <button
                        onClick={() => handleUpdate({ stroke: activeClip.stroke ? null : { width: 1, color: '#000000' } })}
                        className={classNames("px-2 py-1 text-[10px] rounded hover:bg-white/10 transition-colors border border-transparent", activeClip.stroke ? "bg-white/10 border-white/20 text-white" : "text-muted-foreground")}
                    >
                        Stroke
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Color</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={activeClip.color || '#ffffff'}
                                onChange={(e) => handleUpdate({ color: e.target.value })}
                                className="w-8 h-8 rounded cursor-pointer bg-transparent border-none"
                            />
                            <span className="text-xs font-mono opacity-50">{activeClip.color}</span>
                        </div>
                    </div>
                </div>

                {/* Alignment */}
                <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Alignment</label>
                    <div className="flex bg-secondary rounded-md p-1">
                        {['left', 'center', 'right'].map(align => (
                            <button
                                key={align}
                                onClick={() => handleUpdate({ textAlign: align })}
                                className={`flex-1 p-1 rounded hover:bg-white/10 flex justify-center ${activeClip.textAlign === align ? 'bg-white/20' : ''}`}
                            >
                                {align === 'left' && <AlignLeft className="w-4 h-4" />}
                                {align === 'center' && <AlignCenter className="w-4 h-4" />}
                                {align === 'right' && <AlignRight className="w-4 h-4" />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Position (Basic X/Y Sliders) */}
                <div className="space-y-3 pt-4 border-t border-border">
                    <div className="text-xs font-bold text-muted-foreground">Position</div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs"><span>X Axis</span> <span>{activeClip.x || 50}%</span></div>
                        <input
                            type="range" min="0" max="100"
                            value={activeClip.x || 50}
                            onChange={(e) => handleUpdate({ x: parseInt(e.target.value) })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs"><span>Y Axis</span> <span>{activeClip.y || 50}%</span></div>
                        <input
                            type="range" min="0" max="100"
                            value={activeClip.y || 50}
                            onChange={(e) => handleUpdate({ y: parseInt(e.target.value) })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </div>

            </div>
        );
    }

    // Default View: Add Presets
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Add Text</div>
            </div>

            <div className="grid grid-cols-1 gap-3">
                <button
                    onClick={() => handleAddText({ name: 'Heading', content: 'Big Headline', fontSize: 72, fontWeight: 'bold' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.02]"
                >
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Heading</h1>
                    <p className="text-[10px] text-muted-foreground mt-1">Large, bold title text.</p>
                </button>

                <button
                    onClick={() => handleAddText({ name: 'Subheading', content: 'Subtitle Text', fontSize: 48, fontWeight: 'medium' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.02]"
                >
                    <h2 className="text-lg font-medium text-gray-200">Subheading</h2>
                    <p className="text-[10px] text-muted-foreground mt-1">Secondary text for context.</p>
                </button>

                <button
                    onClick={() => handleAddText({ name: 'Body Text', content: 'Body text content goes here.', fontSize: 24, fontWeight: 'normal' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.02]"
                >
                    <p className="text-sm text-gray-400">Body Text</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Small text for descriptions.</p>
                </button>
            </div>

            <div className="pt-4 border-t border-border">
                <button
                    onClick={() => handleAddText({ name: 'Text', content: 'Enter text here', fontSize: 48 })}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-xs font-medium transition-colors"
                >
                    <Plus className="w-3 h-3" /> Add Text Layer
                </button>
            </div>
        </div>
    );
};

export default TextPanel;
