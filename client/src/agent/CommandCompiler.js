/**
 * CommandCompiler v2 — Viral Pilot
 *
 * Architecture:
 *  1. Command Contract     — Universal output shape for all commands
 *  2. Command Registry     — Map-based action→compiler lookup (no switch)
 *  3. Symbolic-First       — Emits symbolic refs ($playhead, $clip, $first_clip); resolution deferred
 *  4. 3-Level Validation   — Structural (here) → Logical (executor) → Runtime (engine)
 *  5. Fallback Path        — Unregistered actions get a generic fallback, not silent skip
 *  6. Pure & Synchronous   — compile(plan, stateSnapshot) → result. No side effects.
 *  7. Explicit Outcomes    — OK | SKIP | VALIDATION_ERROR | FALLBACK_USED per step
 *  8. Hard Timeout         — Deadline guard on the compile loop (200ms default)
 *
 * Constraints:
 *  - NO async
 *  - NO store mutations
 *  - NO imports of useTimelineStore (state passed in)
 *  - Deterministic: same input → same output
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §1  TYPES & CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const ENGINE = Object.freeze({
    STORE: 'store',
    MEDIABUNNY: 'mediabunny',
    API: 'api',
});

export const VALIDATION_LEVEL = Object.freeze({
    STRUCTURAL: 'structural',
    LOGICAL: 'logical',
    RUNTIME: 'runtime',
});

export const OUTCOME = Object.freeze({
    OK: 'OK',
    SKIP: 'SKIP',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    FALLBACK_USED: 'FALLBACK_USED',
    TIMEOUT: 'TIMEOUT',
});

export const VALIDATION_ERRORS = Object.freeze({
    MISSING_FIELD: 'MISSING_FIELD',
    INVALID_ENUM: 'INVALID_ENUM',
    INVALID_RANGE: 'INVALID_RANGE',
    INVALID_TYPE: 'INVALID_TYPE',
    UNKNOWN_ACTION: 'UNKNOWN_ACTION',
    TIMEOUT: 'TIMEOUT',
});

const COMPILE_TIMEOUT_MS = 200;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §2  COMMAND CONTRACT BUILDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function cmd(engine, action, args, meta = {}) {
    return {
        engine,
        action,
        args,
        meta: {
            source_step_id: meta.source_step_id || null,
            validation_level: VALIDATION_LEVEL.STRUCTURAL,
            symbolic_refs: meta.symbolic_refs || [],
            description: meta.description || `${action}`,
            priority: meta.priority ?? 0,
        },
    };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §3  STEP RESULT BUILDERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ok(stepId, commands, computed = null) {
    return { outcome: OUTCOME.OK, step_id: stepId, commands, computed };
}

function skip(stepId, detail = '', computed = null) {
    return { outcome: OUTCOME.SKIP, step_id: stepId, commands: [], detail, computed };
}

function validationError(stepId, message, errorType = VALIDATION_ERRORS.MISSING_FIELD) {
    return { outcome: OUTCOME.VALIDATION_ERROR, step_id: stepId, commands: [], detail: message, error_type: errorType };
}

function fallbackUsed(stepId, commands, detail) {
    return { outcome: OUTCOME.FALLBACK_USED, step_id: stepId, commands, detail };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §4  STRUCTURAL VALIDATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function requireFields(step, ...fields) {
    for (const f of fields) {
        if (step[f] === undefined || step[f] === null) {
            return `Missing required field: "${f}"`;
        }
    }
    return null;
}

function requireEnum(value, validSet, fieldName) {
    if (value && !validSet.includes(value)) {
        return `Invalid ${fieldName}: "${value}". Valid: ${validSet.join(', ')}`;
    }
    return null;
}

function requireRange(value, min, max, fieldName) {
    if (value !== undefined && (value < min || value > max)) {
        return `${fieldName} ${value} out of range [${min}-${max}]`;
    }
    return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §5  SYMBOLIC HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function isSymbolic(val) {
    return typeof val === 'string' && val.startsWith('$');
}

function resolveOrSymbol(step, field, computedValues) {
    if (step.use_computed && computedValues[step.use_computed] !== undefined) {
        return { value: computedValues[step.use_computed], symbolic: false };
    }
    const val = step[field];
    if (val === undefined || val === null) return { value: null, symbolic: false };
    if (isSymbolic(val)) return { value: val, symbolic: true };
    return { value: val, symbolic: false };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §6  INDIVIDUAL STEP COMPILERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Computation steps ──────────────────────────────────────────────────────────

function compileValidateClipExists(step, ctx) {
    const clipRef = step.clip_id || '$first_clip';
    return skip(step.step_id, `Validate clip: ${clipRef}`);
}

function compileValidateTrackExists(step, ctx) {
    const trackRef = step.track_id;
    if (!trackRef) return validationError(step.step_id, 'Missing track_id', VALIDATION_ERRORS.MISSING_FIELD);
    return skip(step.step_id, `Validate track: ${trackRef}`);
}

function compileGetPlayheadPosition(step, ctx) {
    return skip(step.step_id, 'Reads $playhead at execution time', {
        key: step.output || 'playhead_position',
        value: '$playhead',
    });
}

function compileComputeSplitTimestamp(step, ctx) {
    const validModes = ['midpoint', 'thirds', 'quarters', 'timestamp', 'playhead'];
    const modeErr = requireEnum(step.mode, validModes, 'split mode');
    if (modeErr) return validationError(step.step_id, modeErr, VALIDATION_ERRORS.INVALID_ENUM);

    let computedVal;
    if (step.mode === 'playhead') {
        computedVal = '$playhead';
    } else if (step.mode === 'timestamp') {
        computedVal = step.timestamp ?? step.at_time ?? null;
    } else {
        // Compute actual value at compile time using state snapshot
        let clip = null;
        if (step.clip_id) {
            for (const track of ctx.state.tracks || []) {
                const found = track.clips?.find(c => c.id === step.clip_id);
                if (found) { clip = found; break; }
            }
        }
        if (!clip) {
            const videoTrack = (ctx.state.tracks || []).find(t => t.type === 'video') || ctx.state.tracks?.[0];
            clip = videoTrack?.clips?.[0] || null;
        }
        if (!clip) return validationError(step.step_id, 'No clip found for split computation', VALIDATION_ERRORS.MISSING_FIELD);

        const start = clip.start || 0;
        const dur = clip.duration || 0;
        if (step.mode === 'midpoint') computedVal = start + dur / 2;
        else if (step.mode === 'thirds') computedVal = start + dur / 3;
        else if (step.mode === 'quarters') computedVal = start + dur / 4;
        else computedVal = null;

        if (computedVal === null) return validationError(step.step_id, `Unsupported split mode: ${step.mode}`, VALIDATION_ERRORS.INVALID_ENUM);
    }

    return skip(step.step_id, `Compute split: mode=${step.mode}`, {
        key: step.output || 'split_timestamp',
        value: computedVal,
    });
}

function compileComputeTrimBounds(step, ctx) {
    return skip(step.step_id, 'Compute trim bounds', {
        key: step.output || 'trim_bounds',
        value: { trim_amount: step.trim_amount, target_duration: step.target_duration, trim_from: step.trim_from },
    });
}

function compileComputeSegmentRange(step, ctx) {
    return skip(step.step_id, 'Compute segment range', {
        key: 'segment_info',
        value: { start: step.start, end: step.end },
    });
}

// ── Edit commands ──────────────────────────────────────────────────────────────

function compileAddClip(step, ctx) {
    if (!step.src) return validationError(step.step_id, 'Source required', VALIDATION_ERRORS.MISSING_FIELD);
    let trackRef = step.track_id;
    if (!trackRef) {
        trackRef = ctx.state.tracks?.find(t => t.type === 'video')?.id || 'video-0';
    }
    const start = step.start || 0;
    const duration = step.duration || 5.0;
    const clipId = `clip_${Date.now()}`;
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'addClip', {
            trackId: trackRef,
            clip: { id: clipId, url: step.src, sourceUrl: step.src, start, duration, type: step.type || 'video', name: step.name || 'New Clip' },
        }, { source_step_id: step.step_id, description: `Add clip: ${step.name || step.src}` }),
    ]);
}

function compileSplitClip(step, ctx) {
    const { value: splitTime, symbolic } = resolveOrSymbol(step, 'timestamp', ctx.computedValues);
    const atTime = step.at_time;
    const resolvedTime = splitTime ?? atTime ?? null;

    if (resolvedTime === null) {
        return validationError(step.step_id, 'No split timestamp provided', VALIDATION_ERRORS.MISSING_FIELD);
    }

    const clipRef = step.clip_id || '$first_clip';
    const trackRef = step.track_id || `$track_of(${clipRef})`;
    const symbolicRefs = [];
    if (isSymbolic(clipRef)) symbolicRefs.push(clipRef);
    if (isSymbolic(trackRef)) symbolicRefs.push(trackRef);
    if (symbolic || isSymbolic(resolvedTime)) symbolicRefs.push(String(resolvedTime));

    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'splitClip', { trackId: trackRef, clipId: clipRef, splitTime: resolvedTime },
            { source_step_id: step.step_id, symbolic_refs: symbolicRefs, description: `Split clip at ${resolvedTime}` }),
        cmd(ENGINE.MEDIABUNNY, 'splitMedia', { clipId: clipRef, splitTime: resolvedTime },
            { source_step_id: step.step_id, symbolic_refs: symbolicRefs, description: `Media split at ${resolvedTime}`, priority: 1 }),
    ]);
}

function compileRemoveClip(step, ctx) {
    const clipRef = step.clip_id;
    if (!clipRef) return validationError(step.step_id, 'Missing clip_id', VALIDATION_ERRORS.MISSING_FIELD);
    const trackRef = step.track_id || `$track_of(${clipRef})`;
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'removeClip', { trackId: trackRef, clipId: clipRef },
            { source_step_id: step.step_id, symbolic_refs: isSymbolic(trackRef) ? [trackRef] : [], description: `Remove clip ${clipRef}` }),
    ]);
}

function compileRippleDelete(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'rippleDelete', { atTime: step.at_time },
            { source_step_id: step.step_id, description: `Ripple delete at ${step.at_time}s` }),
    ]);
}

function compileTrimClip(step, ctx) {
    const clipRef = step.clip_id;
    if (!clipRef) return validationError(step.step_id, 'Missing clip_id', VALIDATION_ERRORS.MISSING_FIELD);
    const bounds = ctx.computedValues[step.use_computed] || {};
    const trimFrom = step.action === 'trim_clip_start' ? 'start' : 'end';
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'trimClip', { trackId: step.track_id || `$track_of(${clipRef})`, clipId: clipRef, trimFrom, amount: bounds.trim_amount },
            { source_step_id: step.step_id, description: `Trim clip from ${trimFrom}` }),
    ]);
}

function compileDuplicateClip(step, ctx) {
    const clipRef = step.clip_id;
    if (!clipRef) return validationError(step.step_id, 'Missing clip_id', VALIDATION_ERRORS.MISSING_FIELD);
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'duplicateClip', { trackId: step.track_id || `$track_of(${clipRef})`, clipId: clipRef, insertAfter: step.insert_after ?? true },
            { source_step_id: step.step_id, description: `Duplicate clip ${clipRef}` }),
    ]);
}

function compileSetSpeed(step, ctx) {
    const speed = step.speed;
    const rangeErr = requireRange(speed, 0.1, 16, 'Speed');
    if (rangeErr) return validationError(step.step_id, rangeErr, VALIDATION_ERRORS.INVALID_RANGE);
    const clipRef = step.clip_id || '$first_clip';
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'setClipSpeed', { trackId: step.track_id || `$track_of(${clipRef})`, clipId: clipRef, speed },
            { source_step_id: step.step_id, description: `Speed ${speed}x` }),
        cmd(ENGINE.MEDIABUNNY, 'changeSpeed', { clipId: clipRef, speed, maintain_pitch: step.maintain_pitch ?? true },
            { source_step_id: step.step_id, description: `Media speed ${speed}x`, priority: 1 }),
    ]);
}

function compileSetAspectRatio(step, ctx) {
    const validRatios = ['16:9', '9:16', '1:1', '4:3', '21:9', '4:5'];
    const enumErr = requireEnum(step.ratio, validRatios, 'aspect ratio');
    if (enumErr) return validationError(step.step_id, enumErr, VALIDATION_ERRORS.INVALID_ENUM);
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'setAspectRatio', { ratio: step.ratio, reframeMode: step.reframe_mode || 'auto_center' },
            { source_step_id: step.step_id, description: `Aspect ratio → ${step.ratio}` }),
    ]);
}

// ── Audio commands ─────────────────────────────────────────────────────────────

function compileSilenceRemoval(step, ctx) {
    const filename     = step.file_path || '$uploaded_file';
    const symbolicRefs = filename === '$uploaded_file' ? ['$uploaded_file'] : [];
    return ok(step.step_id, [
        cmd(ENGINE.API, 'silenceDetect', {
            endpoint: '/api/silence/detect',
            method: 'POST',
            payload:  { filename, threshold: step.threshold || '-30dB', duration: step.min_duration || 0.5 },
            clip_id:  step.clip_id  || null, // single-clip target (legacy)
            asset_id: step.asset_id || null, // replace ALL clips of this asset
        }, {
            source_step_id: step.step_id,
            symbolic_refs: symbolicRefs,
            description: step.asset_id
                ? `Silence detection (asset ${step.asset_id})`
                : step.clip_id
                    ? `Silence detection (clip ${step.clip_id})`
                    : 'Silence detection',
        }),
    ]);
}

function compileAdjustVolume(step, ctx) {
    const rangeErr = requireRange(step.volume, 0, 3, 'Volume');
    if (rangeErr) return validationError(step.step_id, rangeErr, VALIDATION_ERRORS.INVALID_RANGE);
    const clipRef = step.clip_id || '$first_clip';
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'updateClip', { clipId: clipRef, updates: { volume: step.volume } },
            { source_step_id: step.step_id, description: `Volume → ${(step.volume * 100).toFixed(0)}%` }),
    ]);
}

function compileMuteClip(step, ctx) {
    const clipRef = step.clip_id || '$first_clip';
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'updateClip', { clipId: clipRef, updates: { muted: true, volume: 0 } },
            { source_step_id: step.step_id, description: `Mute clip ${clipRef}` }),
    ]);
}

function compileRemoveFillerWords(step, ctx) {
    const filename     = step.file_path || '$uploaded_file';
    const symbolicRefs = filename === '$uploaded_file' ? ['$uploaded_file'] : [];
    return ok(step.step_id, [
        cmd(ENGINE.API, 'fillerDetect', {
            endpoint: '/api/audio/filler/detect',
            method: 'POST',
            payload:  { filename, language: step.language || 'en' },
            clip_id:  step.clip_id  || null,
            asset_id: step.asset_id || null,
        }, {
            source_step_id: step.step_id,
            symbolic_refs: symbolicRefs,
            description: step.asset_id
                ? `Remove filler words (asset ${step.asset_id})`
                : step.clip_id
                    ? `Remove filler words (clip ${step.clip_id})`
                    : 'Remove filler words (ums, uhs)',
        }),
    ]);
}

function compileNormalizeAudio(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'audioNormalize', {
            endpoint: '/api/audio/normalize',
            method: 'POST',
            payload: { filename: '$uploaded_file', target_lufs: step.target_lufs || -14 },
        }, { source_step_id: step.step_id, symbolic_refs: ['$uploaded_file'], description: 'Normalize audio levels' }),
    ]);
}

function compileDenoiseAudio(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'audioDenoise', {
            endpoint: '/api/audio/denoise',
            method: 'POST',
            payload: { filename: '$uploaded_file', strength: step.strength || 0.7 },
        }, { source_step_id: step.step_id, symbolic_refs: ['$uploaded_file'], description: 'Remove background noise' }),
    ]);
}

// ── NEW: remove_repeated_takes ─────────────────────────────────────────────────

/**
 * Detects repeated takes / speaker restarts and cuts them.
 * Routes to ENGINE.API → /api/ai/detect-repeated-takes.
 * If that endpoint doesn't exist yet, the API call returns gracefully
 * and the executor moves on — no crash.
 */
