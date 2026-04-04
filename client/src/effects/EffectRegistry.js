/**
 * EffectRegistry.js
 * Central registry of all available effect types for Viral Pilot.
 * 
 * Defines effect metadata, default params, and engine requirements.
 */

import { ENGINE_TYPES, PARAM_TYPES } from './EffectNode.js';

// ============================================================================
// EFFECT CATEGORIES
// ============================================================================

export const EFFECT_CATEGORIES = {
    COLOR: 'color',
    BLUR: 'blur',
    DISTORTION: 'distortion',
    STYLIZE: 'stylize',
    LIGHT: 'light',
    TRANSFORM: 'transform',
    TRANSITION: 'transition',
    AUDIO: 'audio',
    AI: 'ai'
};

// ============================================================================
// EFFECT DEFINITIONS
// ============================================================================

export const EFFECT_DEFINITIONS = {
    // ========================================================================
    // GPU EFFECTS (WebGL Shaders - Real-time)
    // ========================================================================

    // === Blur Effects ===
    blur_gaussian: {
        name: 'Gaussian Blur',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.BLUR,
        description: 'Smooth gaussian blur effect',
        icon: 'blur',
        params: {
            radius: {
                value: 5,
                min: 0,
                max: 50,
                step: 0.5,
                type: PARAM_TYPES.FLOAT,
                label: 'Blur Radius'
            },
            quality: {
                value: 8,
                min: 4,
                max: 32,
                step: 4,
                type: PARAM_TYPES.INT,
                label: 'Quality'
            }
        },
        shader: 'blur_gaussian'
    },

    blur_motion: {
        name: 'Motion Blur',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.BLUR,
        description: 'Directional motion blur',
        icon: 'move',
        params: {
            intensity: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            angle: {
                value: 0,
                min: 0,
                max: 360,
                type: PARAM_TYPES.ANGLE,
                label: 'Direction'
            },
            samples: {
                value: 16,
                min: 4,
                max: 64,
                step: 4,
                type: PARAM_TYPES.INT,
                label: 'Samples'
            }
        },
        shader: 'blur_motion'
    },

    blur_radial: {
        name: 'Radial Blur',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.BLUR,
        description: 'Zoom/radial blur from center',
        icon: 'target',
        params: {
            intensity: {
                value: 0.3,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            centerX: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Center X'
            },
            centerY: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Center Y'
            },
            samples: {
                value: 32,
                min: 8,
                max: 64,
                step: 8,
                type: PARAM_TYPES.INT,
                label: 'Samples'
            }
        },
        shader: 'blur_radial'
    },

    // === Light & Glow Effects ===
    glow: {
        name: 'Glow',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.LIGHT,
        description: 'Bloom/glow effect on bright areas',
        icon: 'sun',
        params: {
            threshold: {
                value: 0.7,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Threshold'
            },
            intensity: {
                value: 1.0,
                min: 0,
                max: 3,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            radius: {
                value: 10,
                min: 1,
                max: 50,
                type: PARAM_TYPES.FLOAT,
                label: 'Radius'
            },
            color: {
                value: [1.0, 1.0, 1.0],
                type: PARAM_TYPES.COLOR,
                label: 'Glow Color'
            }
        },
        shader: 'glow'
    },

    vignette: {
        name: 'Vignette',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.LIGHT,
        description: 'Radial edge darkening',
        icon: 'circle',
        params: {
            intensity: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            radius: {
                value: 0.7,
                min: 0.1,
                max: 1.5,
                type: PARAM_TYPES.FLOAT,
                label: 'Radius'
            },
            softness: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Softness'
            },
            color: {
                value: [0, 0, 0],
                type: PARAM_TYPES.COLOR,
                label: 'Color'
            }
        },
        shader: 'vignette'
    },

    // === Distortion Effects ===
    shake: {
        name: 'Camera Shake',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.DISTORTION,
        description: 'Simulated camera shake',
        icon: 'vibrate',
        params: {
            intensity: {
                value: 5,
                min: 0,
                max: 50,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            frequency: {
                value: 10,
                min: 1,
                max: 60,
                type: PARAM_TYPES.FLOAT,
                label: 'Frequency'
            },
            randomSeed: {
                value: 0,
                min: 0,
                max: 1000,
                type: PARAM_TYPES.INT,
                label: 'Random Seed'
            },
            rotationAmount: {
                value: 0,
                min: 0,
                max: 10,
                type: PARAM_TYPES.FLOAT,
                label: 'Rotation'
            }
        },
        shader: 'shake'
    },

    rgb_split: {
        name: 'RGB Split',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.DISTORTION,
        description: 'Chromatic aberration effect',
        icon: 'layers',
        params: {
            amount: {
                value: 5,
                min: 0,
                max: 50,
                type: PARAM_TYPES.FLOAT,
                label: 'Amount'
            },
            angle: {
                value: 0,
                min: 0,
                max: 360,
                type: PARAM_TYPES.ANGLE,
                label: 'Angle'
            },
            centerX: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Center X'
            },
            centerY: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Center Y'
            }
        },
        shader: 'rgb_split'
    },

    // === Stylize Effects ===
    film_grain: {
        name: 'Film Grain',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.STYLIZE,
        description: 'Procedural film grain overlay',
        icon: 'film',
        params: {
            intensity: {
                value: 0.15,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            size: {
                value: 1.5,
                min: 0.5,
                max: 5,
                type: PARAM_TYPES.FLOAT,
                label: 'Grain Size'
            },
            animated: {
                value: true,
                type: PARAM_TYPES.BOOL,
                label: 'Animated'
            }
        },
        shader: 'film_grain'
    },

    glitch: {
        name: 'Digital Glitch',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.STYLIZE,
        description: 'Digital glitch distortion',
        icon: 'zap',
        params: {
            intensity: {
                value: 0.3,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            blockSize: {
                value: 32,
                min: 4,
                max: 128,
                step: 4,
                type: PARAM_TYPES.INT,
                label: 'Block Size'
            },
            colorShift: {
                value: true,
                type: PARAM_TYPES.BOOL,
                label: 'Color Shift'
            },
            scanlines: {
                value: true,
                type: PARAM_TYPES.BOOL,
                label: 'Scanlines'
            }
        },
        shader: 'glitch'
    },

    // === Color Effects ===
    color_grade: {
        name: 'Color Grade',
        engine: ENGINE_TYPES.GPU,
        category: EFFECT_CATEGORIES.COLOR,
        description: 'Advanced color grading',
        icon: 'palette',
        params: {
            brightness: {
                value: 100,
                min: 0,
                max: 200,
                type: PARAM_TYPES.FLOAT,
                label: 'Brightness'
            },
            contrast: {
                value: 100,
                min: 0,
                max: 200,
                type: PARAM_TYPES.FLOAT,
                label: 'Contrast'
            },
            saturation: {
                value: 100,
                min: 0,
                max: 200,
                type: PARAM_TYPES.FLOAT,
                label: 'Saturation'
            },
            hueRotate: {
                value: 0,
                min: -180,
                max: 180,
                type: PARAM_TYPES.ANGLE,
                label: 'Hue Rotate'
            },
            temperature: {
                value: 0,
                min: -100,
                max: 100,
                type: PARAM_TYPES.FLOAT,
                label: 'Temperature'
            },
            tint: {
                value: 0,
                min: -100,
                max: 100,
                type: PARAM_TYPES.FLOAT,
                label: 'Tint'
            }
        },
        shader: 'color_grade'
    },

    // ========================================================================
    // CPU EFFECTS (FFmpeg - Final Render)
    // ========================================================================

    fade_in: {
        name: 'Fade In',
        engine: ENGINE_TYPES.CPU,
        category: EFFECT_CATEGORIES.TRANSITION,
        description: 'Fade from black/color',
        icon: 'sunrise',
        params: {
            duration: {
                value: 0.5,
                min: 0.1,
                max: 5,
                step: 0.1,
                type: PARAM_TYPES.FLOAT,
                label: 'Duration'
            },
            color: {
                value: [0, 0, 0],
                type: PARAM_TYPES.COLOR,
                label: 'Color'
            }
        },
        ffmpegFilter: (params, context) =>
            `fade=t=in:st=${context.startTime}:d=${params.duration}`
    },

    fade_out: {
        name: 'Fade Out',
        engine: ENGINE_TYPES.CPU,
        category: EFFECT_CATEGORIES.TRANSITION,
        description: 'Fade to black/color',
        icon: 'sunset',
        params: {
            duration: {
                value: 0.5,
                min: 0.1,
                max: 5,
                step: 0.1,
                type: PARAM_TYPES.FLOAT,
                label: 'Duration'
            },
            color: {
                value: [0, 0, 0],
                type: PARAM_TYPES.COLOR,
                label: 'Color'
            }
        },
        ffmpegFilter: (params, context) =>
            `fade=t=out:st=${context.endTime - params.duration}:d=${params.duration}`
    },

    speed_change: {
        name: 'Speed Change',
        engine: ENGINE_TYPES.CPU,
        category: EFFECT_CATEGORIES.TRANSFORM,
        description: 'Adjust playback speed',
        icon: 'clock',
        params: {
            speed: {
                value: 1.0,
                min: 0.1,
                max: 4.0,
                step: 0.1,
                type: PARAM_TYPES.FLOAT,
                label: 'Speed'
            },
            maintainPitch: {
                value: true,
                type: PARAM_TYPES.BOOL,
                label: 'Maintain Pitch'
            }
        },
        ffmpegFilter: (params) => {
            const pts = 1 / params.speed;
            const atempo = params.speed;
            return `setpts=${pts.toFixed(3)}*PTS,atempo=${atempo.toFixed(3)}`;
        }
    },

    lut_apply: {
        name: 'Apply LUT',
        engine: ENGINE_TYPES.CPU,
        category: EFFECT_CATEGORIES.COLOR,
        description: 'Apply color lookup table',
        icon: 'image',
        params: {
            lutFile: {
                value: '',
                type: PARAM_TYPES.FILE,
                label: 'LUT File'
            },
            intensity: {
                value: 1.0,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            }
        },
        ffmpegFilter: (params) =>
            params.lutFile ? `lut3d=${params.lutFile}` : null
    },

    // === Audio Effects ===
    audio_normalize: {
        name: 'Normalize Audio',
        engine: ENGINE_TYPES.CPU,
        category: EFFECT_CATEGORIES.AUDIO,
        description: 'Normalize audio levels',
        icon: 'volume-2',
        params: {
            targetLevel: {
                value: -3,
                min: -20,
                max: 0,
                type: PARAM_TYPES.FLOAT,
                label: 'Target dB'
            }
        },
        ffmpegFilter: (params) =>
            `loudnorm=I=${params.targetLevel}:TP=-1.5:LRA=11`
    },

    audio_denoise: {
        name: 'Denoise Audio',
        engine: ENGINE_TYPES.CPU,
        category: EFFECT_CATEGORIES.AUDIO,
        description: 'Remove background noise',
        icon: 'volume-x',
        params: {
            amount: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Amount'
            }
        },
        ffmpegFilter: (params) =>
            `afftdn=nf=${-20 + params.amount * 20}`
    },

    // ========================================================================
    // AI EFFECTS (API-driven)
    // ========================================================================

    smart_zoom: {
        name: 'Smart Zoom',
        engine: ENGINE_TYPES.AI,
        category: EFFECT_CATEGORIES.AI,
        description: 'AI-powered zoom tracking',
        icon: 'focus',
        params: {
            subject: {
                value: 'face',
                type: PARAM_TYPES.SELECT,
                options: ['face', 'speaker', 'action', 'center'],
                label: 'Track Subject'
            },
            zoomLevel: {
                value: 1.5,
                min: 1.0,
                max: 3.0,
                type: PARAM_TYPES.FLOAT,
                label: 'Zoom Level'
            },
            smoothness: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Smoothness'
            }
        },
        endpoint: '/api/effects/smart-zoom'
    },

    beat_sync: {
        name: 'Beat Sync',
        engine: ENGINE_TYPES.AI,
        category: EFFECT_CATEGORIES.AI,
        description: 'Sync effects to music beats',
        icon: 'music',
        params: {
            effectType: {
                value: 'zoom_pulse',
                type: PARAM_TYPES.SELECT,
                options: ['zoom_pulse', 'flash', 'shake', 'cut'],
                label: 'Effect Type'
            },
            intensity: {
                value: 0.5,
                min: 0,
                max: 1,
                type: PARAM_TYPES.FLOAT,
                label: 'Intensity'
            },
            beatDivision: {
                value: 1,
                type: PARAM_TYPES.SELECT,
                options: [0.25, 0.5, 1, 2, 4],
                label: 'Beat Division'
            }
        },
        endpoint: '/api/effects/beat-detect'
    },

    emotion_frame: {
        name: 'Emotion Framing',
        engine: ENGINE_TYPES.AI,
        category: EFFECT_CATEGORIES.AI,
        description: 'Frame based on emotional content',
        icon: 'smile',
        params: {
            framingStyle: {
                value: 'dynamic',
                type: PARAM_TYPES.SELECT,
                options: ['dynamic', 'tight', 'wide', 'cinematic'],
                label: 'Framing Style'
            },
            transitionSpeed: {
                value: 0.5,
                min: 0.1,
                max: 2,
                type: PARAM_TYPES.FLOAT,
                label: 'Transition Speed'
            }
        },
        endpoint: '/api/effects/emotion-frame'
    }
};

