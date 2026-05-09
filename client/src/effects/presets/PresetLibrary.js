/**
 * PresetLibrary.js
 * Built-in effect presets for Viral Pilot (CapCut / After Effects style).
 * 
 * Provides ready-to-use effect combinations organized by category.
 */

import { EffectPreset, PRESET_CATEGORIES } from './EffectPreset.js';

// ============================================================================
// BUILT-IN PRESETS
// ============================================================================

export const BUILTIN_PRESETS = [
    // ========================================================================
    // COLOR PRESETS
    // ========================================================================
    {
        id: 'preset-cinematic-orange-teal',
        name: 'Cinematic Orange & Teal',
        description: 'Classic cinematic color grading with warm highlights and cool shadows',
        category: PRESET_CATEGORIES.COLOR,
        author: 'Vibed',
        tags: ['cinematic', 'film', 'professional'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    brightness: { value: 105 },
                    contrast: { value: 110 },
                    saturation: { value: 115 },
                    temperature: { value: 15 },
                    tint: { value: -5 }
                }
            },
            {
                type: 'vignette',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.35 },
                    radius: { value: 0.75 },
                    softness: { value: 0.6 }
                }
            }
        ],
        controls: [
            { id: 'warmth', param: 'effects[0].params.temperature', label: 'Warmth', min: -50, max: 50 },
            { id: 'vignette', param: 'effects[1].params.intensity', label: 'Vignette', min: 0, max: 1 }
        ]
    },

    {
        id: 'preset-vintage-film',
        name: 'Vintage Film',
        description: 'Nostalgic film look with faded blacks and grain',
        category: PRESET_CATEGORIES.COLOR,
        author: 'Vibed',
        tags: ['vintage', 'retro', 'film'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    brightness: { value: 95 },
                    contrast: { value: 85 },
                    saturation: { value: 80 },
                    hueRotate: { value: 5 }
                }
            },
            {
                type: 'film_grain',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.2 },
                    size: { value: 2.0 }
                }
            },
            {
                type: 'vignette',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.4 },
                    radius: { value: 0.8 }
                }
            }
        ],
        controls: [
            { id: 'grain', param: 'effects[1].params.intensity', label: 'Grain Amount', min: 0, max: 0.5 },
            { id: 'fade', param: 'effects[0].params.contrast', label: 'Fade', min: 60, max: 100 }
        ]
    },

    {
        id: 'preset-b&w-dramatic',
        name: 'Dramatic B&W',
        description: 'High contrast black and white with dramatic tones',
        category: PRESET_CATEGORIES.COLOR,
        author: 'Vibed',
        tags: ['black and white', 'dramatic', 'contrast'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    saturation: { value: 0 },
                    contrast: { value: 130 },
                    brightness: { value: 105 }
                }
            },
            {
                type: 'vignette',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.5 },
                    radius: { value: 0.65 }
                }
            }
        ],
        controls: [
            { id: 'contrast', param: 'effects[0].params.contrast', label: 'Contrast', min: 80, max: 180 }
        ]
    },

    // ========================================================================
    // BLUR PRESETS
    // ========================================================================
    {
        id: 'preset-dream-blur',
        name: 'Dream Blur',
        description: 'Soft dreamy look with subtle bloom',
        category: PRESET_CATEGORIES.BLUR,
        author: 'Vibed',
        tags: ['dream', 'soft', 'romantic'],
        effects: [
            {
                type: 'blur_gaussian',
                engine: 'gpu',
                params: {
                    radius: { value: 3 },
                    quality: { value: 16 }
                }
            },
            {
                type: 'glow',
                engine: 'gpu',
                params: {
                    threshold: { value: 0.5 },
                    intensity: { value: 0.4 },
                    radius: { value: 15 }
                }
            }
        ],
        controls: [
            { id: 'blur', param: 'effects[0].params.radius', label: 'Blur Amount', min: 0, max: 10 },
            { id: 'glow', param: 'effects[1].params.intensity', label: 'Glow', min: 0, max: 1 }
        ]
    },

    {
        id: 'preset-focus-pull',
        name: 'Focus Pull',
        description: 'Radial blur for focus effect',
        category: PRESET_CATEGORIES.BLUR,
        author: 'Vibed',
        tags: ['focus', 'depth', 'blur'],
        effects: [
            {
                type: 'blur_radial',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.3 },
                    centerX: { value: 0.5 },
                    centerY: { value: 0.5 },
                    samples: { value: 32 }
                }
            }
        ],
        controls: [
            { id: 'blur', param: 'effects[0].params.intensity', label: 'Blur Amount', min: 0, max: 0.8 },
            { id: 'focusX', param: 'effects[0].params.centerX', label: 'Focus X', min: 0, max: 1 },
            { id: 'focusY', param: 'effects[0].params.centerY', label: 'Focus Y', min: 0, max: 1 }
        ]
    },

    {
        id: 'preset-motion-trail',
        name: 'Speed Motion',
        description: 'Fast motion blur effect',
        category: PRESET_CATEGORIES.BLUR,
        author: 'Vibed',
        tags: ['motion', 'speed', 'action'],
        effects: [
            {
                type: 'blur_motion',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.6 },
                    angle: { value: 0 },
                    samples: { value: 24 }
                }
            }
        ],
        controls: [
            { id: 'speed', param: 'effects[0].params.intensity', label: 'Speed', min: 0, max: 1 },
            { id: 'direction', param: 'effects[0].params.angle', label: 'Direction', min: 0, max: 360 }
        ]
    },

    // ========================================================================
    // GLITCH PRESETS
    // ========================================================================
    {
        id: 'preset-vhs-glitch',
        name: 'VHS Glitch',
        description: 'Retro VHS tape distortion',
        category: PRESET_CATEGORIES.GLITCH,
        author: 'Vibed',
        tags: ['vhs', 'retro', 'analog'],
        effects: [
            {
                type: 'glitch',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.3 },
                    blockSize: { value: 24 },
                    colorShift: { value: true },
                    scanlines: { value: true }
                }
            },
            {
                type: 'rgb_split',
                engine: 'gpu',
                params: {
                    amount: { value: 3 },
                    angle: { value: 0 }
                }
            },
            {
                type: 'film_grain',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.15 },
                    size: { value: 1.5 }
                }
            }
        ],
        controls: [
            { id: 'glitch', param: 'effects[0].params.intensity', label: 'Glitch Amount', min: 0, max: 1 }
        ]
    },

    {
        id: 'preset-digital-corruption',
        name: 'Digital Corruption',
        description: 'Heavy digital artifact effect',
        category: PRESET_CATEGORIES.GLITCH,
        author: 'Vibed',
        tags: ['digital', 'glitch', 'corrupt'],
        effects: [
            {
                type: 'glitch',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.6 },
                    blockSize: { value: 48 },
                    colorShift: { value: true },
                    scanlines: { value: false }
                }
            },
            {
                type: 'rgb_split',
                engine: 'gpu',
                params: {
                    amount: { value: 15 },
                    angle: { value: 45 }
                }
            }
        ],
        controls: [
            { id: 'intensity', param: 'effects[0].params.intensity', label: 'Corruption', min: 0, max: 1 },
            { id: 'split', param: 'effects[1].params.amount', label: 'RGB Split', min: 0, max: 30 }
        ]
    },

    {
        id: 'preset-chromatic-aberration',
        name: 'Chromatic Aberration',
        description: 'Lens-like color fringing',
        category: PRESET_CATEGORIES.GLITCH,
        author: 'Vibed',
        tags: ['chromatic', 'lens', 'color'],
        effects: [
            {
                type: 'rgb_split',
                engine: 'gpu',
                params: {
                    amount: { value: 8 },
                    angle: { value: 0 },
                    centerX: { value: 0.5 },
                    centerY: { value: 0.5 }
                }
            }
        ],
        controls: [
            { id: 'amount', param: 'effects[0].params.amount', label: 'Amount', min: 0, max: 25 }
        ]
    },

    // ========================================================================
    // LIGHT PRESETS
    // ========================================================================
    {
        id: 'preset-golden-hour',
        name: 'Golden Hour',
        description: 'Warm sunset glow effect',
        category: PRESET_CATEGORIES.LIGHT,
        author: 'Vibed',
        tags: ['golden', 'sunset', 'warm'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    temperature: { value: 40 },
                    brightness: { value: 110 },
                    saturation: { value: 120 }
                }
            },
            {
                type: 'glow',
                engine: 'gpu',
                params: {
                    threshold: { value: 0.6 },
                    intensity: { value: 0.5 },
                    radius: { value: 20 },
                    color: { value: [1.0, 0.9, 0.7] }
                }
            }
        ],
        controls: [
            { id: 'warmth', param: 'effects[0].params.temperature', label: 'Warmth', min: 0, max: 80 },
            { id: 'glow', param: 'effects[1].params.intensity', label: 'Glow', min: 0, max: 1 }
        ]
    },

    {
        id: 'preset-neon-glow',
        name: 'Neon Glow',
        description: 'Vibrant neon light effect',
        category: PRESET_CATEGORIES.LIGHT,
        author: 'Vibed',
        tags: ['neon', 'glow', 'vibrant'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    saturation: { value: 150 },
                    contrast: { value: 115 }
                }
            },
            {
                type: 'glow',
                engine: 'gpu',
                params: {
                    threshold: { value: 0.4 },
                    intensity: { value: 0.8 },
                    radius: { value: 25 },
                    color: { value: [1.0, 0.2, 0.8] }
                }
            }
        ],
        controls: [
            { id: 'glow', param: 'effects[1].params.intensity', label: 'Glow Intensity', min: 0, max: 2 }
        ]
    },

    // ========================================================================
    // TRANSFORM PRESETS
    // ========================================================================
    {
        id: 'preset-earthquake',
        name: 'Earthquake Shake',
        description: 'Intense camera shake effect',
        category: PRESET_CATEGORIES.TRANSFORM,
        author: 'Vibed',
        tags: ['shake', 'impact', 'action'],
        effects: [
            {
                type: 'shake',
                engine: 'gpu',
                params: {
                    intensity: { value: 20 },
                    frequency: { value: 25 },
                    rotationAmount: { value: 3 }
                }
            }
        ],
        controls: [
            { id: 'intensity', param: 'effects[0].params.intensity', label: 'Shake', min: 0, max: 50 },
            { id: 'speed', param: 'effects[0].params.frequency', label: 'Speed', min: 5, max: 60 }
        ]
    },

    {
        id: 'preset-subtle-handheld',
        name: 'Handheld Feel',
        description: 'Subtle camera movement for realism',
        category: PRESET_CATEGORIES.TRANSFORM,
        author: 'Vibed',
        tags: ['handheld', 'natural', 'subtle'],
        effects: [
            {
                type: 'shake',
                engine: 'gpu',
                params: {
                    intensity: { value: 3 },
                    frequency: { value: 8 },
                    rotationAmount: { value: 0.5 }
                }
            }
        ],
        controls: [
            { id: 'intensity', param: 'effects[0].params.intensity', label: 'Amount', min: 0, max: 10 }
        ]
    },

    // ========================================================================
    // CINEMATIC PRESETS
    // ========================================================================
    {
        id: 'preset-movie-look',
        name: 'Hollywood Movie',
        description: 'Complete cinematic treatment',
        category: PRESET_CATEGORIES.CINEMATIC,
        author: 'Vibed',
        tags: ['movie', 'hollywood', 'professional'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    brightness: { value: 100 },
                    contrast: { value: 115 },
                    saturation: { value: 95 },
                    temperature: { value: 10 }
                }
            },
            {
                type: 'glow',
                engine: 'gpu',
                params: {
                    threshold: { value: 0.7 },
                    intensity: { value: 0.3 },
                    radius: { value: 12 }
                }
            },
            {
                type: 'vignette',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.4 },
                    radius: { value: 0.7 },
                    softness: { value: 0.5 }
                }
            },
            {
                type: 'film_grain',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.08 },
                    size: { value: 1.0 }
                }
            }
        ],
        controls: [
            { id: 'vignette', param: 'effects[2].params.intensity', label: 'Vignette', min: 0, max: 0.8 },
            { id: 'grain', param: 'effects[3].params.intensity', label: 'Film Grain', min: 0, max: 0.3 }
        ]
    },

    // ========================================================================
    // SOCIAL MEDIA PRESETS
    // ========================================================================
    {
        id: 'preset-tiktok-trendy',
        name: 'TikTok Trendy',
        description: 'Popular social media look',
        category: PRESET_CATEGORIES.SOCIAL,
        author: 'Vibed',
        tags: ['tiktok', 'social', 'trendy'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    saturation: { value: 125 },
                    contrast: { value: 110 },
                    brightness: { value: 105 }
                }
            },
            {
                type: 'rgb_split',
                engine: 'gpu',
                params: {
                    amount: { value: 2 },
                    angle: { value: 0 }
                }
            }
        ],
        controls: [
            { id: 'pop', param: 'effects[0].params.saturation', label: 'Color Pop', min: 80, max: 150 }
        ]
    },

    {
        id: 'preset-instagram-clean',
        name: 'Instagram Clean',
        description: 'Clean and bright aesthetic',
        category: PRESET_CATEGORIES.SOCIAL,
        author: 'Vibed',
        tags: ['instagram', 'clean', 'bright'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    brightness: { value: 108 },
                    contrast: { value: 95 },
                    saturation: { value: 90 },
                    temperature: { value: -5 }
                }
            }
        ],
        controls: [
            { id: 'brightness', param: 'effects[0].params.brightness', label: 'Brightness', min: 90, max: 120 }
        ]
    },

    // ========================================================================
    // TIKTOK VFX PRESETS (keyframe-driven)
    // ========================================================================
    {
        id: 'preset-tiktok-zoom-burst',
        name: '🔥 Zoom Burst',
        description: 'TikTok-style explosive zoom-in pop at the start of a clip',
        category: PRESET_CATEGORIES.SOCIAL,
        author: 'Vibed',
        tags: ['tiktok', 'zoom', 'burst', 'vfx', 'keyframe'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    saturation: { value: 130 },
                    contrast: { value: 115 },
                    brightness: { value: 108 }
                }
            },
            {
                type: 'blur_radial',
                engine: 'gpu',
                params: {
                    intensity: { value: 0.15 },
                    centerX: { value: 0.5 },
                    centerY: { value: 0.5 },
                    samples: { value: 16 }
                }
            }
        ],
        // Transform keyframes: scale goes 1.4 → 1.0 over first 0.3s (zoom burst pop)
        transformKeyframes: {
            scale: [
                { time: 0,    value: 1.4,  easing: 'easeOut' },
                { time: 0.3,  value: 1.0,  easing: 'linear' }
            ]
        },
        controls: [
            { id: 'pop', param: 'effects[0].params.saturation', label: 'Color Pop', min: 80, max: 180 }
        ]
    },

    {
        id: 'preset-tiktok-flash-hit',
        name: '⚡ Flash Hit',
        description: 'Rapid brightness flash on-beat — popular TikTok transition',
        category: PRESET_CATEGORIES.SOCIAL,
        author: 'Vibed',
        tags: ['tiktok', 'flash', 'beat', 'vfx', 'keyframe'],
        effects: [
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    brightness: { value: 250 },
                    contrast: { value: 100 },
                    saturation: { value: 100 }
                }
            }
        ],
        // Transform keyframes: opacity 0 → 1 spike then settle (flash reveal)
        transformKeyframes: {
            opacity: [
                { time: 0,    value: 0,    easing: 'linear' },
                { time: 0.08, value: 1,    easing: 'easeOut' },
                { time: 0.2,  value: 0.85, easing: 'linear' }
            ]
        },
        controls: [
            { id: 'flash', param: 'effects[0].params.brightness', label: 'Flash Power', min: 100, max: 400 }
        ]
    },

    {
        id: 'preset-tiktok-beat-shake',
        name: '🎵 Beat Shake',
        description: 'Rapid camera micro-shake synced to music beats',
        category: PRESET_CATEGORIES.SOCIAL,
        author: 'Viral Pilot',
        tags: ['tiktok', 'shake', 'beat', 'vfx', 'music'],
        effects: [
            {
                type: 'shake',
                engine: 'gpu',
                params: {
                    intensity: { value: 12 },
                    frequency: { value: 30 },
                    rotationAmount: { value: 1.5 }
                }
            },
            {
                type: 'color_grade',
                engine: 'gpu',
                params: {
                    saturation: { value: 118 },
                    contrast: { value: 108 }
                }
            }
        ],
        transformKeyframes: {
            rotation: [
                { time: 0,    value: 0,    easing: 'linear' },
                { time: 0.05, value: -3,   easing: 'easeOut' },
                { time: 0.1,  value: 3,    easing: 'easeIn' },
                { time: 0.15, value: 0,    easing: 'linear' }
            ]
        },
        controls: [
            { id: 'shake', param: 'effects[0].params.intensity', label: 'Shake Power', min: 0, max: 40 }
        ]
    }
];