function compileRemoveRepeatedTakes(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'detectRepeatedTakes', {
            endpoint: '/api/ai/detect-repeated-takes',
            method: 'POST',
            payload: {
                filename: '$uploaded_file',
                lookback_window: step.lookback_window || 60,
                similarity_threshold: step.similarity_threshold || 0.72,
            },
        }, {
            source_step_id: step.step_id,
            symbolic_refs: ['$uploaded_file'],
            description: 'Detect and remove repeated takes / restart moments',
        }),
    ]);
}

// ── NEW: identify_quotable_moments ─────────────────────────────────────────────

/**
 * Analysis-only step — no edits are executed.
 * Deposits its configuration into ctx.computedValues so downstream steps
 * or the UI can access the quotable moments config.
 * The actual filtering happens in VideoEditorTools / ContentAnalyzer at runtime.
 */
function compileIdentifyQuotableMoments(step, ctx) {
    return skip(step.step_id, 'Identify quotable moments (analysis only — no edits)', {
        key: 'quotable_moments_config',
        value: {
            min_duration: step.min_duration || 15,
            max_duration: step.max_duration || 90,
            min_importance: step.min_importance || 0.6,
            max_results: step.max_results || 5,
        },
    });
}

// ── Effect commands ────────────────────────────────────────────────────────────

