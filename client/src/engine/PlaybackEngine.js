import MasterClock from './MasterClock';
import RingBuffer from './RingBuffer';
import { EffectPipeline, EffectRenderer, GPUEffectEngine } from '../effects';

/**
 * Playback State Machine
 * IDLE       - No media loaded, engine waiting.
 * PRELOADING - Media URL set, decoding initial buffers.
 * READY      - Buffers filled (≥300ms audio, ≥1 video frame), can play.
 * PLAYING    - Clock running, frames rendering, audio streaming.
 * PAUSED     - Clock stopped, buffers held, resumption possible.
 * ERROR      - Unrecoverable error, requires user action.
 */
const PlaybackState = {
    IDLE: 'IDLE',
    PRELOADING: 'PRELOADING',
    READY: 'READY',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    ERROR: 'ERROR'
};

// Preload thresholds
const PRELOAD_AUDIO_MS = 300;    // Minimum 300ms audio buffered
const PRELOAD_VIDEO_FRAMES = 1;  // At least 1 video frame decoded

/**
 * PlaybackEngine.js
 * The Director that coordinates the Clock, the Buffer, and the Screen.
 * Implements strict state machine for production-correct playback.
 */
class PlaybackEngine {
    constructor(canvas, options = {}) {
        this.canvas = canvas;

        // === STATE MACHINE ===
        this._state = PlaybackState.IDLE;
        this.onStateChange = options.onStateChange || (() => { });

        // --- Texture Store for Video Frames ---
        this.gl = canvas.getContext('webgl2', { alpha: false });
        if (!this.gl) {
            console.error('[PlaybackEngine] WebGL2 not supported, falling back to experimental-webgl');
            this.gl = canvas.getContext('experimental-webgl');
        }

        if (!this.gl) {
            throw new Error('[PlaybackEngine] WebGL not supported. Color grading requires WebGL.');
        }

        this.initGL();

        // Components
        this.clock = new MasterClock();
        this.buffer = new RingBuffer(150); // Increased buffer to ~2.5s (60fps) to handle fast decoding

        // Config
        this.driftTolerance = options.driftTolerance || 0.05; // 50ms tolerance
        this.audioSources = []; // Active audio nodes

        // Callbacks
        this.onTick = options.onTick || (() => { }); // External subscriber (e.g. Store Update)
        this.onAudioLevels = options.onAudioLevels || (() => { }); // Volume Metering
        this.onWaveformUpdate = options.onWaveformUpdate || (() => { }); // Waveform Data
        this.onError = options.onError || (() => { }); // Error callback

        // Loop State
        this.rafId = null;
        this.lastFrameRendered = null; // Debug info
        this.currentUrl = null; // Cache URL for resume

        this.gradingParams = {
            brightness: 1.0,
            contrast: 1.0,
            saturation: 1.0,
            hueRotate: 0.0,
            // Selective (R, Y, G, C, B, M)
            selectiveRes: [0, 0, 0, 0, 0, 0], // H, S, L deltas for each? 
            // Simplified: We pass arrays. 
            // Uniform structure:
            // u_selectiveHue: float[6]
            // u_selectiveSat: float[6]
            // u_selectiveLum: float[6]
            selectiveHue: new Float32Array(6).fill(0),
            selectiveSat: new Float32Array(6).fill(0),
            selectiveLum: new Float32Array(6).fill(0)
        };

        // Initialize Worker
        this.worker = new Worker(new URL('./VideoWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.worker.onerror = (e) => {
            console.error('[PlaybackEngine] Worker Error:', e.message, e.filename, e.lineno);
        };

        // Cache for Audio Params (to avoid spamming Worklet)
        this.paramCache = {};

        // Audio Gain (Volume)
        this.gainNode = this.clock.audioCtx.createGain();
        this.gainNode.connect(this.clock.audioCtx.destination);
        this.gainNode.gain.value = 1.0;

        // Track Store (Decoded AudioBuffers)
        this.decodedTracks = new Map(); // Map<id, { buffer: AudioBuffer, playHead: number }>

        // Initialize Audio Context & Worklet
        this.initAudio();

        console.log('[PlaybackEngine] Initialized with WebGL2');

        // === EFFECTS ENGINE INTEGRATION ===
        this.effectsEnabled = options.effectsEnabled ?? true;
        this.effectsPipeline = null;
        this.effectsRenderer = null;
        this.gpuEffectEngine = null;
        this.activePlacements = []; // Set by TimelineStateManager

        // Audio Streaming Queue (Flow Control)
        this.audioQueue = [];

        if (this.effectsEnabled) {
            this.initEffectsEngine();
        }
    }

    /**
     * Initialize the effects rendering pipeline
     */
    initEffectsEngine() {
        try {
            // Create GPU effect engine with our WebGL context
            this.gpuEffectEngine = new GPUEffectEngine(this.gl);

            // Create effect pipeline
            this.effectsPipeline = new EffectPipeline({
                gpuEngine: this.gpuEffectEngine,
                onEffectChange: (change) => {
                    console.log('[PlaybackEngine] Effect changed:', change.type);
                }
            });

            // Create effect renderer  
            this.effectsRenderer = new EffectRenderer({
                gl: this.gl,
                pipeline: this.effectsPipeline,
                onProgress: (progress) => {
                    console.log('[PlaybackEngine] Render progress:', progress);
                }
            });

            console.log('[PlaybackEngine] Effects engine initialized');
        } catch (e) {
            console.error('[PlaybackEngine] Failed to initialize effects engine:', e);
            this.effectsEnabled = false;
        }
    }

    initGL() {
        const gl = this.gl;

        // Vertex Shader (Simple Pass-through)
        const vsSource = `#version 300 es
        in vec2 a_position;
        in vec2 a_texCoord;
        out vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }`;

        // Fragment Shader (Color Grading)
        // HSL Conversion Logic included
        const fsSource = `#version 300 es
        precision mediump float;
        
        in vec2 v_texCoord;
        uniform sampler2D u_image;
        
        // Global Grading
        uniform float u_brightness;
        uniform float u_contrast;
        uniform float u_saturation;
        uniform float u_hueRotate; // Degrees

        // Selective Grading Arrays [R, Y, G, C, B, M]
        uniform float u_selHue[6]; // Hue shift per range
        uniform float u_selSat[6]; // Saturation shift per range
        uniform float u_selLum[6]; // Lightness shift per range

        out vec4 outColor;

        // --- HSL Helper Functions ---
        vec3 rgb2hcv(vec3 c) {
            vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }

        vec3 rgb2hsl(vec3 c) {
            vec3 hcv = rgb2hcv(c);
            float L = hcv.z - hcv.y * 0.5;
            float S = hcv.y / (1.0 - abs(L * 2.0 - 1.0) + 1.0e-10);
            return vec3(hcv.x, S, L);
        }

        vec3 hsl2rgb(vec3 c) {
            vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
            return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
        }

        // --- Main ---
        void main() {
            vec4 color = texture(u_image, v_texCoord);
            vec3 rgb = color.rgb;

            // 1. Convert to HSL
            vec3 hsl = rgb2hsl(rgb);
            float h = hsl.x; // 0.0 - 1.0
            float s = hsl.y;
            float l = hsl.z;

            // 2. Selective Grading
            // Weights for 6 ranges. H is 0-1. 
            // R=0/1, Y=0.16, G=0.33, C=0.5, B=0.66, M=0.83
            
            // We use gaussian-like weights based on distance
            float wR = max(0.0, 1.0 - abs(h - 0.0) * 6.0) + max(0.0, 1.0 - abs(h - 1.0) * 6.0); // Wrap around
            float wY = max(0.0, 1.0 - abs(h - 0.166) * 6.0);
            float wG = max(0.0, 1.0 - abs(h - 0.333) * 6.0);
            float wC = max(0.0, 1.0 - abs(h - 0.5) * 6.0);
            float wB = max(0.0, 1.0 - abs(h - 0.666) * 6.0);
            float wM = max(0.0, 1.0 - abs(h - 0.833) * 6.0);

            // Apply Selective Shifts (Weighted)
            float dH = wR*u_selHue[0] + wY*u_selHue[1] + wG*u_selHue[2] + wC*u_selHue[3] + wB*u_selHue[4] + wM*u_selHue[5];
            float dS = wR*u_selSat[0] + wY*u_selSat[1] + wG*u_selSat[2] + wC*u_selSat[3] + wB*u_selSat[4] + wM*u_selSat[5];
            float dL = wR*u_selLum[0] + wY*u_selLum[1] + wG*u_selLum[2] + wC*u_selLum[3] + wB*u_selLum[4] + wM*u_selLum[5];

            h = mod(h + dH, 1.0);
            s = clamp(s + dS, 0.0, 1.0);
            l = clamp(l + dL, 0.0, 1.0);
            
            // Convert back to RGB for Global Ops (could do global in HSL too but contrast/bright typically RGB)
            rgb = hsl2rgb(vec3(h, s, l));

            // 3. Global Adjustments
            
            // Hue Rotate (Global)
            // Cheap approximation or recalc HSL. Let's assume user uses one or other. 
            // Or rotate H above. Let's do Standard RGB matrix for Hue Rotate if needed, or simple H shift.
            // Let's use RGB ops.
            
            // Brightness
            rgb *= u_brightness;

            // Contrast
            rgb = (rgb - 0.5) * u_contrast + 0.5;

            // Saturation (Luma based)
            float gray = dot(rgb, vec3(0.299, 0.587, 0.114));
            rgb = mix(vec3(gray), rgb, u_saturation);

            outColor = vec4(rgb, color.a);
        }`;

        // Compile
        const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        this.program = this.createProgram(gl, vs, fs);

        // Look up locations
        this.loc = {
            position: gl.getAttribLocation(this.program, "a_position"),
            texCoord: gl.getAttribLocation(this.program, "a_texCoord"),
            brightness: gl.getUniformLocation(this.program, "u_brightness"),
            contrast: gl.getUniformLocation(this.program, "u_contrast"),
            saturation: gl.getUniformLocation(this.program, "u_saturation"),
            hueRotate: gl.getUniformLocation(this.program, "u_hueRotate"),
            selHue: gl.getUniformLocation(this.program, "u_selHue"),
            selSat: gl.getUniformLocation(this.program, "u_selSat"),
            selLum: gl.getUniformLocation(this.program, "u_selLum"),
        };

        // Setup Buffers (Quad)
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        // Full screen quad currently (Clip space -1 to 1)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            -1, 1,
            1, -1,
            1, 1,
        ]), gl.STATIC_DRAW);

        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        // Texture coords (0 to 1), flipped Y usually for video?
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            0, 0,
            1, 1,
            1, 0,
        ]), gl.STATIC_DRAW);

        // Texture Object
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(gl, vs, fs) {
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    // --- Public API ---

    resize(width, height) {
        if (!this.canvas) return;
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    setQuality(quality) {
        if (!this.worker) return;
        console.log(`[PlaybackEngine] Setting Quality to: ${quality}`);
        this.worker.postMessage({ type: 'SET_QUALITY', payload: { quality } });
    }

    clearCanvas() {
        if (!this.gl) return;
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.currentUrl = null; // Clear cached URL so resume works correctly
    }

    // === STATE MACHINE HELPERS ===

    get state() {
        return this._state;
    }

    setState(newState) {
        if (this._state === newState) return;
        const prevState = this._state;
        this._state = newState;
        console.log(`[PlaybackEngine] State: ${prevState} -> ${newState}`);
        this.onStateChange(newState, prevState);
    }

    /**
     * Get buffer statistics for UI/debug overlay
     */
    getBufferStats() {
        // Audio queue estimate: Each chunk is ~23ms at 48kHz/1024 samples
        // More accurate: sum durations
        const audioBufferMs = this.audioQueue.reduce((sum, chunk) => sum + (chunk.duration * 1000 || 0), 0);
        const videoFramesQueued = this.buffer.size;

        return {
            audioBufferMs,
            videoFramesQueued,
            state: this._state,
            clockTime: this.clock.getCurrentTime(),
            isPlaying: this.clock.isPlaying
        };
    }

    /**
     * Check if preload conditions are met
     */
    isPreloadComplete() {
        const stats = this.getBufferStats();
        return stats.audioBufferMs >= PRELOAD_AUDIO_MS && stats.videoFramesQueued >= PRELOAD_VIDEO_FRAMES;
    }

    /**
     * Start playback with proper preload gating.
     * If buffers are not ready, transitions to PRELOADING and waits.
     * @param {string} url - Optional media URL
     */
    async play(url) {
        if (url) this.currentUrl = url;
        const targetUrl = url || this.currentUrl;

        // Ensure Audio is Initialized (User Interaction Context)
        if (!this.audioInitialized) {
            try {
                await this.initAudio();
            } catch (e) {
                console.error('[PlaybackEngine] Audio init failed:', e);
                this.setState(PlaybackState.ERROR);
                this.onError({ type: 'audio_blocked', message: 'Audio initialization blocked. Click to enable.' });
                return;
            }
        }

        // Resume audio context (required for user gesture)
        if (this.clock.audioCtx.state === 'suspended') {
            await this.clock.audioCtx.resume();
        }

        // If already playing, do nothing
        if (this._state === PlaybackState.PLAYING) return;

        // If we have a new URL or buffers are empty, go to PRELOADING
        const needsPreload = !this.isPreloadComplete();

        if (needsPreload) {
            this.setState(PlaybackState.PRELOADING);
            console.log('[PlaybackEngine] Preloading buffers...');

            // Start decoding
            this.worker.postMessage({
                type: 'START_GENERATING',
                payload: { startTime: this.clock.getCurrentTime(), url: targetUrl }
            });

            // Wait for preload with timeout
            const preloadTimeout = 5000; // 5 seconds max
            const startTime = Date.now();

            await new Promise((resolve, reject) => {
                const checkPreload = () => {
                    if (this.isPreloadComplete()) {
                        resolve();
                    } else if (this.isDestroyed) {
                        reject(new Error('Engine destroyed during preload'));
                    } else if (Date.now() - startTime > preloadTimeout) {
                        console.warn('[PlaybackEngine] Preload timeout, starting anyway');
                        resolve(); // Start anyway with partial buffer
                    } else {
                        setTimeout(checkPreload, 50);
                    }
                };
                checkPreload();
            });

            this.setState(PlaybackState.READY);
        }

        // Now start playback
        this.setState(PlaybackState.PLAYING);
        this.clock.play();
        this.startLoop();
        console.log('[PlaybackEngine] Playing from', this.clock.getCurrentTime().toFixed(2) + 's');
    }

    pause() {
        if (this._state !== PlaybackState.PLAYING) return;

        this.setState(PlaybackState.PAUSED);
        this.clock.pause();
        this.clock.audioCtx.suspend(); // Freeze audio hardware time
        this.stopLoop();
        this.worker.postMessage({ type: 'STOP' });
    }

    /**
     * Loads a URL into the worker without starting the clock/loop.
     * Useful for updating state when paused (e.g. Undo/Redo/Clip Swap).
     */
    load(url) {
        if (!url || url === this.currentUrl) return;
        this.currentUrl = url;

        console.log('[PlaybackEngine] Loading URL (Paused):', url);
        // We use START_GENERATING to serve the frame at current time, 
        // but we keep the clock paused and don't start the RAF loop.
        this.worker.postMessage({
            type: 'START_GENERATING',
            payload: { startTime: this.clock.getCurrentTime(), url }
        });
    }

    seek(time) {
        this.stopAudio(); // Clear pending audio
        this.clock.seek(time);

        // On seek, we must flush the buffer because old frames are invalid
        this.buffer.clear((frame) => {
            if (frame.close) frame.close(); // WebCodecs cleanup
        });
        this.audioQueue = []; // Clear pending audio chunks

        // Signal Producer (Worker) to seek
        this.worker.postMessage({ type: 'SEEK', payload: { time } });
        console.log(`[PlaybackEngine] Seeked to ${time}, Buffer flushed.`);
    }

    // New Color API
    setGrading(params) {
        // params: { brightness, contrast, saturate, hueRotate, selective: { reds: {h,s,l}, ... } }
        if (!params) return;

        // Global
        this.gradingParams.brightness = (params.brightness || 100) / 100.0;
        this.gradingParams.contrast = (params.contrast || 100) / 100.0;
        this.gradingParams.saturation = (params.saturate || 100) / 100.0;
        this.gradingParams.hueRotate = params.hueRotate || 0;

        // Selective
        // Map keys to index: Red:0, Yellow:1, Green:2, Cyan:3, Blue:4, Magenta:5
        const ranges = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];

        const selHue = new Float32Array(6);
        const selSat = new Float32Array(6);
        const selLum = new Float32Array(6);

        // Always reset or overwrite. 
        // Logic: new Float32Array is all zeros (Defaults).
        // If params.selective exists, we fill it. If not, it stays zeros (Clean Reset).
        if (params.selective) {
            ranges.forEach((key, idx) => {
                const p = params.selective[key];
                if (p) {
                    selHue[idx] = (p.hue || 0) / 360.0; // Normalized shift
                    selSat[idx] = (p.sat || 0) / 100.0; // +/- 1.0 (100% = +1.0 sat ?) UI depends. 
                    // Let's assume input is +/- 100. So /100 = +/-1.0
                    selLum[idx] = (p.lum || 0) / 100.0;
                }
            });
        }

        this.gradingParams.selectiveHue = selHue;
        this.gradingParams.selectiveSat = selSat;
        this.gradingParams.selectiveLum = selLum;
    }

    // Deprecated but compatible
    setFilter(filter) {
        // ...
        console.warn("[PlaybackEngine] setFilter is deprecated for WebGL engine. Use setGrading.");
    }

    setVolume(value) {
        if (this.gainNode) {
            // value 0.0 to 2.0+
            this.gainNode.gain.value = value;
        }
    }

    // === EFFECTS API ===

    /**
     * Get the effects pipeline for external manipulation
     */
    getEffectsPipeline() {
        return this.effectsPipeline;
    }

    /**
     * Get the effects renderer
     */
    getEffectsRenderer() {
        return this.effectsRenderer;
    }

    /**
     * Add an effect to a placement
     * @param {object} effectConfig - Effect configuration
     */
    addEffect(effectConfig) {
        if (!this.effectsPipeline) return null;
        return this.effectsPipeline.addEffect(effectConfig);
    }

    /**
     * Remove an effect
     * @param {string} effectId - Effect ID to remove
     */
    removeEffect(effectId) {
        if (!this.effectsPipeline) return false;
        return this.effectsPipeline.removeEffect(effectId);
    }

    /**
     * Update active placements for effect rendering
     * Called by TimelineStateManager when placements change
     * @param {object[]} placements - Active placement objects
     */
    setActivePlacements(placements) {
        this.activePlacements = placements || [];
    }

    /**
     * Enable/disable effects processing
     */
    setEffectsEnabled(enabled) {
        this.effectsEnabled = enabled;
        if (enabled && !this.effectsPipeline) {
            this.initEffectsEngine();
        }
    }

    /**
     * Get effect processing metrics
     */
    getEffectsMetrics() {
        return this.effectsRenderer?.getMetrics() || null;
    }

    // --- Frame Ingestion (Producer Interface) ---

    handleWorkerMessage(e) {
        const { type, payload } = e.data;
        if (type === 'NEW_FRAME') {
            this.pushFrame(payload.data, payload.timestamp);
        } else if (type === 'AUDIO_DATA') {
            // Forward Waveform Data if present
            if (payload.peaks && this.onWaveformUpdate) {
                // this.onWaveformUpdate(payload.peaks, payload.timestamp, payload.duration);
            }

            // QUEUE AUDIO FOR STREAMING (Flow Control)
            if (payload.buffers && payload.buffers.length > 0) {
                // We push the whole payload to queue. 
                // We assume data is time-ordered.
                this.audioQueue.push({
                    trackId: 'video_main',
                    data: payload.buffers[0], // Left channel for now
                    timestamp: payload.timestamp,
                    duration: payload.duration
                });
            }
        }
    }

    // Initialize Audio Context & Worklet
    async initAudio() {
        if (this.audioInitialized) return;

        // Ensure Context is Running (User Gesture Requirement)
        if (this.clock.audioCtx.state === 'suspended') {
            try {
                // DON'T resume here, wait for explicit call. 
                // Just warn.
                console.log('[PlaybackEngine] AudioContext suspended. Call resumeAudio() on user gesture.');
            } catch (e) {
                console.error(e);
            }
        }

        try {
            await this.clock.audioCtx.audioWorklet.addModule('/AudioProcessor.js');

            // Check if we were destroyed while waiting
            if (this.isDestroyed || this.clock.audioCtx.state === 'closed') {
                if (this.isDestroyed) {
                    console.log('[PlaybackEngine] AudioWorklet init aborted (Engine destroyed)');
                } else {
                    console.warn('[PlaybackEngine] AudioContext closed during init. Aborting Worklet creation.');
                }
                return;
            }

            this.audioNode = new AudioWorkletNode(this.clock.audioCtx, 'vp-audio-processor');
            this.audioNode.port.onmessage = this.handleAudioMessage.bind(this);
            this.audioNode.connect(this.gainNode);
            console.log('[PlaybackEngine] AudioWorklet Initialized');
            this.audioInitialized = true;

            // Re-sync any tracks that were loaded while audio was down
            this.decodedTracks.forEach((track, trackId) => {
                this.audioNode.port.postMessage({
                    type: 'INIT_TRACK',
                    payload: { trackId, bufferSize: 48000 * 5 }
                });
            });

        } catch (e) {
            if (this.clock.audioCtx.state === 'closed') {
                console.warn('[PlaybackEngine] AudioContext closed. Ignoring init error.');
            } else {
                console.error('[PlaybackEngine] Failed to load AudioWorklet:', e);
            }
        }
    }

    // Call this on "Play" button click
    async resumeAudio() {
        if (this.clock.audioCtx.state === 'suspended') {
            await this.clock.audioCtx.resume();
            console.log('[PlaybackEngine] AudioContext Resumed');
        }
        if (!this.audioInitialized) {
            await this.initAudio();
        }
    }

    handleAudioMessage(e) {
        const { type, payload } = e.data;
        if (type === 'VOLUME_LEVELS') {
            this.onAudioLevels(payload);
        }
    }

    // --- Audio Loader (Thread A) ---

    async loadAudioTrack(trackId, url) {
        if (!url || this.decodedTracks.has(trackId)) return;

        try {
            console.log(`[PlaybackEngine] Decoding Track ${trackId}`);

            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.clock.audioCtx.decodeAudioData(arrayBuffer);

            // Store for streaming
            this.decodedTracks.set(trackId, {
                buffer: audioBuffer,
                playHead: 0, // Where we are in the source file
                lastScheduleTime: -1 // Last timeline time we pushed data for
            });

            // Extract Waveforms for Audio Tracks (Since they use Web Audio Decode, not VideoWorker)
            // We can do it here directly!
            // 256 samples per peak?
            const channel = audioBuffer.getChannelData(0);
            const SAMPLES_PER_PEAK = 256;
            const peakCount = Math.ceil(channel.length / SAMPLES_PER_PEAK);
            const peaks = new Float32Array(peakCount);

            for (let i = 0; i < peakCount; i++) {
                let max = 0;
                const start = i * SAMPLES_PER_PEAK;
                const end = Math.min(start + SAMPLES_PER_PEAK, channel.length);
                for (let j = start; j < end; j++) {
                    const abs = Math.abs(channel[j]);
                    if (abs > max) max = abs;
                }
                peaks[i] = max;
            }

            // Send to Subscriber immediately
            if (this.onWaveformUpdate) {
                // How do we match TrackId to AssetId?
                // The Caller (UI) knows. We pass TrackId.
                this.onWaveformUpdate(peaks, 0, audioBuffer.duration, trackId);
            }


            // Init in Worklet
            if (this.audioNode) {
                this.audioNode.port.postMessage({
                    type: 'INIT_TRACK',
                    payload: { trackId, bufferSize: 48000 * 5 } // 5s Buffer
                });
            }

            console.log(`[PlaybackEngine] Ready ${trackId}: ${audioBuffer.duration.toFixed(2)}s`);

        } catch (e) {
            console.error(`[PlaybackEngine] Decode Error ${trackId}:`, e);
        }
    }

    setVolume(trackId, volume) {
        if (this.audioNode) {
            this.audioNode.port.postMessage({ type: 'SET_VOLUME', payload: { trackId, volume } });
        }
    }

    setMute(trackId, muted) {
        if (this.audioNode) {
            this.audioNode.port.postMessage({ type: 'SET_MUTE', payload: { trackId, muted } });
        }
    }

    setSolo(trackId, solo) {
        if (this.audioNode) {
            this.audioNode.port.postMessage({ type: 'SET_SOLO', payload: { trackId, solo } });
        }
    }

    // --- Audio Scheduler (The Feeder) ---
    // Called every frame (60fps) to keep Worklet buffers full
    // --- Audio Scheduler (The Feeder) ---
    updateTrackMetadata(tracks) {
        this.tracksMetadata = tracks;
    }

    // Called every frame (60fps) to keep Worklet buffers full AND update parameters
    feedAudio(masterTime) {
        if (!this.audioNode) return;

        // --- 1. Stream Cached Audio Chunks (Flow Control) ---
        // Feed queue -> Worklet (Keep ~2s buffered)
        // Worklet Buffer is 5s. We keep it topped up but not overflowing.
        // We don't have backpressure signal from Worklet yet, so we assume:
        // If chunk.timestamp is > masterTime + 5s, HOLD.
        // If chunk.timestamp < masterTime - 1s, DROP (too late).

        // Auto-init track if needed
        if (!this.videoTrackInitialized && this.audioQueue.length > 0) {
            this.audioNode.port.postMessage({
                type: 'INIT_TRACK',
                payload: { trackId: 'video_main', bufferSize: 48000 * 10 } // Increase to 10s buffer
            });
            this.videoTrackInitialized = true;
        }

        const MAX_AHEAD = 3.0; // 3 Seconds ahead max
        const DROP_BEHIND = 1.0; // 1 Second behind

        // Process Queue
        // We can consume multiple chunks per frame if needed
        let chunksProcessed = 0;

        while (this.audioQueue.length > 0 && chunksProcessed < 5) { // Limit 5 chunks/frame to avoid blocking
            const chunk = this.audioQueue[0]; // Peek

            if (chunk.timestamp < masterTime - DROP_BEHIND) {
                // Drop old data
                this.audioQueue.shift();
                // console.warn("Dropped old audio chunk", chunk.timestamp);
                continue;
            }

            if (chunk.timestamp > masterTime + MAX_AHEAD) {
                // Too far ahead, wait.
                break;
            }

            // Valid Window: Send to Worklet
            this.audioNode.port.postMessage({
                type: 'PUSH_DATA',
                payload: {
                    trackId: chunk.trackId,
                    data: chunk.data
                }
            }); // Note: Cloning data here if not transferring. 
            // If we transferred in handleWorkerMessage, we can't use it here. 
            // I removed transfer in handleWorkerMessage logic above implicitly by not using [transfer]. 
            // So we clone. It's safer for Queue.

            this.audioQueue.shift();
            chunksProcessed++;
        }


        if (this.decodedTracks.size === 0) return; // No separate audio tracks to process below?
        if (this.tracksMetadata) {
            this.tracksMetadata.forEach(track => {
                if (track.type !== 'audio' && track.type !== 'video') return;

                // Find Active Clip
                const clip = track.clips.find(c => masterTime >= c.start && masterTime < c.start + c.duration);
                let gain = 1.0;
                let denoise = false;
                let enhance = false;

                if (clip) {
                    const relativeTime = masterTime - clip.start;
                    const duration = clip.duration;

                    // Fade In
                    if (clip.fadeIn > 0 && relativeTime < clip.fadeIn) {
                        gain = relativeTime / clip.fadeIn;
                    }
                    // Fade Out
                    else if (clip.fadeOut > 0 && relativeTime > (duration - clip.fadeOut)) {
                        gain = (duration - relativeTime) / clip.fadeOut;
                    }

                    // Apply Clip Base Volume
                    gain *= (clip.volume !== undefined ? clip.volume : 1.0);

                    denoise = !!clip.denoise;
                    enhance = !!clip.enhance;
                } else {
                    gain = 0; // No clip = Silence
                }

                // Send Updates (Debounce or optimize?)
                // Worklet handles message overhead well, 60msg/sec per track is fine.
                // Or check if changed?

                // We use a cache to avoid spamming messages if values unchanged
                const cacheKey = `gain-${track.id}`;
                if (this.paramCache[cacheKey] !== gain) {
                    this.audioNode.port.postMessage({ type: 'SET_CLIP_GAIN', payload: { trackId: track.id, gain } });
                    this.paramCache[cacheKey] = gain;
                }

                const effectKey = `fx-${track.id}`;
                const effectHash = `${denoise}-${enhance}`;
                if (this.paramCache[effectKey] !== effectHash) {
                    this.audioNode.port.postMessage({ type: 'SET_EFFECTS', payload: { trackId: track.id, denoise, enhance } });
                    this.paramCache[effectKey] = effectHash;
                }
            });
        }

        this.decodedTracks.forEach((track, trackId) => {
            // Determine where we are in the source
            // Simple logic: Assume Clip Start = 0 for now (or pass offsets later)
            // If MasterTime = 10s, and Clip starts at 5s, we need FileTime 5s.
            // For MVP Step 1: Assume Track starts at 0.0.

            // Re-sync PlayHead if we seeked (detected by gap)
            if (Math.abs(track.lastScheduleTime - masterTime) > 0.5) {
                // Seek detected or start
                track.playHead = masterTime * track.buffer.sampleRate;
            }

            // Check if we need to push data
            const bufferedTime = (track.playHead / track.buffer.sampleRate);
            if (bufferedTime < masterTime + LOOKAHEAD) {
                // Push data until we fill lookahead or EOF

                const pushLimit = (masterTime + LOOKAHEAD) * track.buffer.sampleRate;
                let currentPtr = Math.floor(track.playHead);
                const endPtr = Math.min(Math.floor(pushLimit), track.buffer.length);

                if (currentPtr < endPtr) {
                    // Extract Chunk
                    // Mono for now (Channel 0)
                    const rawData = track.buffer.getChannelData(0);
                    const chunk = rawData.subarray(currentPtr, endPtr);

                    this.audioNode.port.postMessage({
                        type: 'PUSH_DATA',
                        payload: { trackId, data: chunk }
                    }, [chunk.buffer]); // Transferable for perf? Be careful if sharing buffer view.
                    // Subarray shares buffer. Copying might be safer for Transfer, or just postMessage (copy).
                    // Float32Array slice() makes a copy. subarray() shares.
                    // We can just postMessage(chunk). Browser handles structure clone (copy).

                    track.playHead = endPtr;
                    track.lastScheduleTime = bufferedTime;
                }
            }

            track.lastScheduleTime = masterTime; // Keep tracking
        });
    }

    stopAudio() {
        if (this.audioNode) {
            this.audioNode.port.postMessage({ type: 'CLEAR_BUFFERS' });
        }
    }

    // Legacy Stub
    scheduleAudio(payload) { }

    /**
     * Called by the Decoder/Worker when a frame is ready.
     * @param {VideoFrame|ImageBitmap} frame
     * @param {number} timestamp
     */
    pushFrame(frame, timestamp) {
        const item = { data: frame, timestamp };

        // Push to buffer
        const success = this.buffer.push(item);

        if (!success) {
            // Buffer full means we are decoding faster than playback. Dropping is safe.
            // console.debug("[PlaybackEngine] Buffer Full! Dropping frame.");
            if (frame.close) frame.close();
            return;
        }

        // --- Live Scrubbing Logic ---
        // If we are paused, we likely want to see this frame immediately (it's result of a seek)
        if (!this.clock.isPlaying) {
            // We just received a frame while paused. Render it!
            // Check if it's the frame we expect? (drift tolerance check might skip it if buffer has old junk,
            // but we cleared buffer on seek so this should be fresh)
            this.render(item); // Render immediately

            // Consume it so it doesn't rot?
            // Ideally we stay on this frame until play resumes.
            // But if we pop it, `loop` won't find it when play resumes.
            // WebGL texture is updated by `render`, so we could pop it.
            // Actually, let's Pop it so we don't overflow buffer if user scrubs 100 times quickly.
            const consumed = this.buffer.pop();
            if (consumed.data.close) consumed.data.close();
        }
    }

    // --- Render Loop (Consumer) ---

    startLoop() {
    }

    stopLoop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    loop() {
        // Schedule next tick
        this.rafId = requestAnimationFrame(this.loop.bind(this));

        if (!this.clock.isPlaying) return;

        const masterTime = this.clock.getCurrentTime();

        // 1. Notify external subscribers (e.g. UI scrubber)
        this.onTick(masterTime);

        // 2. Drift Correction & Frame Selection
        let candidate = this.buffer.peek();

        // 3. Feed Audio Ring Buffers (Keep them full)
        this.feedAudio(masterTime);

        // Skip frames that are too old (Drift Correction)
        while (candidate && candidate.timestamp < masterTime - this.driftTolerance) {
            console.warn(`[Drift] Dropping late frame: ${candidate.timestamp.toFixed(3)}s (Master: ${masterTime.toFixed(3)}s)`);

            // Release logic
            const dropped = this.buffer.pop();
            if (dropped.data && dropped.data.close) dropped.data.close();

            candidate = this.buffer.peek();
        }

        // Render if valid candidate is found
        if (candidate) {
            // Simple logic: If frame is within visible window
            if (candidate.timestamp <= masterTime + 0.016) {
                this.render(candidate);

                // Consume
                const consumed = this.buffer.pop();
                if (consumed.data.close) consumed.data.close();
            } else {
                // Buffer is ahead (Good!). Wait for clock to catch up.
            }
        }
    }

    render(frameItem) {
        if (!this.gl || !frameItem.data) return;

        const gl = this.gl;

        // Resize canvas if needed
        if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
            // For now assume static resolution or handle resize externally
        }

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        // Clear
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind Vertices
        gl.enableVertexAttribArray(this.loc.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(this.loc.position, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(this.loc.texCoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(this.loc.texCoord, 2, gl.FLOAT, false, 0, 0);

        // Update Texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        // texImage2D with VideoFrame is supported in Chrome/Edge. 
        // Need to be careful about format. VideoFrame usually RGBA or similar.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frameItem.data);

        gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);

        // Update Uniforms
        gl.uniform1f(this.loc.brightness, this.gradingParams.brightness);
        gl.uniform1f(this.loc.contrast, this.gradingParams.contrast);
        gl.uniform1f(this.loc.saturation, this.gradingParams.saturation);
        // gl.uniform1f(this.loc.hueRotate, this.gradingParams.hueRotate); // Not used in shader yet, using global Hue later if needed.

        // Selective
        gl.uniform1fv(this.loc.selHue, this.gradingParams.selectiveHue);
        gl.uniform1fv(this.loc.selSat, this.gradingParams.selectiveSat);
        gl.uniform1fv(this.loc.selLum, this.gradingParams.selectiveLum);

        // DRAW
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // === EFFECTS PROCESSING ===
        // Apply GPU effects after base color grading
        if (this.effectsEnabled && this.effectsRenderer && this.activePlacements.length > 0) {
            try {
                const currentTime = this.clock.getCurrentTime();

                // Process effects for each active placement
                // Note: This modifies the framebuffer in-place using ping-pong rendering
                this.effectsRenderer.renderPreview(
                    this.texture, // The current video texture
                    this.activePlacements,
                    currentTime,
                    {
                        width: gl.drawingBufferWidth,
                        height: gl.drawingBufferHeight,
                        timestamp: frameItem.timestamp
                    }
                );
            } catch (e) {
                console.error('[PlaybackEngine] Effects render error:', e);
            }
        }

        this.lastFrameRendered = frameItem.timestamp;
    }

    destroy() {
        this.isDestroyed = true;
        this.stopLoop();
        this.worker.terminate();
        this.clock.destroy();
        this.buffer.clear((f) => f.data?.close && f.data.close());

        // Clean up effects engine
        if (this.effectsRenderer) {
            this.effectsRenderer.destroy();
            this.effectsRenderer = null;
        }
        if (this.gpuEffectEngine) {
            this.gpuEffectEngine.destroy();
            this.gpuEffectEngine = null;
        }
        this.effectsPipeline = null;
    }
}

export default PlaybackEngine;