// ============================================================================
// PRESET LIBRARY CLASS
// ============================================================================

export class PresetLibrary {
    constructor() {
        this.presets = new Map();
        this.categories = new Map();

        // Load built-in presets
        this._loadBuiltins();
    }

    _loadBuiltins() {
        for (const presetData of BUILTIN_PRESETS) {
            const preset = new EffectPreset({
                ...presetData,
                author: 'Viral Pilot'
            });
            this.addPreset(preset);
        }
    }

    // ========================================================================
    // PRESET MANAGEMENT
    // ========================================================================

    /**
     * Add preset to library
     */
    addPreset(preset) {
        if (!(preset instanceof EffectPreset)) {
            preset = new EffectPreset(preset);
        }

        this.presets.set(preset.id, preset);

        // Update category index
        if (!this.categories.has(preset.category)) {
            this.categories.set(preset.category, []);
        }
        this.categories.get(preset.category).push(preset.id);
    }

    /**
     * Remove preset from library
     */
    removePreset(presetId) {
        const preset = this.presets.get(presetId);
        if (!preset) return false;

        // Remove from category index
        const categoryPresets = this.categories.get(preset.category);
        if (categoryPresets) {
            const index = categoryPresets.indexOf(presetId);
            if (index !== -1) {
                categoryPresets.splice(index, 1);
            }
        }

        return this.presets.delete(presetId);
    }

