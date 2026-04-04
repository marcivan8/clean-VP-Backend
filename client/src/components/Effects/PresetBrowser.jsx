/**
 * PresetBrowser.jsx
 * Browse, search, and apply effect presets.
 */

import React, { useState, useMemo } from 'react';
import {
    Search,
    X,
    Star,
    StarOff,
    Check,
    Palette,
    Waves,
    Zap,
    Sun,
    Move3D,
    Film,
    Sparkles,
    Download,
    Upload,
    Bookmark,
    Play
} from 'lucide-react';
import { usePresets } from '../../hooks/useEffects';

// Category icons
const CATEGORY_ICONS = {
    Color: Palette,
    Blur: Waves,
    Glitch: Zap,
    Light: Sun,
    Transform: Move3D,
    Cinematic: Film,
    Social: Sparkles,
    User: Bookmark,
    default: Sparkles
};

/**
 * Single preset card
 */
const PresetCard = ({
    preset,
    onApply,
    onFavorite,
    isFavorite = false,
    isApplied = false
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const Icon = CATEGORY_ICONS[preset.category] || CATEGORY_ICONS.default;

    // Preview colors from preset (for visual indicator)
    const previewColors = useMemo(() => {
        // Extract some colors from preset effects params for visual preview
        const colors = [];
        preset.effects?.forEach(effect => {
            if (effect.params?.color) {
                colors.push(effect.params.color);
            }
        });
        if (colors.length === 0) {
            // Default gradient based on category
            switch (preset.category) {
                case 'Color': return ['#ff6b35', '#008b8b'];
                case 'Blur': return ['#4a90d9', '#9b59b6'];
                case 'Glitch': return ['#ff0066', '#00ff66', '#0066ff'];
                case 'Light': return ['#ffd700', '#ff8c00'];
                case 'Cinematic': return ['#1a1a2e', '#eee'];
                case 'Social': return ['#ff3366', '#ff6b9d'];
                default: return ['#667eea', '#764ba2'];
            }
        }
        return colors;
    }, [preset]);

    const gradient = previewColors.length > 1
        ? `linear-gradient(135deg, ${previewColors.join(', ')})`
        : previewColors[0] || '#667eea';

    return (
        <div
            className={`
                relative group rounded-xl border overflow-hidden transition-all cursor-pointer
                ${isApplied ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50'}
            `}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => onApply(preset.id)}
        >
            {/* Preview gradient/thumbnail */}
            <div
                className="h-20 w-full"
                style={{ background: gradient }}
            >
                {/* Overlay with icon */}
                <div className="absolute inset-0 h-20 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition-colors">
                    <Icon className="w-8 h-8 text-white/70 group-hover:text-white transition-colors" />
                </div>

                {/* Applied badge */}
                {isApplied && (
                    <div className="absolute top-2 right-2 bg-primary text-white p-1 rounded-full">
                        <Check className="w-3 h-3" />
                    </div>
                )}

                {/* Favorite button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onFavorite?.(preset.id); }}
                    className="absolute top-2 left-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
                >
                    {isFavorite ?
                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" /> :
                        <StarOff className="w-3 h-3 text-white/70" />
                    }
                </button>

                {/* Play preview button */}
                {isHovered && (
                    <div className="absolute inset-0 h-20 flex items-center justify-center">
                        <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
                            <Play className="w-5 h-5 text-white fill-white" />
                        </div>
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="p-3 bg-card">
                <h4 className="text-sm font-medium truncate">{preset.name}</h4>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {preset.description || `${preset.effects?.length || 0} effects`}
                </p>

                {/* Tags */}
                {preset.tags && preset.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {preset.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-secondary rounded-full text-muted-foreground">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Category section with expandable grid
 */
const CategorySection = ({
    category,
    presets,
    onApply,
    onFavorite,
    favorites = [],
    appliedPresetIds = []
}) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const Icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.default;

    if (presets.length === 0) return null;

    return (
        <div className="mb-4">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-white/5 rounded-lg transition-colors"
            >
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium flex-1 text-left">{category}</span>
                <span className="text-xs text-muted-foreground">{presets.length}</span>
            </button>

            {isExpanded && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                    {presets.map(preset => (
                        <PresetCard
                            key={preset.id}
                            preset={preset}
                            onApply={onApply}
                            onFavorite={onFavorite}
                            isFavorite={favorites.includes(preset.id)}
                            isApplied={appliedPresetIds.includes(preset.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * Main Preset Browser component
 */
const PresetBrowser = ({
    targetId,
    playbackEngine,
    onClose
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('all'); // 'all', 'favorites', 'user'
    const [favorites, setFavorites] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('vp_preset_favorites') || '[]');
        } catch {
            return [];
        }
    });

    const {
        presets,
        categories,
        searchResults,
        search,
        applyPreset,
        saveUserPreset,
        deleteUserPreset
    } = usePresets();

    const handleSearch = (query) => {
        setSearchQuery(query);
        search(query);
    };

    const handleApply = (presetId) => {
        applyPreset(presetId, targetId);
        // Optionally close after apply
        // onClose?.();
    };

    const handleFavorite = (presetId) => {
        setFavorites(prev => {
            const next = prev.includes(presetId)
                ? prev.filter(id => id !== presetId)
                : [...prev, presetId];
            localStorage.setItem('vp_preset_favorites', JSON.stringify(next));
            return next;
        });
    };

    // Filter presets based on tab
    const displayedCategories = useMemo(() => {
        if (searchQuery && searchResults) {
            // Group search results by category
            const grouped = {};
            searchResults.forEach(preset => {
                const cat = preset.category || 'Other';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(preset);
            });
            return grouped;
        }

        if (activeTab === 'favorites') {
            const favPresets = presets.filter(p => favorites.includes(p.id));
            const grouped = {};
            favPresets.forEach(preset => {
                const cat = preset.category || 'Other';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(preset);
            });
            return grouped;
        }

        if (activeTab === 'user') {
            // Filter user-created presets
            const userPresets = presets.filter(p => p.id.startsWith('user-'));
            return { 'My Presets': userPresets };
        }

        return categories;
    }, [activeTab, categories, favorites, presets, searchQuery, searchResults]);

    // Get applied preset IDs from effects on target
    const appliedPresetIds = useMemo(() => {
        // This would need to check which presets are currently applied
        return [];
    }, [targetId]);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Effect Presets</h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/10 rounded"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        placeholder="Search presets..."
                        className="w-full bg-secondary border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mt-3">
                    {[
                        { key: 'all', label: 'All' },
                        { key: 'favorites', label: 'Favorites', icon: Star },
                        { key: 'user', label: 'My Presets', icon: Bookmark }
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`
                                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                                ${activeTab === tab.key
                                    ? 'bg-primary/20 text-primary'
                                    : 'hover:bg-white/5 text-muted-foreground'}
                            `}
                        >
                            {tab.icon && <tab.icon className="w-3 h-3" />}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {Object.keys(displayedCategories).length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No presets found</p>
                    </div>
                ) : (
                    Object.entries(displayedCategories).map(([category, categoryPresets]) => (
                        <CategorySection
                            key={category}
                            category={category}
                            presets={categoryPresets}
                            onApply={handleApply}
                            onFavorite={handleFavorite}
                            favorites={favorites}
                            appliedPresetIds={appliedPresetIds}
                        />
                    ))
                )}
            </div>

            {/* Footer actions */}
            <div className="px-4 py-3 border-t border-border flex gap-2">
                <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-secondary rounded-lg hover:bg-white/10 transition-colors text-sm">
                    <Download className="w-4 h-4" />
                    Import
                </button>
                <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-secondary rounded-lg hover:bg-white/10 transition-colors text-sm">
                    <Upload className="w-4 h-4" />
                    Export
                </button>
            </div>
        </div>
    );
};

export default PresetBrowser;
