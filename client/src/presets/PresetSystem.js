/**
 * PresetSystem - JSON Preset Manager for Viral Pilot
 * 
 * Manages export/import of editing presets.
 * 
 * Features:
 * - Load/Save presets from JSON
 * - Versioned schema for compatibility
 * - Composable presets
 * - Marketplace-ready structure
 */

// Preset schema version
export const PRESET_SCHEMA_VERSION = '1.0';

// Preset categories
export const PRESET_CATEGORIES = {
    COLOR: 'color',
    EFFECTS: 'effects',
    TRANSITIONS: 'transitions',
    AUDIO: 'audio',
    TEXT: 'text',
    COMPOSITE: 'composite'
};

// Built-in presets
const BUILT_IN_PRESETS = [
    {
        id: 'cinematic-teal-orange',
        name: 'Cinematic Teal & Orange',
        version: PRESET_SCHEMA_VERSION,
        category: PRESET_CATEGORIES.COLOR,
        description: 'Classic Hollywood color grade with teal shadows and orange highlights',
        author: 'Viral Pilot',
        compatibility: ['webgl', 'ffmpeg'],
        operations: [
            {
                type: 'color_grade',
                params: {
                    lift: [0.0, -0.05, 0.1],      // Blue lift in shadows
                    gamma: [1.0, 1.0, 0.95],     // Slight warmth
                    gain: [1.1, 0.95, 0.85]      // Orange highlights
                }
            },
            {
                type: 'contrast',
                params: { value: 1.15 }
            },
            {
                type: 'saturation',
                params: { value: 1.1 }
            }
        ]
    },
    {
        id: 'viral-high-energy',
        name: 'Viral High Energy',
        version: PRESET_SCHEMA_VERSION,
        category: PRESET_CATEGORIES.COMPOSITE,
        description: 'Punchy, high-saturation look for social media',
        author: 'Viral Pilot',
        compatibility: ['webgl', 'ffmpeg'],
        operations: [
            {
                type: 'contrast',
                params: { value: 1.25 }
            },
            {
                type: 'saturation',
                params: { value: 1.3 }
            },
            {
                type: 'sharpen',
                params: { value: 0.3 }
            },
            {
                type: 'vignette',
                params: { intensity: 0.2 }
            }
        ]
    },
    {
        id: 'moody-dark',
        name: 'Moody Dark',
        version: PRESET_SCHEMA_VERSION,
        category: PRESET_CATEGORIES.COLOR,
        description: 'Low-key dramatic look with crushed blacks',
        author: 'Viral Pilot',
        compatibility: ['webgl', 'ffmpeg'],
        operations: [
            {
                type: 'color_grade',
                params: {
                    lift: [-0.1, -0.1, -0.05],
                    gamma: [0.95, 0.95, 1.0],
                    gain: [0.9, 0.85, 0.95]
                }
            },
            {
                type: 'contrast',
                params: { value: 1.3 }
            },
            {
                type: 'brightness',
                params: { value: -0.1 }
            }
        ]
    },
    {
        id: 'vintage-film',
        name: 'Vintage Film',
        version: PRESET_SCHEMA_VERSION,
        category: PRESET_CATEGORIES.COLOR,
        description: 'Nostalgic film look with faded blacks and warm tones',
        author: 'Viral Pilot',
        compatibility: ['webgl', 'ffmpeg'],
        operations: [
            {
                type: 'color_grade',
                params: {
                    lift: [0.05, 0.03, 0.0],
                    gamma: [1.05, 1.0, 0.95],
                    gain: [1.0, 0.95, 0.85]
                }
            },
            {
                type: 'fade_blacks',
                params: { value: 0.1 }
            },
            {
                type: 'grain',
                params: { intensity: 0.15 }
            }
        ]
    },
    {
        id: 'clean-corporate',
        name: 'Clean Corporate',
        version: PRESET_SCHEMA_VERSION,
        category: PRESET_CATEGORIES.COLOR,
        description: 'Clean, professional look for business content',
        author: 'Viral Pilot',
        compatibility: ['webgl', 'ffmpeg'],
        operations: [
            {
                type: 'white_balance',
                params: { temperature: 5500 }
            },
            {
                type: 'contrast',
                params: { value: 1.05 }
            },
            {
                type: 'saturation',
                params: { value: 0.95 }
            },
            {
                type: 'sharpen',
                params: { value: 0.2 }
            }
        ]
    },
    {
        id: 'audio-podcast',
        name: 'Podcast Audio',
        version: PRESET_SCHEMA_VERSION,
        category: PRESET_CATEGORIES.AUDIO,
        description: 'Optimized audio settings for podcast/voice content',
        author: 'Viral Pilot',
        compatibility: ['ffmpeg'],
        operations: [
            {
                type: 'audio_normalize',
                params: { target: -16 }
            },
            {
                type: 'audio_compressor',
                params: { ratio: 4, threshold: -20 }
            },
            {
                type: 'audio_eq',
                params: {
                    lowcut: 80,
                    presence: { freq: 3000, gain: 2 }
                }
            }
        ]
    }
];

const STORAGE_KEY = 'vp_user_presets_v1';

class PresetSystemClass {
    constructor() {
        this.userPresets = new Map();
        this.builtInPresets = new Map();
        BUILT_IN_PRESETS.forEach(p => this.builtInPresets.set(p.id, p));
        this._loadFromStorage();
    }