    /**
     * Get preset by ID
     */
    getPreset(presetId) {
        return this.presets.get(presetId);
    }

    /**
     * Get all presets
     */
    getAllPresets() {
        return Array.from(this.presets.values());
    }

    /**
     * Get presets by category
     */
    getByCategory(category) {
        const ids = this.categories.get(category) || [];
        return ids.map(id => this.presets.get(id)).filter(Boolean);
    }

    /**
     * Get categorized presets
     */
    getCategorized() {
        const result = {};
        for (const [category, ids] of this.categories) {
            result[category] = ids.map(id => this.presets.get(id)).filter(Boolean);
        }
        return result;
    }

    /**
     * Search presets
     */
    search(query) {
        const lowerQuery = query.toLowerCase();
        return this.getAllPresets().filter(preset =>
            preset.name.toLowerCase().includes(lowerQuery) ||
            preset.description.toLowerCase().includes(lowerQuery) ||
            preset.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
        );
    }

    /**
     * Get presets by tag
     */
    getByTag(tag) {
        return this.getAllPresets().filter(preset =>
            preset.tags.includes(tag.toLowerCase())
        );
    }

    // ========================================================================
    // USER PRESETS
    // ========================================================================

    /**
     * Save user preset to storage
     */
    saveUserPreset(preset) {
        const userPresets = this._loadUserPresets();
        userPresets[preset.id] = preset.serialize();
        localStorage.setItem('vp_user_presets', JSON.stringify(userPresets));

        // Add to library
        this.addPreset(preset);
    }