function compileAddTransition(step, ctx) {
    const validTypes = ['fade', 'dissolve', 'wipe', 'slide', 'zoom'];
    const enumErr = requireEnum(step.type, validTypes, 'transition type');
    if (enumErr) return validationError(step.step_id, enumErr, VALIDATION_ERRORS.INVALID_ENUM);
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'addTransition', { clipId: step.clip_id || '$first_clip', type: step.type || 'fade', duration: step.duration || 0.5 },
            { source_step_id: step.step_id, description: `Add ${step.type || 'fade'} transition` }),
    ]);
}

function compileAddFilter(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'addFilter', { clipId: step.clip_id || '$first_clip', filterType: step.filter_type, intensity: step.intensity || 0.5 },
            { source_step_id: step.step_id, description: `Add ${step.filter_type} filter` }),
    ]);
}

function compileAddText(step, ctx) {
    if (!step.text || !String(step.text).trim()) {
        return validationError(step.step_id, 'Text content required', VALIDATION_ERRORS.MISSING_FIELD);
    }
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'addTextOverlay', { text: String(step.text).trim(), position: step.position || 'center', duration: step.duration || 5.0, style: step.style || 'default' },
            { source_step_id: step.step_id, description: `Add text: "${step.text}"` }),
    ]);
}

function compileAddCaption(step, ctx) {
    if (!step.text || !String(step.text).trim()) {
        return validationError(step.step_id, 'Caption text required', VALIDATION_ERRORS.MISSING_FIELD);
    }
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'addTextOverlay', { text: String(step.text).trim(), position: step.position || 'bottom', duration: step.duration || 3.0, style: step.style || 'subtitle' },
            { source_step_id: step.step_id, description: `Add caption: "${step.text}"` }),
    ]);
}

