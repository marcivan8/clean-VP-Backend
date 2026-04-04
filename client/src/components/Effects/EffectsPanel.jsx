/**
 * EffectsPanel.jsx
 * Main effects management panel with effect list, add effect button,
 * and integration with presets.
 */

import React, { useState, useMemo } from 'react';
import {
    Sparkles,
    Plus,
    Trash2,
    Eye,
    EyeOff,
    ChevronDown,
    ChevronRight,
    GripVertical,
    Wand2,
    Grid3X3,
    X,
    Search,
    Palette,
    Waves,
    Zap,
    Sun,
    Move3D,
    Film,
    SparklesIcon
} from 'lucide-react';
import { useEffects, usePresets, useEffectRegistry } from '../../hooks/useEffects';
import EffectControls from './EffectControls';
import PresetBrowser from './PresetBrowser';

// Category icons map
const CATEGORY_ICONS = {
    blur: Waves,
    color: Palette,
    distortion: Zap,
    light: Sun,
    transform: Move3D,
    transition: Film,
    ai: SparklesIcon,
    default: Sparkles
};

/**
 * Single effect item in the effects list
 */
const EffectItem = ({
    effect,
    isExpanded,
    onToggle,
    onRemove,
    onExpandToggle,
    onUpdateParams,
    onAddKeyframe,
    playhead
}) => {
    const { getDefinition } = useEffectRegistry();
    const definition = getDefinition(effect.type);

    const Icon = CATEGORY_ICONS[definition?.category] || CATEGORY_ICONS.default;

    return (
        <div className={`
            border border-border rounded-lg overflow-hidden transition-all
            ${effect.enabled ? 'bg-card' : 'bg-card/50 opacity-60'}
        `}>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5"
                onClick={() => onExpandToggle(effect.id)}>
                <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />

                <Icon className="w-4 h-4 text-primary" />

                <span className="flex-1 text-sm font-medium truncate">
                    {definition?.name || effect.type}
                </span>

                <div className="flex items-center gap-1">
                    {/* Engine badge */}
                    <span className={`
                        text-[10px] px-1.5 py-0.5 rounded font-mono uppercase
                        ${effect.engine === 'gpu' ? 'bg-green-500/20 text-green-400' :
                            effect.engine === 'ai' ? 'bg-purple-500/20 text-purple-400' :
                                'bg-blue-500/20 text-blue-400'}
                    `}>
                        {effect.engine || 'gpu'}
                    </span>

                    {/* Toggle enabled */}
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggle(effect.id, !effect.enabled); }}
                        className="p-1 hover:bg-white/10 rounded"
                    >
                        {effect.enabled ?
                            <Eye className="w-4 h-4 text-muted-foreground" /> :
                            <EyeOff className="w-4 h-4 text-muted-foreground/50" />
                        }
                    </button>

                    {/* Remove */}
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(effect.id); }}
                        className="p-1 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-400"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>

                    {/* Expand/collapse */}
                    {isExpanded ?
                        <ChevronDown className="w-4 h-4 text-muted-foreground" /> :
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    }
                </div>
            </div>

            {/* Expanded controls */}
            {isExpanded && (
                <div className="border-t border-border p-3 bg-black/20">
                    <EffectControls
                        effect={effect}
                        definition={definition}
                        onUpdateParams={onUpdateParams}
                        onAddKeyframe={onAddKeyframe}
                        playhead={playhead}
                    />
                </div>
            )}
        </div>
    );
};

/**
 * Add effect dropdown/modal
 */