    /**
     * Load user presets from storage
     */
    loadUserPresets() {
        const userPresets = this._loadUserPresets();

        for (const data of Object.values(userPresets)) {
            const preset = EffectPreset.deserialize(data);
            this.addPreset(preset);
        }
    }

    _loadUserPresets() {
        try {
            const data = localStorage.getItem('vp_user_presets');
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    /**
     * Delete user preset
     */
    deleteUserPreset(presetId) {
        const userPresets = this._loadUserPresets();
        delete userPresets[presetId];
        localStorage.setItem('vp_user_presets', JSON.stringify(userPresets));

        this.removePreset(presetId);
    }

    // ========================================================================
    // IMPORT/EXPORT
    // ========================================================================

    /**
     * Export preset to file
     */
    exportPreset(presetId) {
        const preset = this.presets.get(presetId);
        if (!preset) return null;

        return preset.toJSON();
    }

    /**
     * Import preset from file content
     */
    importPreset(jsonContent) {
        const preset = EffectPreset.fromJSON(jsonContent);

        // Generate new ID to avoid conflicts
        preset.id = `preset-imported-${Date.now()}`;

        this.addPreset(preset);
        this.saveUserPreset(preset);

        return preset;
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const presetLibrary = new PresetLibrary();

export default presetLibrary;