function compileColorGrade(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'applyColorGrade', { clipId: step.clip_id || '$first_clip', adjustments: step.adjustments || {} },
            { source_step_id: step.step_id, description: 'Apply color grade' }),
    ]);
}

function compileAutoCaptions(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'autoCaptions', {
            endpoint: '/api/captions/generate',
            method: 'POST',
            payload: { filename: '$uploaded_file', language: step.language || 'en', style: step.style || 'default' },
        }, { source_step_id: step.step_id, symbolic_refs: ['$uploaded_file'], description: 'Generate auto-captions' }),
    ]);
}

// ── Export commands ─────────────────────────────────────────────────────────────

function compileValidateExportSettings(step, ctx) {
    const validFormats = ['mp4', 'mov', 'webm', 'gif'];
    const validQualities = ['4k', '1080p', '720p', '480p'];
    const fmtErr = requireEnum(step.format, validFormats, 'export format');
    if (fmtErr) return validationError(step.step_id, fmtErr, VALIDATION_ERRORS.INVALID_ENUM);
    const qErr = requireEnum(step.quality, validQualities, 'export quality');
    if (qErr) return validationError(step.step_id, qErr, VALIDATION_ERRORS.INVALID_ENUM);
    return skip(step.step_id, 'Export settings validated');
}

function compilePrepareExport(step, ctx) {
    const qualityMap = {
        '4k': { width: 3840, height: 2160, bitrate: '50M' },
        '1080p': { width: 1920, height: 1080, bitrate: '10M' },
        '720p': { width: 1280, height: 720, bitrate: '5M' },
        '480p': { width: 854, height: 480, bitrate: '2M' },
    };
    const q = qualityMap[step.quality] || qualityMap['1080p'];
    return ok(step.step_id, [
        cmd(ENGINE.MEDIABUNNY, 'convertFormat', { format: step.format || 'mp4', codec: step.codec || 'h264', audioCodec: step.audio_codec || 'aac', width: q.width, height: q.height, bitrate: q.bitrate },
            { source_step_id: step.step_id, description: `Export ${step.quality || '1080p'} ${step.format || 'mp4'}` }),
    ]);
}