const AddEffectMenu = ({ onAdd, onClose }) => {
    const [search, setSearch] = useState('');
    const { categories, getByCategory, search: searchEffects } = useEffectRegistry();

    const filteredCategories = useMemo(() => {
        if (!search) return categories;

        const results = searchEffects(search);
        const grouped = {};

        results.forEach(([type, def]) => {
            const cat = def.category || 'other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push([type, def]);
        });

        return grouped;
    }, [search, categories, searchEffects]);

    return (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-2xl overflow-hidden max-h-[400px] flex flex-col">
            {/* Search */}
            <div className="p-3 border-b border-border">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search effects..."
                        className="w-full bg-secondary border border-border rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        autoFocus
                    />
                    <button
                        onClick={onClose}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Categories */}
            <div className="overflow-y-auto flex-1 p-2">
                {Object.entries(filteredCategories).map(([category, effects]) => {
                    const Icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.default;

                    return (
                        <div key={category} className="mb-3">
                            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground uppercase tracking-wider">
                                <Icon className="w-3 h-3" />
                                {category}
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                {(Array.isArray(effects) ? effects : Object.entries(effects)).map(([type, def]) => (
                                    <button
                                        key={type}
                                        onClick={() => { onAdd(type); onClose(); }}
                                        className="flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg hover:bg-white/5 transition-colors"
                                    >
                                        <span className="flex-1 truncate">{def.name}</span>
                                        <span className={`
                                            text-[9px] px-1 py-0.5 rounded font-mono uppercase
                                            ${def.engine === 'gpu' ? 'bg-green-500/20 text-green-400' :
                                                def.engine === 'ai' ? 'bg-purple-500/20 text-purple-400' :
                                                    'bg-blue-500/20 text-blue-400'}
                                        `}>
                                            {def.engine || 'gpu'}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/**
 * Main Effects Panel
 */
const EffectsPanel = ({
    targetId,
    playbackEngine,
    playhead = 0,
    className = ''
}) => {
    const [expandedEffects, setExpandedEffects] = useState(new Set());
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [showPresets, setShowPresets] = useState(false);

    const {
        effects,
        addEffect,
        removeEffect,
        updateEffectParams,
        toggleEffect,
        addKeyframe,
        reorderEffects,
        clearEffects
    } = useEffects(targetId, { playbackEngine });

    const handleExpandToggle = (effectId) => {
        setExpandedEffects(prev => {
            const next = new Set(prev);
            if (next.has(effectId)) {
                next.delete(effectId);
            } else {
                next.add(effectId);
            }
            return next;
        });
    };

    const handleAddEffect = (type) => {
        const newEffect = addEffect(type);
        if (newEffect) {
            setExpandedEffects(prev => new Set([...prev, newEffect.id]));
        }
    };

    // No target selected
    if (!targetId) {
        return (
            <div className={`flex flex-col items-center justify-center h-full text-muted-foreground ${className}`}>
                <Sparkles className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">Select a clip to add effects</p>
            </div>
        );
    }

    return (
        <div className={`flex flex-col h-full ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-sm">Effects</h3>
                    {effects.length > 0 && (
                        <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-mono">
                            {effects.length}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    {/* Presets button */}
                    <button
                        onClick={() => setShowPresets(!showPresets)}
                        className={`p-2 rounded-lg transition-colors ${showPresets ? 'bg-primary/20 text-primary' : 'hover:bg-white/5'}`}
                        title="Browse Presets"
                    >
                        <Wand2 className="w-4 h-4" />
                    </button>

                    {/* Clear all */}
                    {effects.length > 0 && (
                        <button
                            onClick={clearEffects}
                            className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Clear All Effects"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {showPresets ? (
                    <PresetBrowser
                        targetId={targetId}
                        playbackEngine={playbackEngine}
                        onClose={() => setShowPresets(false)}
                    />
                ) : (
                    <div className="p-4 space-y-2">
                        {/* Effects list */}
                        {effects.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <Grid3X3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">No effects applied</p>
                                <p className="text-xs opacity-60 mt-1">Click + to add an effect</p>
                            </div>
                        ) : (
                            effects.map(effect => (
                                <EffectItem
                                    key={effect.id}
                                    effect={effect}
                                    isExpanded={expandedEffects.has(effect.id)}
                                    onToggle={toggleEffect}
                                    onRemove={removeEffect}
                                    onExpandToggle={handleExpandToggle}
                                    onUpdateParams={updateEffectParams}
                                    onAddKeyframe={addKeyframe}
                                    playhead={playhead}
                                />
                            ))
                        )}

                        {/* Add effect button */}
                        <div className="relative">
                            <button
                                onClick={() => setShowAddMenu(!showAddMenu)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground hover:text-primary"
                            >
                                <Plus className="w-5 h-5" />
                                <span className="text-sm font-medium">Add Effect</span>
                            </button>

                            {showAddMenu && (
                                <AddEffectMenu
                                    onAdd={handleAddEffect}
                                    onClose={() => setShowAddMenu(false)}
                                />
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Footer info */}
            <div className="px-4 py-2 border-t border-border bg-black/20">
                <p className="text-[10px] text-muted-foreground">
                    💡 Tip: GPU effects render in real-time. AI effects may take a moment to analyze.
                </p>
            </div>
        </div>
    );
};

export default EffectsPanel;
