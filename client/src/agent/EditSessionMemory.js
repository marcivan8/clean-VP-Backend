/**
 * EditSessionMemory
 * Tracks every AI-made edit during a session so IntentParser can
 * understand follow-up references like:
 *   "ease up the pacing"
 *   "you cut too much"
 *   "restore the intro"
 *   "what did you change?"
 *
 * Usage:
 *   import { editSessionMemory } from './EditSessionMemory.js';
 *
 *   // After a successful edit in EditJobManager:
 *   editSessionMemory.recordEdit(jobId, operation, description, planSteps);
 *   editSessionMemory.approveEdit(jobId);
 *
 *   // In IntentParser follow-up detection:
 *   const last = editSessionMemory.getLastEdit();
 */

const MAX_LOG_SIZE = 50;

export class EditSessionMemory {
    constructor() {
        /**
         * @type {Array<{
         *   jobId: string,
         *   operation: string,
         *   description: string,
         *   planSteps: object[],
         *   timestamp: number,
         *   wasApproved: boolean,
         *   stepCount: number,
         *   estimatedCutSeconds: number,
         * }>}
         */
        this.editLog = [];
        this.pendingJobId = null;   // Awaiting approval confirmation
    }

    // ── Recording ─────────────────────────────────────────────────────────────

    /**
     * Record an edit that was just planned (not yet approved/executed).
     * Call this after the plan is generated, before execution.
     */
    recordEdit(jobId, operation, description, planSteps = []) {
        // Estimate how many seconds the plan will cut
        const cutSeconds = planSteps
            .filter(s => s.action === 'cut_segment' || s.action === 'silence_removal')
            .reduce((sum, s) => sum + ((s.end || 0) - (s.start || 0)), 0);

        const entry = {
            jobId,
            operation,
            description,
            planSteps,
            stepCount: planSteps.length,
            estimatedCutSeconds: Math.round(cutSeconds),
            timestamp: Date.now(),
            wasApproved: false,
        };

        this.editLog.push(entry);
        this.pendingJobId = jobId;

        // Trim log
        if (this.editLog.length > MAX_LOG_SIZE) {
            this.editLog = this.editLog.slice(-MAX_LOG_SIZE);
        }

        console.log(`[EditSessionMemory] Recorded: ${operation} (${planSteps.length} steps)`);
        return entry;
    }

    /**
     * Mark an edit as approved and executed.
     * Call this after EditJobManager confirms the pipeline succeeded.
     */
    approveEdit(jobId) {
        const entry = this.editLog.find(e => e.jobId === jobId);
        if (entry) {
            entry.wasApproved = true;
            console.log(`[EditSessionMemory] Approved: ${entry.operation}`);
        }
        if (this.pendingJobId === jobId) {
            this.pendingJobId = null;
        }
    }

    // ── Querying ──────────────────────────────────────────────────────────────

    /** Returns the most recent approved edit, or null */
    getLastEdit() {
        const approved = this.editLog.filter(e => e.wasApproved);
        return approved.length > 0 ? approved[approved.length - 1] : null;
    }

    /** Returns the most recent edit of a specific operation type */
    getLastEditByOperation(operation) {
        const matches = this.editLog.filter(e => e.operation === operation && e.wasApproved);
        return matches.length > 0 ? matches[matches.length - 1] : null;
    }

    /** Returns all approved edits of a given operation type */
    getEditsByOperation(operation) {
        return this.editLog.filter(e => e.operation === operation && e.wasApproved);
    }

    /** Returns all approved edits, newest first */
    getAllEdits() {
        return [...this.editLog]
            .filter(e => e.wasApproved)
            .reverse();
    }

    /** True if there is at least one approved edit in this session */
    hasEdits() {
        return this.editLog.some(e => e.wasApproved);
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    /**
     * Returns a markdown string summarising what was done this session.
     * Displayed when the user asks "what did you change?" / "show me what you did".
     */
    getSummary() {
        const approved = this.editLog.filter(e => e.wasApproved);

        if (approved.length === 0) {
            return "I haven't made any edits yet this session. Tell me what you'd like to do with your video.";
        }

        let summary = `**Edits made this session (${approved.length} total):**\n\n`;

        approved.forEach((edit, i) => {
            const time = new Date(edit.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const cutInfo = edit.estimatedCutSeconds > 0
                ? ` — removed ~${this._formatSeconds(edit.estimatedCutSeconds)}`
                : '';
            summary += `${i + 1}. **${this._formatOperation(edit.operation)}**${cutInfo} _(${time})_\n`;
            if (edit.description) {
                const shortDesc = edit.description.replace(/[✓✗⚠️]/g, '').trim().slice(0, 120);
                summary += `   ${shortDesc}\n`;
            }
        });

        const totalCut = approved.reduce((sum, e) => sum + e.estimatedCutSeconds, 0);
        if (totalCut > 0) {
            summary += `\n**Total removed:** ~${this._formatSeconds(totalCut)}`;
        }

        return summary;
    }

    // ── Session control ───────────────────────────────────────────────────────

    /** Clear all session memory (e.g. when a new file is loaded) */
    clear() {
        this.editLog = [];
        this.pendingJobId = null;
        console.log('[EditSessionMemory] Session cleared');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _formatOperation(op) {
        const labels = {
            silence_removal: 'Silence removal',
            remove_filler_words: 'Filler word removal',
            trim_clip: 'Clip trim',
            split_clip: 'Clip split',
            set_clip_speed: 'Speed change',
            set_aspect_ratio: 'Aspect ratio change',
            long_form_edit: 'Long-form edit',
            analyze_structure: 'Content analysis',
            find_hook: 'Hook detection',
            remove_repetition: 'Repetition removal',
            remove_repeated_takes: 'Repeated take removal',
            adjust_volume: 'Volume adjustment',
            undo_action: 'Undo',
        };
        return labels[op] || op.replace(/_/g, ' ');
    }

    _formatSeconds(totalSeconds) {
        if (totalSeconds < 60) return `${totalSeconds}s`;
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
}

export const editSessionMemory = new EditSessionMemory();
export default EditSessionMemory;