function compileQueueExport(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'queueExport', {
            endpoint: '/api/export/queue',
            method: 'POST',
            payload: { commands: '$computed.export_commands' },
        }, { source_step_id: step.step_id, symbolic_refs: ['$computed.export_commands'], description: 'Queue export job' }),
    ]);
}

// ── Undo / Redo ────────────────────────────────────────────────────────────────

function compileUndo(step) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'undo', {}, { source_step_id: step.step_id, description: 'Undo' }),
    ]);
}

function compileRedo(step) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'redo', {}, { source_step_id: step.step_id, description: 'Redo' }),
    ]);
}

// ── Long-Form AI operations ────────────────────────────────────────────────────

/**
 * Compiles a seek_to step → ENGINE.STORE action so the executor moves the playhead.
 */
function compileSeekTo(step, ctx) {
    const time = typeof step.time === 'number' ? step.time : 0;
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'seek_to', { time },
            { source_step_id: step.step_id, description: `Seek to ${time}s` }),
    ]);
}

/**
 * cut_segment — delegates to VideoEditorTools.cutSegment() at runtime.
 */
function compileCutSegment(step, ctx) {
    if (step.start === undefined || step.end === undefined) {
        return validationError(step.step_id, 'cut_segment requires start and end', VALIDATION_ERRORS.MISSING_FIELD);
    }
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'cutSegment', { start: step.start, end: step.end },
            { source_step_id: step.step_id, description: `Cut ${step.start.toFixed(1)}s–${step.end.toFixed(1)}s` }),
    ]);
}

/**
 * add_transitions_to_sections — skipped at compile time; runtime VideoEditorTools handles it.
 */
function compileAddTransitionsToSections(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'add_transitions_to_sections', {
            type: step.type || 'fade',
            duration: step.duration || 0.5,
            apply_at: step.apply_at || 'section_boundaries',
        }, { source_step_id: step.step_id, description: `Add ${step.type || 'fade'} transitions` }),
    ]);
}

function compileAnalyzeStructure(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'analyzeStructure', { platform: step.platform || null, targetDuration: step.targetDuration || null },
            { source_step_id: step.step_id, description: 'Semantic content analysis' }),
    ]);
}

function compileLongFormEdit(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'longFormEdit', { editMode: step.editMode || 'CLEAN_EDIT', platform: step.platform || null, targetDuration: step.targetDuration || null },
            { source_step_id: step.step_id, description: `Long-form edit (${step.editMode || 'CLEAN_EDIT'})` }),
    ]);
}

function compileSmartCleanup(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'smart_cleanup', {},
            { source_step_id: step.step_id, description: 'Semantic cleanup — remove repetitions and false starts' }),
    ]);
}

function compileFindHook(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'findHook', {}, { source_step_id: step.step_id, description: 'Find best hook moment' }),
    ]);
}

function compileRemoveRepetition(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'removeRepetition', { importance_threshold: step.importance_threshold || 0.3 },
            { source_step_id: step.step_id, description: 'Remove repetitive / low-value segments' }),
    ]);
}

function compileReorderClips(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'reorder_clips', { prompt: step.prompt || '' },
            { source_step_id: step.step_id, description: `Reorder clips: "${(step.prompt || '').slice(0, 40)}"` }),
    ]);
}

function compileReorderSegment(step, ctx) {
    const clipRef = step.clip_id || '$first_clip';
    const trackRef = step.track_id || `$track_of(${clipRef})`;
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'reorderSegment', { clipId: clipRef, trackId: trackRef, targetPosition: step.targetPosition ?? 0 },
            { source_step_id: step.step_id, symbolic_refs: [clipRef, trackRef].filter(v => String(v).startsWith('$')), description: `Reorder segment to ${step.targetPosition ?? 0}s` }),
    ]);
}

function compileChat(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'chat', { message: step.message },
            { source_step_id: step.step_id, description: `Chat: ${step.message.substring(0, 20)}...` }),
    ]);
}

function compileCreateBrollTrack(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'createBrollTrack', { trackId: step.track_id },
            { source_step_id: step.step_id, description: 'Create B-Roll track' }),
    ]);
}

function compileMoveClipToTrack(step, ctx) {
    if (!step.clip_id)      return skipped(step.step_id, 'move_clip_to_track requires clip_id');
    if (!step.from_track_id) return skipped(step.step_id, 'move_clip_to_track requires from_track_id');
    if (!step.to_track_id)  return skipped(step.step_id, 'move_clip_to_track requires to_track_id');
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'moveClipToTrack',
            { fromTrackId: step.from_track_id, clipId: step.clip_id, toTrackId: step.to_track_id },
            { source_step_id: step.step_id, description: step.reason || `Move clip ${step.clip_id} to b-roll track` }),
    ]);
}

// ── Split speakers — "separate the two people" ────────────────────────────────
// Delegates to the split_speakers case in MediaExecutionEngine which:
//   1. Queues a diarize job (Node → Python diarize-service via multipart upload)
//   2. Polls until done → {words, speakers}
//   3. Calls /api/interview/build-tracks → {tracks: [{speaker, clips}]}
//   4. Creates one video track per speaker and fills it with their clips
function compileSplitSpeakers(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'split_speakers', { language: step.language || null },
            { source_step_id: step.step_id, description: 'Split video into per-speaker tracks (WhisperX + pyannote)' }),
    ]);
}

