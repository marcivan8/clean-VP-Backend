/**
 * server/brain/StoryIntelligence.js
 *
 * The STORY map (Sprint 6). One level above ProjectIntelligence.
 *
 *   media_assets         → "what is each clip?"            (R21/R38)
 *   project_intelligence → "what is this PROJECT?"         (R44)
 *   this file            → "does the CUT tell that story?" (R51)
 *
 * Everything before this reasons about the BIN — what footage exists. This
 * reasons about what the user actually ASSEMBLED: where the hook lands, where
 * the cut sags, whether the clip order delivers the through-line the project
 * map identified. Those are questions no per-clip or per-bin view can answer,
 * because they are properties of the SEQUENCE.
 *
 * THE RULES IT INHERITS, each from a bug already documented:
 *
 *  1. FINGERPRINTED ON THE CUT, not the bin (R29/R44). The bin changes on
 *     upload; the cut changes on every trim. Sharing the project map's
 *     fingerprint would mean either a stale story map or a GPT call per edit.
 *
 *  2. NO TRANSCRIPT ⇒ NO STORY MAP. Beats are a claim about meaning. Inferring
 *     them from clip durations alone is R30 exactly: a confident narrative read
 *     of content nobody looked at. Returns `insufficient_data` and writes a row
 *     saying so, rather than silently returning nothing (R38/R40's
 *     empty-vs-broken distinction).
 *
 *  3. NORMALISATION CONTAINS A WRONG ANSWER (R44). Beat names outside the
 *     vocabulary are clamped, timestamps outside the timeline are dropped, and
 *     clip ids the cut doesn't contain are discarded rather than stored — a
 *     hallucinated id handed to the Brain would be presented to the user as
 *     fact.
 *
 * Analysis only. This never mutates a timeline.
 */

'use strict';

const crypto = require('crypto');

const { supabaseAdmin } = require('../../config/database');
const { getAIClient, isAIConfigured } = require('../../services/AIProvider');

/** Beat vocabulary. Closed, because the Brain switches on these. */
const BEATS = ['hook', 'setup', 'build', 'turn', 'payoff', 'outro', 'filler'];

const HOOK_STRENGTHS = ['strong', 'adequate', 'weak', 'absent'];
const SEVERITIES     = ['low', 'medium', 'high'];

/** Below this many clips there is no sequence to reason about. */
const MIN_CLIPS_FOR_STORY = 2;

/** Transcript characters below which any beat reading would be guesswork. */
const MIN_TRANSCRIPT_CHARS = 120;

const MAX_CLIPS_IN_PROMPT = 60;

class StoryIntelligence {

    constructor({ openai = null } = {}) {
        // Injectable so the regression executes the real derivation logic
        // against a stub instead of reaching the network.
        this._openai = openai;
    }

    // ── Fingerprint ──────────────────────────────────────────────────────────

