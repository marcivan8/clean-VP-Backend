/**
 * EditPlanner Agent
 *
 * FIX: planViaAPI() was calling fetch('/api/ai/generate-plan', ...) without an
 *      Authorization header. In production this returned 401, so every operation
 *      that fell through to the API (complex or unrecognized operations) silently
 *      failed with "Could not generate an edit plan."
 *
 *      All fetch() calls replaced with authFetch().
 */

import { authFetch } from '../utils/authFetch.js';
import { ContextGenerator } from './ContextGenerator.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { ClarificationGenerator } from './ClarificationGenerator.js';

export const ACTIONS = {
    COMPUTE_SPLIT_TIMESTAMP: 'compute_split_timestamp',
    COMPUTE_TRIM_BOUNDS: 'compute_trim_bounds',
    COMPUTE_SEGMENT_RANGE: 'compute_segment_range',
    VALIDATE_CLIP_EXISTS: 'validate_clip_exists',
    VALIDATE_TRACK_EXISTS: 'validate_track_exists',
    GET_PLAYHEAD_POSITION: 'get_playhead_position',
    SPLIT_CLIP: 'split_clip',
    REMOVE_CLIP: 'remove_clip',
    TRIM_CLIP_START: 'trim_clip_start',
    TRIM_CLIP_END: 'trim_clip_end',
    MOVE_CLIP: 'move_clip',
    DUPLICATE_CLIP: 'duplicate_clip',
    SET_CLIP_SPEED: 'set_clip_speed',
    SET_ASPECT_RATIO: 'set_aspect_ratio',
    RIPPLE_DELETE: 'ripple_delete',
    SILENCE_REMOVAL: 'silence_removal',
    ADJUST_VOLUME: 'adjust_volume',
    MUTE_CLIP: 'mute_clip',
    UNLINK_AUDIO: 'unlink_audio',
    ADD_TRANSITION: 'add_transition',
    ADD_FILTER: 'add_filter',
    ADD_TEXT_OVERLAY: 'add_text_overlay',
    COLOR_GRADE: 'color_grade',
    PREPARE_EXPORT: 'prepare_export',
    VALIDATE_EXPORT_SETTINGS: 'validate_export_settings',
    QUEUE_EXPORT: 'queue_export',
    CREATE_SNAPSHOT: 'create_snapshot',
    COMPARE_SNAPSHOTS: 'compare_snapshots',
    UNDO_ACTION: 'undo_action',
    REDO_ACTION: 'redo_action'
};

export class EditPlanner {

    static async generatePlan(intent, signal = null) {
        console.log('[AG_DEBUG] [EditPlanner] Generating plan for:', intent?.intent);

        if (!intent) {
            console.error('[AG_DEBUG] [EditPlanner] Error: No intent provided');
            return { success: false, error: 'No intent provided' };
        }

        if (intent.needs_clarification) {
            console.warn('[AG_DEBUG] [EditPlanner] Clarification needed:', intent.reason);
            return { success: false, error: intent.reason || 'Clarification needed' };
        }

        if (intent.confidence !== 'HIGH') {
            console.log(`[EditPlanner] Intent confidence is ${intent.confidence}. Requesting clarification.`);
            const questions = ClarificationGenerator.generate(intent);
            return {
                status: 'clarification_needed',
                missingParameters: intent.missingParameters,
                message: 'I need a few more details to proceed.',
                questions,
                originalIntent: intent
            };
        }

        const planId = this.generatePlanId();
        const state = useTimelineStore.getState();

        const durationCheck = this.validateDurationLogic(intent, state);
        if (durationCheck) {
            console.warn('[EditPlanner] Duration logic violation:', durationCheck);
            return {
                status: 'clarification_needed',
                missingParameters: [],
                message: durationCheck,
                questions: [],
                originalIntent: intent
            };
        }

        try {
            console.log(`[AG_DEBUG] [EditPlanner] Creating plan (ID: ${planId}) for operation: ${intent.operation}`);
            const plan = this.createPlan(intent, state, planId);

            if (!plan) {
                console.log('[AG_DEBUG] [EditPlanner] No local plan found, attempting API plan...');
                return await this.planViaAPI(intent, signal, planId);
            }

            console.log(`[AG_DEBUG] [EditPlanner] Plan generated successfully. Steps: ${plan.steps.length}`);
            return { success: true, plan };

        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('[EditPlanner] Error:', error);
            return { success: false, error: error.message };
        }
    }