// ── Zoom rhythm — "make it feel multi-camera" ─────────────────────────────────
// Delegates to the rhythm_zoom case in MediaExecutionEngine.executeStoreAction,
// which calls /api/interview/rhythm-zoom and applies scale keyframes directly.
function compileRhythmZoom(step, ctx) {
    const VALID_STYLES = ['subtle', 'dynamic', 'cinematic'];
    const style = VALID_STYLES.includes(step.style) ? step.style : 'dynamic';
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'rhythm_zoom', { style },
            { source_step_id: step.step_id, description: `Zoom rhythm — ${style} style` }),
    ]);
}

// ── Semantic clip organizer — "organize my clips / auto-arrange" ───────────────
// Delegates to the organize_clips case in MediaExecutionEngine.executeStoreAction.
// Extracts one frame per asset via server-side ffmpeg, classifies with GPT-4o-mini
// Vision, then reorders clips on the timeline to match the recommended narrative order.
function compileOrganizeClips(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'organize_clips', {},
            { source_step_id: step.step_id, description: 'Analyze and auto-organize clips by semantic content' }),
    ]);
}

// ── Virtual multicam — "interview close shots / cut between speakers" ──────────
// Uses diarization data already in the store (from split-speakers or AssemblyAI)
// to assign camera angle metadata (wide / close_host / close_guest) to each
// timeline clip. PlaybackEngine applies the crop region at render time.
function compileVirtualMulticam(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'virtual_multicam', {},
            { source_step_id: step.step_id, description: 'Create virtual multicam angles from diarized interview footage' }),
    ]);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── Asset Engine commands (Creative Asset Intelligence System) ─────────────────
// All pure + synchronous — compile to ENGINE.API or ENGINE.STORE, never fetch.

function compileSearchAssets(step, ctx) {
    const q = step.query || step.q || '';
    return ok(step.step_id, [
        cmd(ENGINE.API, 'searchAssets', {
            endpoint: '/api/audio/search',
            method:   'POST',
            payload:  {
                query:      q,
                assetTypes: step.asset_types || step.assetTypes || null,
                intents:    step.intents    || null,
                limit:      step.limit      || 10,
            },
        }, { source_step_id: step.step_id, description: `Search assets: "${q}"` }),
    ]);
}

function compileSearchSFX(step, ctx) {
    return compileSearchAssets(
        { ...step, asset_types: ['SOUND_EFFECT'], query: step.query || step.sfx_query || '' },
        ctx
    );
}

function compileSearchLUTs(step, ctx) {
    const q = step.query || '';
    return ok(step.step_id, [
        cmd(ENGINE.API, 'searchLUTs', {
            endpoint: '/api/luts/search',
            method:   'POST',
            payload:  {
                query:         q,
                cinematicOnly: step.cinematic_only || false,
                limit:         step.limit || 10,
            },
        }, { source_step_id: step.step_id, description: `Search LUTs: "${q}"` }),
    ]);
}

function compileSearchPresets(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'searchPresets', {
            endpoint: '/api/presets',
            method:   'GET',
            payload:  { type: step.preset_type || null, limit: step.limit || 10 },
        }, { source_step_id: step.step_id, description: `Search presets${step.preset_type ? ` (${step.preset_type})` : ''}` }),
    ]);
}

function compileApplyLUT(step, ctx) {
    const lutId = step.lut_id || step.lutId || null;
    if (!lutId) return validationError(step.step_id, 'apply_lut requires lut_id', VALIDATION_ERRORS.MISSING_PARAM);
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'setProjectLUT', { lutId },
            { source_step_id: step.step_id, description: `Apply LUT: ${lutId}` }),
    ]);
}

function compileClearLUT(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'setProjectLUT', { lutId: null },
            { source_step_id: step.step_id, description: 'Clear LUT' }),
    ]);
}

function compileAddSFX(step, ctx) {
    const sfxId    = step.sfx_id    || step.assetId  || null;
    const assetUrl = step.asset_url || step.url       || null;
    const atTime   = step.at_time   != null ? step.at_time : '$playhead';
    if (!sfxId && !assetUrl) {
        return validationError(step.step_id, 'add_sfx requires sfx_id or asset_url', VALIDATION_ERRORS.MISSING_PARAM);
    }
    return ok(step.step_id, [
        cmd(ENGINE.STORE, 'addSFX', {
            sfxId,
            assetUrl,
            trackId:  step.track_id || '$audio_track',
            atTime,
            volume:   step.volume   ?? 0.8,
            fadeIn:   step.fade_in  ?? 0,
            fadeOut:  step.fade_out ?? 0,
            label:    step.label    || 'SFX',
        }, { source_step_id: step.step_id, description: `Add SFX at ${atTime}s` }),
    ]);
}

function compileApplyPreset(step, ctx) {
    const presetId = step.preset_id || step.presetId || null;
    if (!presetId) return validationError(step.step_id, 'apply_preset requires preset_id', VALIDATION_ERRORS.MISSING_PARAM);
    const isFullEdit = step.preset_type === 'FULL_EDIT' || step.is_full_edit === true;
    return ok(step.step_id, [
        cmd(ENGINE.API, 'applyPreset', {
            endpoint:          `/api/presets/${presetId}/apply`,
            method:            'POST',
            payload:           {
                projectId: step.project_id || '$project_id',
                approved:  isFullEdit ? (step.approved ?? false) : true,
            },
            requires_approval: isFullEdit,
        }, { source_step_id: step.step_id, description: `Apply preset ${presetId}` }),
    ]);
}