    _loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            saved.forEach(p => this.userPresets.set(p.id, p));
            console.log(`[PresetSystem] Loaded ${saved.length} preset(s) from localStorage`);
        } catch (e) {
            console.warn('[PresetSystem] Could not load presets from localStorage:', e);
        }
    }

    _saveToStorage() {
        try {
            const arr = Array.from(this.userPresets.values());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
        } catch (e) {
            console.warn('[PresetSystem] Could not save presets to localStorage:', e);
        }
    }

    /**
     * Get all available presets
     * @param {string} category - Optional filter by category
     * @returns {Array} List of presets
     */
    getAll(category = null) {
        const all = [
            ...Array.from(this.builtInPresets.values()),
            ...Array.from(this.userPresets.values())
        ];

        if (category) {
            return all.filter(p => p.category === category);
        }

        return all;
    }

    /**
     * Get a preset by ID
     * @param {string} id
     * @returns {object|null}
     */
    get(id) {
        return this.userPresets.get(id) || this.builtInPresets.get(id) || null;
    }

    /**
     * Get a preset by name (case-insensitive)
     * @param {string} name
     * @returns {object|null}
     */
    getByName(name) {
        const lowerName = name.toLowerCase();

        for (const preset of this.builtInPresets.values()) {
            if (preset.name.toLowerCase() === lowerName ||
                preset.id.toLowerCase() === lowerName) {
                return preset;
            }
        }

        for (const preset of this.userPresets.values()) {
            if (preset.name.toLowerCase() === lowerName ||
                preset.id.toLowerCase() === lowerName) {
                return preset;
            }
        }

        return null;
    }

    /**
     * Create a new user preset
     * @param {string} name
     * @param {Array} operations
     * @param {object} options
     * @returns {object} Created preset
     */
    create(name, operations, options = {}) {
        const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        const preset = {
            id,
            name,
            version: PRESET_SCHEMA_VERSION,
            category: options.category || PRESET_CATEGORIES.COMPOSITE,
            description: options.description || '',
            author: options.author || 'User',
            compatibility: options.compatibility || ['webgl', 'ffmpeg'],
            operations,
            createdAt: Date.now(),
            isUserPreset: true
        };

        this.userPresets.set(id, preset);
        this._saveToStorage();
        console.log(`[PresetSystem] Created preset: ${name} (${id})`);
        return preset;
    }

    /**
     * Delete a user preset
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
        if (this.builtInPresets.has(id)) {
            console.warn('[PresetSystem] Cannot delete built-in preset');
            return false;
        }
        const deleted = this.userPresets.delete(id);
        if (deleted) this._saveToStorage();
        return deleted;
    }

    /**
     * Import a preset from JSON
     * @param {string|object} json
     * @returns {object} Imported preset
     */
    import(json) {
        const preset = typeof json === 'string' ? JSON.parse(json) : json;

        // Validate schema version
        if (!preset.version) {
            preset.version = PRESET_SCHEMA_VERSION;
        }

        // Generate new ID for imported preset
        preset.id = `imported_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        preset.isUserPreset = true;
        preset.importedAt = Date.now();

        this.userPresets.set(preset.id, preset);
        this._saveToStorage();
        console.log(`[PresetSystem] Imported preset: ${preset.name}`);
        return preset;
    }

    /**
     * Export ALL user presets as a bundle JSON
     */
    exportAll() {
        const bundle = {
            version: PRESET_SCHEMA_VERSION,
            exportedAt: Date.now(),
            presets: Array.from(this.userPresets.values())
        };
        return JSON.stringify(bundle, null, 2);
    }

    /**
     * Import a bundle (exported from exportAll)
     * @param {string|object} json
     * @returns {number} count of imported presets
     */
    importBundle(json) {
        const bundle = typeof json === 'string' ? JSON.parse(json) : json;
        const presets = bundle.presets || (Array.isArray(bundle) ? bundle : []);
        let count = 0;
        presets.forEach(p => { this.import(p); count++; });
        console.log(`[PresetSystem] Bundle imported: ${count} preset(s)`);
        return count;
    }

    /**
     * Get marketplace presets (static curated list for now, API later)
     */
    async getMarketplacePresets() {
        try {
            const res = await fetch('/api/presets/marketplace');
            if (res.ok) return await res.json();
        } catch (_) {}
        // Fallback to built-ins
        return Array.from(this.builtInPresets.values());
    }

    /**
     * Export a preset to JSON
     * @param {string} id
     * @returns {string} JSON string
     */
    export(id) {
        const preset = this.get(id);
        if (!preset) {
            throw new Error(`Preset not found: ${id}`);
        }

        // Create export copy without internal fields
        const exportPreset = {
            name: preset.name,
            version: preset.version,
            category: preset.category,
            description: preset.description,
            author: preset.author,
            compatibility: preset.compatibility,
            operations: preset.operations
        };

        return JSON.stringify(exportPreset, null, 2);
    }

    /**
     * Apply a preset to get operations for CommandCompiler
     * @param {string} idOrName
     * @param {object} context - Editor context
     * @returns {Array} List of operations to execute
     */
    apply(idOrName, context = {}) {
        const preset = this.get(idOrName) || this.getByName(idOrName);

        if (!preset) {
            throw new Error(`Preset not found: ${idOrName}`);
        }

        console.log(`[PresetSystem] Applying preset: ${preset.name}`);

        // Return operations with context injected
        return preset.operations.map(op => ({
            ...op,
            presetId: preset.id,
            presetName: preset.name,
            context
        }));
    }

    /**
     * Get preset categories
     */
    getCategories() {
        return Object.values(PRESET_CATEGORIES);
    }

    /**
     * Search presets by name/description
     * @param {string} query
     * @returns {Array}
     */
    search(query) {
        const lowerQuery = query.toLowerCase();
        return this.getAll().filter(p =>
            p.name.toLowerCase().includes(lowerQuery) ||
            p.description.toLowerCase().includes(lowerQuery)
        );
    }
}

// Singleton instance
export const PresetSystem = new PresetSystemClass();

export default PresetSystem;