    static validateDurationLogic(intent, state) {
        const { tracks, activeClipId } = state;

        let activeClip = null;
        for (const track of tracks) {
            const found = track.clips?.find(c => c.id === activeClipId);
            if (found) { activeClip = found; break; }
        }

        if (!activeClip) return null;

        const clipDuration = activeClip.duration || 0;
        const sourceDuration = activeClip.sourceDuration || clipDuration;
        const params = intent.parameters || intent.args || {};

        if (intent.operation === 'trim_clip' || intent.operation === 'set_duration') {
            const targetDuration = params.targetDuration || params.duration;
            if (targetDuration && targetDuration > clipDuration) {
                return `The selected clip is currently ${clipDuration.toFixed(1)} seconds long, so it cannot be trimmed to ${targetDuration} seconds. Would you like to extend it using slow motion, or select a different segment?`;
            }
        }

        if (intent.operation === 'set_clip_speed') {
            const speed = params.speed;
            if (speed && speed > 0) {
                const newDuration = sourceDuration / speed;
                if (newDuration > 3600) {
                    return `Setting speed to ${speed}x would make the clip ${(newDuration / 60).toFixed(0)} minutes long. This seems unintended. Did you mean a faster speed?`;
                }
            }
        }

        return null;
    }

    static createPlan(intent, state, planId) {
        const operation = intent.operation;
        const targets = intent.targets || [];
        const constraints = intent.constraints || {};
        const trackId = intent.target_track_id;

        let clipId = targets[0];
        let clip = this.findClip(state, clipId);

        if (!clip && !clipId) {
            const firstClip = this.findFirstClip(state);
            if (firstClip) {
                clip = firstClip;
                clipId = firstClip.id;
                console.log('[EditPlanner] Auto-selected clip:', clipId);
            }
        }

        const track = this.findTrack(state, trackId || clip?.trackId);

        switch (operation) {
            case 'split_clip': return this.planSplit(planId, clip, track, constraints, state);
            case 'cut_at_playhead': return this.planCutAtPlayhead(planId, clip, track, state);
            case 'cut_at_timestamp': return this.planCutAtTimestamp(planId, clip, track, constraints);
            case 'cut_segment': return this.planCutSegment(planId, constraints);
            case 'remove_clip': return this.planRemove(planId, clipId, track);
            case 'trim_clip': return this.planTrim(planId, clip, track, constraints);
            case 'duplicate_clip': return this.planDuplicate(planId, clip, track);
            case 'set_clip_speed': return this.planSpeedChange(planId, clip, track, constraints);
            case 'set_aspect_ratio': return this.planAspectRatio(planId, constraints);
            case 'silence_removal': return this.planSilenceRemoval(planId, constraints);
            case 'remove_filler_words': return this.planFillerRemoval(planId);
            case 'audio_denoise':
            case 'denoise_audio': return this.planAudioDenoise(planId, constraints);
            case 'normalize_audio': return this.planNormalizeAudio(planId, constraints);
            case 'auto_captions': return this.planAutoCaptions(planId, constraints);
            case 'adjust_volume': return this.planVolumeAdjust(planId, clip, constraints);
            case 'add_transition': return this.planAddTransition(planId, clip, constraints);
            case 'add_filter': return this.planAddFilter(planId, clip, constraints);
            case 'add_text': return this.planAddText(planId, constraints);
            case 'color_grade': return this.planColorGrade(planId, clip, constraints);
            case 'export_video': return this.planExport(planId, constraints);
            case 'compare_versions': return this.planCompare(planId);
            case 'undo_action': return this.planUndo(planId);
            case 'redo_action': return this.planRedo(planId);
            case 'analyze_structure': return this.planAnalyzeStructure(planId, constraints);
            case 'long_form_edit': return this.planLongFormEdit(planId, constraints);
            case 'build_from_rushes': return this.planLongFormEdit(planId, { ...constraints, editMode: 'FULL_BUILD' });
            case 'find_hook': return this.planFindHook(planId);
            case 'remove_repetition': return this.planRemoveRepetition(planId);
            case 'reorder_segment': return this.planReorderSegment(planId, constraints);
            default: return null;
        }
    }

    // ── Plan Generators ───────────────────────────────────────────────────────