function compileExportAudio(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'exportAudio', {
            endpoint: '/api/audio/export',
            method:   'POST',
            payload:  {
                projectId:  step.project_id || '$project_id',
                format:     step.format     || 'mp3',
                bitrate:    step.bitrate    || '192k',
                normalize:  step.normalize  ?? false,
                trimStart:  step.trim_start || null,
                trimEnd:    step.trim_end   || null,
            },
            stream: true, // executor triggers browser download
        }, { source_step_id: step.step_id, description: `Export audio as ${step.format || 'mp3'}` }),
    ]);
}

function compileRecommendSFX(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'recommendSFX', {
            endpoint:        '/api/audio/recommend/sfx',
            method:          'POST',
            payload:         { limit: step.limit || 5 },
            fire_and_forget: true,
        }, { source_step_id: step.step_id, description: 'Fetch SFX recommendations' }),
    ]);
}

function compileRecommendLUTs(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'recommendLUTs', {
            endpoint:        '/api/luts/recommend',
            method:          'POST',
            payload:         { limit: step.limit || 3 },
            fire_and_forget: true,
        }, { source_step_id: step.step_id, description: 'Fetch LUT recommendations' }),
    ]);
}

function compileRecommendPresets(step, ctx) {
    return ok(step.step_id, [
        cmd(ENGINE.API, 'recommendPresets', {
            endpoint:        '/api/presets/recommend',
            method:          'POST',
            payload:         { presetType: step.preset_type || null, limit: step.limit || 5 },
            fire_and_forget: true,
        }, { source_step_id: step.step_id, description: 'Fetch preset recommendations' }),
    ]);
}