    /**
     * Hash of the CUT. Deliberately different inputs from ProjectIntelligence's:
     * clip ORDER and DURATIONS are what a story reading depends on, and both are
     * invisible to a bin-level hash.
     *
     * Transcript presence is included because a cut that has just gained its
     * transcript is materially different input — the previous map was derived
     * without meaning and must not survive.
     *
     * PURE. Executed directly by the regression.
     */
    computeCutFingerprint(clips = []) {
        // NOTE the absence of .sort() — deliberate, and the key difference from
        // ProjectIntelligence.computeFingerprint(), which sorts because a bin is
        // a SET. A cut is a SEQUENCE: reordering the same clips is a different
        // cut and must produce a different hash. The explicit index below is
        // belt-and-braces on top of that.
        const parts = (clips || [])
            .filter(c => c && c.id)
            .map((c, i) => [
                i,                                   // position IS the story
                c.id,
                Math.round((c.duration || 0) * 10),  // 100ms resolution
                (c.transcript || '').length > 0 ? 't' : '-',
            ].join(':'));
        return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /** Stored map, or null. Never throws. */
    async getMap(projectId, userId) {
        if (!projectId || !userId) return null;
        try {
            const { data, error } = await supabaseAdmin
                .from('story_intelligence')
                .select('*')
                .eq('project_id', projectId)
                .eq('user_id', userId)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (err) {
            console.warn('[StoryIntelligence] getMap failed:', err.message);
            return null;
        }
    }

    // ── Derive + persist ─────────────────────────────────────────────────────

    /**
     * Ensure a current story map exists, deriving one only when the CUT changed.
     *
     * @param {Object}  args
     * @param {Array}   args.clips       - assembled clips IN TIMELINE ORDER:
     *                                     { id, name, start, duration, transcript, role }
     * @param {Object}  [args.projectMap] - the project_intelligence row, for through-line
     * @returns {Promise<Object|null>}
     */
    async ensureMap({ projectId, userId, clips = [], projectMap = null, platform = null }) {
        if (!projectId || !userId) return null;

        const ordered = [...(clips || [])]
            .filter(c => c && c.id)
            .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

        const fingerprint = this.computeCutFingerprint(ordered);
        const existing    = await this.getMap(projectId, userId);

        if (existing && existing.fingerprint === fingerprint && existing.status === 'ok') {
            return existing; // The cut hasn't changed — do not pay for a model call.
        }

        // Rule 2: refuse rather than guess.
        const reason = this._insufficientReason(ordered);
        if (reason) {
            console.log(`[StoryIntelligence] project ${projectId}: ${reason} — not deriving`);
            return await this._persist({
                projectId, userId, fingerprint,
                clipCount: ordered.length,
                analysedSec: this._totalDuration(ordered),
                status: 'insufficient_data',
                map: { through_line_note: reason },
            }).catch(() => existing || null);
        }

        try {
            const derived = await this.deriveMap({ clips: ordered, projectMap, platform });
            if (!derived) return existing || null;

            return await this._persist({
                projectId, userId, fingerprint,
                clipCount: ordered.length,
                analysedSec: this._totalDuration(ordered),
                status: 'ok',
                map: derived,
            });
        } catch (err) {
            console.error(`[StoryIntelligence] derivation failed for ${projectId}:`, err.message);
            await this._persist({
                projectId, userId, fingerprint,
                clipCount: ordered.length,
                analysedSec: this._totalDuration(ordered),
                status: 'failed',
                map: {},
            }).catch(() => {});
            return existing || null;
        }
    }

    /**
     * Why this cut can't be read as a story, or null if it can.
     * PURE — the regression executes it directly.
     */
    _insufficientReason(clips = []) {
        if (clips.length < MIN_CLIPS_FOR_STORY) {
            return `only ${clips.length} clip(s) on the timeline — no sequence to read`;
        }
        const transcriptChars = clips
            .reduce((n, c) => n + (c.transcript || '').trim().length, 0);
        if (transcriptChars < MIN_TRANSCRIPT_CHARS) {
            return 'no usable transcript on the timeline — beats would be guesswork';
        }
        return null;
    }

    _totalDuration(clips = []) {
        return Math.round(
            clips.reduce((n, c) => n + (c.duration || 0), 0) * 10
        ) / 10;
    }

    /** One GPT call over the cut. Separated from persistence for testability. */
    async deriveMap({ clips = [], projectMap = null, platform = null }) {
        if (!clips.length) return null;
        if (!isAIConfigured()) {
            throw new Error('no AI provider configured — cannot derive a story map');
        }

        const openai = getAIClient({ timeout: 60_000 });
        if (!openai) throw new Error('AI client unavailable');

        const prompt = this.buildDerivationPrompt({ clips, projectMap, platform });

        const completion = await openai.chat.completions.create({
            model:           'gpt-4o',
            messages:        [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature:     0.2,
            max_tokens:      1500,
        });

        const raw = completion?.choices?.[0]?.message?.content;
        if (!raw) throw new Error('model returned no content');

        let parsed;
        try { parsed = JSON.parse(raw); }
        catch { throw new Error('model returned malformed JSON'); }

        return this.normalizeMap(parsed, clips);
    }

    /**
     * Build the prompt. PURE, so the regression can assert on what the model is
     * actually asked — including that it must not invent beats for clips whose
     * content it cannot see.
     */
    buildDerivationPrompt({ clips = [], projectMap = null, platform = null }) {
        const shown   = clips.slice(0, MAX_CLIPS_IN_PROMPT);
        const omitted = clips.length - shown.length;

        let cursor = 0;
        const lines = shown.map((c, i) => {
            const start = Math.round(cursor * 10) / 10;
            cursor += (c.duration || 0);
            const transcript = (c.transcript || '').trim().slice(0, 220);
            return [
                `${i + 1}. [${start}s–${Math.round(cursor * 10) / 10}s] id:${c.id}` +
                    ` "${c.name || 'untitled'}"${c.role ? ` (role: ${c.role})` : ''}`,
                transcript ? `     says: "${transcript}"` : '     says: (no transcript for this clip)',
            ].join('\n');
        }).join('\n');

        const throughLine = projectMap?.through_line
            ? `"${projectMap.through_line}"`
            : '(not established)';
        const projectType = projectMap?.project_type && projectMap.project_type !== 'unknown'
            ? projectMap.project_type
            : 'unknown';

        return `You are a senior editor reviewing an ASSEMBLED cut — not raw footage.

The clips below are in the exact order they play. Your job is to say whether
this SEQUENCE works as a story, and where it doesn't.

━━━ THE PROJECT ━━━
Type:         ${projectType}
Through-line: ${throughLine}
Platform:     ${platform || 'not specified'}
Total length: ${this._totalDuration(clips)}s across ${clips.length} clip(s)${omitted > 0 ? ` (showing first ${shown.length})` : ''}

━━━ THE CUT, IN ORDER ━━━
${lines}

━━━ HOW TO READ IT ━━━
• The HOOK is whatever makes someone keep watching. Say where it actually lands
  in seconds — if the strongest opening line is at 0:40, that is the finding,
  not "add a hook".
• A SAG is a stretch where nothing changes: no new information, no shift in
  energy, no visual change. Give real start/end seconds.
• Judge whether the order DELIVERS the through-line above. A cut can contain
  every needed piece and still bury the point.
• Only describe clips you can actually see content for. For a clip marked
  "(no transcript for this clip)" you may use its position and duration, but do
  NOT characterise what it says or shows.
• An empty issues list is a valid answer for a cut that works. Do not
  manufacture problems to fill the section.
• Every issue must point at a time in the cut, so the user can go look at it.

Return ONLY valid JSON:
{
  "beats": [
    { "beat": ${JSON.stringify(BEATS)}, "startSec": 0, "endSec": 0,
      "clipIds": ["<id>"], "summary": "<one sentence>" }
  ],
  "hook": { "atSec": 0, "strength": ${JSON.stringify(HOOK_STRENGTHS)}, "note": "<one sentence>" },
  "sagWindows": [
    { "startSec": 0, "endSec": 0, "reason": "<why it sags>", "severity": "low|medium|high" }
  ],
  "deliversThroughLine": true,
  "throughLineNote": "<one sentence on how the ORDER serves or buries the point>",
  "issues": [
    { "issue": "<what's wrong with this cut>", "severity": "low|medium|high",
      "suggestion": "<what to do>", "atSec": 0 }
  ]
}`;
    }

    /**
     * Coerce a model response into the stored shape.
     *
     * PURE. This is where a plausible-but-wrong narrative read stops: beats
     * outside the vocabulary are clamped, clip ids not in the cut are DROPPED
     * (a hallucinated id would otherwise be shown to the user as fact), and
     * timestamps outside the timeline are discarded rather than stored.
     */
    normalizeMap(parsed, clips = []) {
        const p = parsed || {};
        const validIds = new Set(clips.map(c => c && c.id).filter(Boolean));
        const totalSec = this._totalDuration(clips);

        const str = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null;
        const sec = (v) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) return null;
            // A timestamp past the end of the cut is not a real finding.
            return n > totalSec + 1 ? null : Math.round(n * 10) / 10;
        };

        const beats = Array.isArray(p.beats)
            ? p.beats
                .filter(b => b && BEATS.includes(b.beat))
                .map(b => ({
                    beat:     b.beat,
                    startSec: sec(b.startSec) ?? 0,
                    endSec:   sec(b.endSec) ?? 0,
                    clipIds:  Array.isArray(b.clipIds)
                        ? b.clipIds.filter(id => validIds.has(id))
                        : [],
                    summary:  str(b.summary),
                }))
            : [];

        const hook = p.hook || {};
        const sagWindows = Array.isArray(p.sagWindows)
            ? p.sagWindows
                .filter(s => s && str(s.reason) && sec(s.startSec) !== null)
                .map(s => ({
                    startSec: sec(s.startSec),
                    endSec:   sec(s.endSec) ?? sec(s.startSec),
                    reason:   str(s.reason),
                    severity: SEVERITIES.includes(s.severity) ? s.severity : 'medium',
                }))
            : [];

        const issues = Array.isArray(p.issues)
            ? p.issues
                .filter(i => i && str(i.issue))
                .map(i => ({
                    issue:      str(i.issue),
                    severity:   SEVERITIES.includes(i.severity) ? i.severity : 'medium',
                    suggestion: str(i.suggestion),
                    atSec:      sec(i.atSec),
                }))
            : [];

        return {
            beats,
            hook_at_sec:   sec(hook.atSec),
            hook_strength: HOOK_STRENGTHS.includes(hook.strength) ? hook.strength : 'absent',
            hook_note:     str(hook.note),
            sag_windows:   sagWindows,
            delivers_through_line:
                typeof p.deliversThroughLine === 'boolean' ? p.deliversThroughLine : null,
            through_line_note: str(p.throughLineNote),
            issues,
        };
    }

    // ── Private ──────────────────────────────────────────────────────────────

    async _persist({ projectId, userId, fingerprint, clipCount, analysedSec, status, map }) {
        const row = {
            project_id:   projectId,
            user_id:      userId,
            beats:        map.beats        ?? [],
            hook_at_sec:  map.hook_at_sec  ?? null,
            hook_strength: map.hook_strength ?? null,
            hook_note:    map.hook_note    ?? null,
            sag_windows:  map.sag_windows  ?? [],
            delivers_through_line: map.delivers_through_line ?? null,
            through_line_note:     map.through_line_note     ?? null,
            issues:       map.issues       ?? [],
            fingerprint,
            status,
            clip_count:   clipCount,
            analysed_sec: analysedSec,
            derived_at:   new Date().toISOString(),
            updated_at:   new Date().toISOString(),
        };

        // upsert, never .update() — an update matching zero rows reports NO
        // error in PostgREST, the mechanism that left media_assets empty (R38).
        const { data, error } = await supabaseAdmin
            .from('story_intelligence')
            .upsert(row, { onConflict: 'project_id' })
            .select()
            .maybeSingle();

        if (error) {
            console.error('[StoryIntelligence] persist failed:', error.message);
            throw error;
        }

        console.log(
            `[StoryIntelligence] project ${projectId}: story ${status} ` +
            `(${clipCount} clip(s), hook ${row.hook_strength || 'n/a'}` +
            `${row.hook_at_sec !== null ? ` @${row.hook_at_sec}s` : ''}, ` +
            `${(row.sag_windows || []).length} sag(s), ${(row.issues || []).length} issue(s))`
        );
        return data || row;
    }
}

module.exports = { StoryIntelligence, BEATS, HOOK_STRENGTHS };