    static planSplit(planId, clip, track, constraints, state) {
        if (!clip || !track) return this.errorPlan(planId, 'No clip selected for split');

        const steps = [];
        let stepNum = 1;

        steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.VALIDATE_CLIP_EXISTS, clip_id: clip.id, track_id: track.id });

        const mode = constraints.mode || 'midpoint';
        let timestamp = null;

        if (mode === 'timestamp' && constraints.timestamp !== undefined) {
            timestamp = constraints.timestamp;
        } else if (mode === 'playhead') {
            steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.GET_PLAYHEAD_POSITION, output: 'split_timestamp' });
        } else {
            steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.COMPUTE_SPLIT_TIMESTAMP, clip_id: clip.id, clip_start: clip.start, clip_duration: clip.duration, mode, output: 'split_timestamp' });
        }

        steps.push({ step_id: `step_${stepNum++}`, action: ACTIONS.SPLIT_CLIP, clip_id: clip.id, track_id: track.id, timestamp, use_computed: timestamp === null ? 'split_timestamp' : null });

        return this.buildPlan(planId, 'split_clip', steps);
    }

    static planCutAtPlayhead(planId, clip, track, state) {
        return this.buildPlan(planId, 'cut_at_playhead', [
            { step_id: 'step_1', action: ACTIONS.GET_PLAYHEAD_POSITION, output: 'cut_timestamp' },
            { step_id: 'step_2', action: ACTIONS.SPLIT_CLIP, clip_id: clip?.id, track_id: track?.id, use_computed: 'cut_timestamp' }
        ]);
    }

    static planCutAtTimestamp(planId, clip, track, constraints) {
        if (constraints.timestamp === undefined) return this.errorPlan(planId, 'No timestamp specified for cut');
        return this.buildPlan(planId, 'cut_at_timestamp', [
            { step_id: 'step_1', action: ACTIONS.SPLIT_CLIP, clip_id: clip?.id, track_id: track?.id, timestamp: constraints.timestamp }
        ]);
    }

    static planCutSegment(planId, constraints) {
        if (!constraints.start || !constraints.end) return this.errorPlan(planId, 'No time range specified for segment cut');
        return this.buildPlan(planId, 'cut_segment', [
            { step_id: 'step_1', action: ACTIONS.COMPUTE_SEGMENT_RANGE, start: constraints.start, end: constraints.end, output: 'segment_info' },
            { step_id: 'step_2', action: ACTIONS.SPLIT_CLIP, at_time: constraints.start, reason: 'segment_start' },
            { step_id: 'step_3', action: ACTIONS.SPLIT_CLIP, at_time: constraints.end, reason: 'segment_end' },
            { step_id: 'step_4', action: ACTIONS.REMOVE_CLIP, use_computed: 'segment_info', reason: 'remove_cut_segment' },
            { step_id: 'step_5', action: ACTIONS.RIPPLE_DELETE, at_time: constraints.start, reason: 'close_gap' }
        ]);
    }

    static planRemove(planId, clipId, track) {
        if (!clipId) return this.errorPlan(planId, 'No clip specified for removal');
        return this.buildPlan(planId, 'remove_clip', [
            { step_id: 'step_1', action: ACTIONS.VALIDATE_CLIP_EXISTS, clip_id: clipId },
            { step_id: 'step_2', action: ACTIONS.REMOVE_CLIP, clip_id: clipId, track_id: track?.id }
        ]);
    }

    static planTrim(planId, clip, track, constraints) {
        if (!clip) return this.errorPlan(planId, 'No clip selected for trim');

        let trimAmount = constraints.duration;
        if (constraints.targetDuration !== undefined) {
            trimAmount = clip.duration - constraints.targetDuration;
            if (trimAmount <= 0) return this.errorPlan(planId, `Clip is already ${clip.duration.toFixed(1)}s, cannot trim to ${constraints.targetDuration}s`);
        }

        const steps = [
            { step_id: 'step_1', action: ACTIONS.COMPUTE_TRIM_BOUNDS, clip_id: clip.id, current_start: clip.start, current_duration: clip.duration, trim_amount: trimAmount, target_duration: constraints.targetDuration, trim_from: constraints.from || 'end' }
        ];

        if (constraints.from === 'start') {
            steps.push({ step_id: 'step_2', action: ACTIONS.TRIM_CLIP_START, clip_id: clip.id, track_id: track?.id, use_computed: 'trim_bounds' });
        } else {
            steps.push({ step_id: 'step_2', action: ACTIONS.TRIM_CLIP_END, clip_id: clip.id, track_id: track?.id, use_computed: 'trim_bounds' });
        }

        return this.buildPlan(planId, 'trim_clip', steps);
    }

    static planDuplicate(planId, clip, track) {
        if (!clip) return this.errorPlan(planId, 'No clip selected to duplicate');
        return this.buildPlan(planId, 'duplicate_clip', [
            { step_id: 'step_1', action: ACTIONS.DUPLICATE_CLIP, clip_id: clip.id, track_id: track?.id, insert_after: true }
        ]);
    }

    static planSpeedChange(planId, clip, track, constraints) {
        return this.buildPlan(planId, 'set_clip_speed', [
            { step_id: 'step_1', action: ACTIONS.SET_CLIP_SPEED, clip_id: clip?.id, track_id: track?.id, speed: constraints.speed || 1.0, maintain_pitch: true }
        ]);
    }

    static planAspectRatio(planId, constraints) {
        return this.buildPlan(planId, 'set_aspect_ratio', [
            { step_id: 'step_1', action: ACTIONS.SET_ASPECT_RATIO, ratio: constraints.ratio || '16:9', reframe_mode: 'auto_center' }
        ]);
    }

    static planSilenceRemoval(planId, constraints) {
        return this.buildPlan(planId, 'silence_removal', [
            { step_id: 'step_1', action: ACTIONS.SILENCE_REMOVAL, threshold: constraints.threshold || '-30dB', min_duration: constraints.min_duration || 0.5, padding: constraints.padding || 0.1 }
        ]);
    }

    static planFillerRemoval(planId) {
        return this.buildPlan(planId, 'remove_filler_words', [{ step_id: 'step_1', action: 'remove_filler_words' }]);
    }

    static planAudioDenoise(planId, constraints) {
        return this.buildPlan(planId, 'denoise_audio', [{ step_id: 'step_1', action: 'denoise_audio', strength: constraints?.strength || 0.7 }]);
    }

    static planNormalizeAudio(planId, constraints) {
        return this.buildPlan(planId, 'normalize_audio', [{ step_id: 'step_1', action: 'normalize_audio', target_lufs: constraints?.target_lufs || -14 }]);
    }

    static planAutoCaptions(planId, constraints) {
        return this.buildPlan(planId, 'auto_captions', [{ step_id: 'step_1', action: 'auto_captions', language: constraints?.language || 'en', style: constraints?.style || 'default' }]);
    }

    static planVolumeAdjust(planId, clip, constraints) {
        return this.buildPlan(planId, 'adjust_volume', [
            { step_id: 'step_1', action: ACTIONS.ADJUST_VOLUME, clip_id: clip?.id, volume: constraints.volume, normalize: constraints.normalize || false }
        ]);
    }

    static planAddTransition(planId, clip, constraints) {
        return this.buildPlan(planId, 'add_transition', [
            { step_id: 'step_1', action: ACTIONS.ADD_TRANSITION, clip_id: clip?.id, type: constraints.type || 'fade', duration: constraints.duration || 0.5, position: 'between_clips' }
        ]);
    }

    static planAddFilter(planId, clip, constraints) {
        return this.buildPlan(planId, 'add_filter', [
            { step_id: 'step_1', action: ACTIONS.ADD_FILTER, clip_id: clip?.id, filter_type: constraints.type, intensity: constraints.intensity || 0.5 }
        ]);
    }

    static planAddText(planId, constraints) {
        return this.buildPlan(planId, 'add_text', [
            { step_id: 'step_1', action: ACTIONS.ADD_TEXT_OVERLAY, text: constraints.text, position: constraints.position || 'center', duration: constraints.duration || 5.0, style: constraints.style || 'default' }
        ]);
    }

    static planColorGrade(planId, clip, constraints) {
        return this.buildPlan(planId, 'color_grade', [
            { step_id: 'step_1', action: ACTIONS.COLOR_GRADE, clip_id: clip?.id, adjustments: { brightness: constraints.brightness, contrast: constraints.contrast, saturation: constraints.saturation, temperature: constraints.temperature } }
        ]);
    }

    static planExport(planId, constraints) {
        return this.buildPlan(planId, 'export_video', [
            { step_id: 'step_1', action: ACTIONS.VALIDATE_EXPORT_SETTINGS, format: constraints.format || 'mp4', quality: constraints.quality || '1080p' },
            { step_id: 'step_2', action: ACTIONS.PREPARE_EXPORT, format: constraints.format || 'mp4', quality: constraints.quality || '1080p', codec: 'h264', audio_codec: 'aac' },
            { step_id: 'step_3', action: ACTIONS.QUEUE_EXPORT }
        ]);
    }

    static planCompare(planId) {
        return this.buildPlan(planId, 'compare_versions', [
            { step_id: 'step_1', action: ACTIONS.CREATE_SNAPSHOT, snapshot_type: 'current_state' },
            { step_id: 'step_2', action: ACTIONS.COMPARE_SNAPSHOTS, compare_mode: 'side_by_side' }
        ]);
    }

    static planUndo(planId) {
        return this.buildPlan(planId, 'undo', [{ step_id: 'step_1', action: ACTIONS.UNDO_ACTION }]);
    }

    static planRedo(planId) {
        return this.buildPlan(planId, 'redo', [{ step_id: 'step_1', action: ACTIONS.REDO_ACTION }]);
    }

    static planAnalyzeStructure(planId, constraints) {
        return {
            plan_id: planId, operation: 'analyze_structure', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'analyze_structure', platform: constraints?.platform || null, targetDuration: constraints?.targetDuration || null, reason: 'Semantic content analysis — results will be shown for approval before any edits are made' }]
        };
    }

    static planLongFormEdit(planId, constraints) {
        return {
            plan_id: planId, operation: 'long_form_edit', step_count: 1, requiresApproval: true, constraints: constraints || {},
            steps: [{ step_id: 'step_1', action: 'long_form_edit', editMode: constraints?.editMode || 'CLEAN_EDIT', platform: constraints?.platform || null, targetDuration: constraints?.targetDuration || null, reason: 'Long-form edit plan will be generated and shown for approval' }]
        };
    }

    static planFindHook(planId) {
        return {
            plan_id: planId, operation: 'find_hook', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'find_hook', reason: 'Scan content analysis for the highest-energy opening segment' }]
        };
    }

    static planRemoveRepetition(planId) {
        return {
            plan_id: planId, operation: 'remove_repetition', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'remove_repetition', importance_threshold: 0.3, reason: 'Remove segments flagged as low-value or repetitive' }]
        };
    }

    static planReorderSegment(planId, constraints) {
        if (!constraints?.clipId && !constraints?.segmentIndex) return this.errorPlan(planId, 'No segment specified for reorder');
        return {
            plan_id: planId, operation: 'reorder_segment', step_count: 1, requiresApproval: true,
            steps: [{ step_id: 'step_1', action: 'reorder_segment', clip_id: constraints.clipId, track_id: constraints.trackId, target_position: constraints.targetPosition ?? 0, reason: constraints.reason || 'Reorder segment for narrative structure' }]
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    static buildPlan(planId, operation, steps) {
        return { plan_id: planId, operation, step_count: steps.length, steps };
    }

    static errorPlan(planId, error) {
        return { plan_id: planId, operation: 'error', error, steps: [] };
    }

    static generatePlanId() {
        return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    static findClip(state, clipId) {
        if (!clipId) return null;
        for (const track of state.tracks || []) {
            const clip = track.clips?.find(c => c.id === clipId);
            if (clip) return { ...clip, trackId: track.id };
        }
        return null;
    }

    static findTrack(state, trackId) {
        if (!trackId) return null;
        return state.tracks?.find(t => t.id === trackId) || null;
    }

    static findFirstClip(state) {
        for (const track of state.tracks || []) {
            if (track.clips && track.clips.length > 0) {
                return { ...track.clips[0], trackId: track.id };
            }
        }
        return null;
    }

    /**
     * Call API for complex planning
     * FIX: was fetch('/api/ai/generate-plan', ...) — no auth → 401 in production
     */
    static async planViaAPI(intent, signal, planId) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            const context = ContextGenerator.getTimelineContext();

            // FIX: replaced fetch() with authFetch()
            const response = await authFetch('/api/ai/generate-plan', {
                method: 'POST',
                body: JSON.stringify({ intent, context }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return { success: false, error: 'API planning failed' };
            }

            const result = await response.json();
            return {
                success: true,
                plan: { plan_id: planId, ...result.plan }
            };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw error;
            return { success: false, error: error.message };
        }
    }
}

export default EditPlanner;