// ============================================================================
// EFFECT REGISTRY CLASS
// ============================================================================

class EffectRegistry {
    constructor() {
        this.definitions = new Map();
        this._registerBuiltins();
    }

    /**
     * Register built-in effects
     */
    _registerBuiltins() {
        for (const [type, definition] of Object.entries(EFFECT_DEFINITIONS)) {
            this.register(type, definition);
        }
    }

    /**
     * Register a new effect type
     */
    register(type, definition) {
        this.definitions.set(type, {
            type,
            ...definition
        });
    }

    /**
     * Unregister an effect type
     */
    unregister(type) {
        this.definitions.delete(type);
    }

    /**
     * Get effect definition by type
     */
    get(type) {
        return this.definitions.get(type);
    }

    /**
     * Check if effect type exists
     */
    has(type) {
        return this.definitions.has(type);
    }

    /**
     * Get all effect types
     */
    getAll() {
        return Array.from(this.definitions.values());
    }

    /**
     * Get effects by category
     */
    getByCategory(category) {
        return this.getAll().filter(def => def.category === category);
    }

    /**
     * Get effects by engine
     */
    getByEngine(engine) {
        return this.getAll().filter(def => def.engine === engine);
    }

    /**
     * Get all categories with their effects
     */
    getCategorized() {
        const result = {};
        for (const category of Object.values(EFFECT_CATEGORIES)) {
            result[category] = this.getByCategory(category);
        }
        return result;
    }

    /**
     * Create effect config from definition
     */
    createConfig(type, overrides = {}) {
        const definition = this.get(type);
        if (!definition) {
            throw new Error(`Unknown effect type: ${type}`);
        }

        return {
            type,
            name: definition.name,
            engine: definition.engine,
            params: { ...definition.params },
            ...overrides
        };
    }

    /**
     * Search effects by name
     */
    search(query) {
        const lowerQuery = query.toLowerCase();
        return this.getAll().filter(def =>
            def.name.toLowerCase().includes(lowerQuery) ||
            def.type.toLowerCase().includes(lowerQuery) ||
            def.description?.toLowerCase().includes(lowerQuery)
        );
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const effectRegistry = new EffectRegistry();

export default effectRegistry;