// §7  COMMAND REGISTRY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const COMMAND_REGISTRY = new Map([
    // Computation steps
    ['validate_clip_exists', { compiler: compileValidateClipExists }],
    ['validate_track_exists', { compiler: compileValidateTrackExists }],
    ['get_playhead_position', { compiler: compileGetPlayheadPosition }],
    ['compute_split_timestamp', { compiler: compileComputeSplitTimestamp }],
    ['compute_trim_bounds', { compiler: compileComputeTrimBounds }],
    ['compute_segment_range', { compiler: compileComputeSegmentRange }],

    // Edit commands
    ['add_clip', { compiler: compileAddClip }],
    ['split_clip', { compiler: compileSplitClip }],
    ['remove_clip', { compiler: compileRemoveClip }],
    ['ripple_delete', { compiler: compileRippleDelete }],
    ['trim_clip_start', { compiler: compileTrimClip }],
    ['trim_clip_end', { compiler: compileTrimClip }],
    ['duplicate_clip', { compiler: compileDuplicateClip }],
    ['set_clip_speed', { compiler: compileSetSpeed }],
    ['set_aspect_ratio', { compiler: compileSetAspectRatio }],

    // Audio commands
    ['silence_removal', { compiler: compileSilenceRemoval }],
    ['adjust_volume', { compiler: compileAdjustVolume }],
    ['mute_clip', { compiler: compileMuteClip }],
    ['remove_filler_words', { compiler: compileRemoveFillerWords }],
    ['normalize_audio', { compiler: compileNormalizeAudio }],
    ['denoise_audio', { compiler: compileDenoiseAudio }],
    ['audio_denoise', { compiler: compileDenoiseAudio }],  // alias

    // NEW long-form audio/analysis steps
    ['remove_repeated_takes', { compiler: compileRemoveRepeatedTakes }],
    ['identify_quotable_moments', { compiler: compileIdentifyQuotableMoments }],

    // Interview / talking-head / clip organization
    ['rhythm_zoom',      { compiler: compileRhythmZoom }],
    ['split_speakers',   { compiler: compileSplitSpeakers }],
    ['organize_clips',   { compiler: compileOrganizeClips }],
    ['virtual_multicam', { compiler: compileVirtualMulticam }],

    // Effect commands
    ['add_transition', { compiler: compileAddTransition }],
    ['add_filter', { compiler: compileAddFilter }],
    ['add_text_overlay', { compiler: compileAddText }],
    ['add_caption', { compiler: compileAddCaption }],
    ['color_grade', { compiler: compileColorGrade }],
    ['auto_captions', { compiler: compileAutoCaptions }],

    // Export commands
    ['validate_export_settings', { compiler: compileValidateExportSettings }],
    ['prepare_export', { compiler: compilePrepareExport }],
    ['queue_export', { compiler: compileQueueExport }],

    // Long-Form AI
    ['analyze_structure', { compiler: compileAnalyzeStructure }],
    ['long_form_edit', { compiler: compileLongFormEdit }],
    ['smart_cleanup', { compiler: compileSmartCleanup }],
    ['find_hook', { compiler: compileFindHook }],
    ['remove_repetition', { compiler: compileRemoveRepetition }],
    ['reorder_segment', { compiler: compileReorderSegment }],
    ['reorder_clips',   { compiler: compileReorderClips }],
    ['chat', { compiler: compileChat }],

    // Organize / B-Roll
    ['create_broll_track', { compiler: compileCreateBrollTrack }],
    ['move_clip_to_track', { compiler: compileMoveClipToTrack }],

    // Undo / Redo
    ['undo_action', { compiler: compileUndo }],
    ['redo_action', { compiler: compileRedo }],

    // Playback / navigation
    ['seek_to', { compiler: compileSeekTo }],

    // Additional long-form steps
    ['cut_segment', { compiler: compileCutSegment }],
    ['add_transitions_to_sections', { compiler: compileAddTransitionsToSections }],

    // Asset Engine — Creative Asset Intelligence System
    ['search_assets',     { compiler: compileSearchAssets }],
    ['search_sfx',        { compiler: compileSearchSFX }],
    ['search_luts',       { compiler: compileSearchLUTs }],
    ['search_presets',    { compiler: compileSearchPresets }],
    ['apply_lut',         { compiler: compileApplyLUT }],
    ['clear_lut',         { compiler: compileClearLUT }],
    ['add_sfx',           { compiler: compileAddSFX }],
    ['apply_preset',      { compiler: compileApplyPreset }],
    ['export_audio',      { compiler: compileExportAudio }],
    ['recommend_sfx',     { compiler: compileRecommendSFX }],
    ['recommend_luts',    { compiler: compileRecommendLUTs }],
    ['recommend_presets', { compiler: compileRecommendPresets }],
]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §8  FALLBACK COMPILER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function compileFallback(step, ctx) {
    const action = step.action;
    console.warn(`[CommandCompiler] ⚠️ No registry entry for "${action}" — using fallback`);
    if (action && typeof action === 'string') {
        const args = { ...step };
        delete args.action;
        delete args.step_id;
        return fallbackUsed(step.step_id, [
            cmd(ENGINE.STORE, action, args, { source_step_id: step.step_id, description: `Fallback: ${action}` }),
        ], `Unregistered action "${action}" compiled via fallback`);
    }
    return validationError(step.step_id, `Unknown action: ${action}`, VALIDATION_ERRORS.UNKNOWN_ACTION);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// §9  MAIN COMPILER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class CommandCompiler {
    static compile(plan, stateSnapshot = {}, mediaMetadata = {}) {
        console.log(`[CommandCompiler] Compiling plan: ${plan?.plan_id}`);

        // Confidence gate — block only LOW confidence, not MEDIUM
        if (plan?.intent && plan.intent.confidence === 'LOW') {
            console.error(`[CommandCompiler] Cannot compile plan with LOW confidence.`);
            return {
                success: false,
                plan_id: plan?.plan_id,
                error: 'INTENT_ERROR: Cannot compile plan with LOW confidence. Clarification required.',
                commands: [],
                outcomes: [],
                stats: { ok: 0, skipped: 0, errors: 1, fallbacks: 0 },
            };
        }

        if (!plan || !plan.steps || plan.steps.length === 0) {
            console.error('[CommandCompiler] Empty or invalid plan');
            return {
                success: false,
                plan_id: plan?.plan_id,
                error: 'Empty or invalid plan',
                commands: [],
                outcomes: [],
                stats: { ok: 0, skipped: 0, errors: 1, fallbacks: 0 },
            };
        }

        const ctx = Object.freeze({
            state: stateSnapshot,
            mediaMetadata,
            computedValues: {},
        });

        const commands = [];
        const outcomes = [];
        const stats = { ok: 0, skipped: 0, errors: 0, fallbacks: 0 };
        const deadline = performance.now() + COMPILE_TIMEOUT_MS;

        console.log(`[CommandCompiler] Processing ${plan.steps.length} steps...`);

        for (const step of plan.steps) {
            if (performance.now() > deadline) {
                console.error(`[CommandCompiler] ⏱ Timeout after ${COMPILE_TIMEOUT_MS}ms`);
                outcomes.push({ step_id: step.step_id, outcome: OUTCOME.TIMEOUT, detail: `Compilation exceeded ${COMPILE_TIMEOUT_MS}ms deadline` });
                stats.errors++;
                break;
            }

            try {
                const entry = COMMAND_REGISTRY.get(step.action);
                const compiler = entry ? entry.compiler : compileFallback;
                const result = compiler(step, ctx);

                if (result.computed) {
                    ctx.computedValues[result.computed.key] = result.computed.value;
                }

                outcomes.push({ step_id: result.step_id, outcome: result.outcome, detail: result.detail || null });

                switch (result.outcome) {
                    case OUTCOME.OK:
                        commands.push(...result.commands);
                        stats.ok++;
                        break;
                    case OUTCOME.SKIP:
                        stats.skipped++;
                        break;
                    case OUTCOME.VALIDATION_ERROR:
                        console.warn(`[CommandCompiler] ❌ Step ${step.step_id}: ${result.detail}`);
                        stats.errors++;
                        break;
                    case OUTCOME.FALLBACK_USED:
                        commands.push(...result.commands);
                        stats.fallbacks++;
                        break;
                }
            } catch (err) {
                console.error(`[CommandCompiler] Exception in step ${step.step_id}:`, err);
                outcomes.push({ step_id: step.step_id, outcome: OUTCOME.VALIDATION_ERROR, detail: err.message });
                stats.errors++;
            }
        }

        const success = stats.errors === 0;

        console.log(
            `[CommandCompiler] ${success ? '✅' : '❌'} Compiled: ${stats.ok} OK, ${stats.skipped} skipped, ${stats.errors} errors, ${stats.fallbacks} fallbacks → ${commands.length} commands`
        );

        return { success, plan_id: plan.plan_id, command_count: commands.length, commands, outcomes, stats };
    }

    static get registeredActions() {
        return [...COMMAND_REGISTRY.keys()];
    }

    static isRegistered(action) {
        return COMMAND_REGISTRY.has(action);
    }

    static register(action, compiler) {
        COMMAND_REGISTRY.set(action, { compiler });
    }
}

export default CommandCompiler;