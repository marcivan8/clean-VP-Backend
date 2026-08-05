/**
 * server/brain/ProjectIntelligence.js
 *
 * The PROJECT MAP (Sprint 5). One level up from media_assets.
 *
 *   media_assets  → "what is each clip?"          (R21/R38)
 *   this file     → "what is this PROJECT?"       (R44)
 *
 * Derives project type, through-line, per-asset roles, and coverage gaps from
 * the analysed asset profiles plus the timeline shape, persists them to
 * `project_intelligence`, and hands them to the Editorial Brain.
 *
 * THREE DESIGN RULES, each of which exists because of a bug already documented
 * in CLAUDE.md:
 *
 *  1. RE-DERIVATION IS FINGERPRINT-GATED. Deriving the map costs a GPT call over
 *     the whole bin. `computeFingerprint()` hashes exactly the inputs the map
 *     depends on; if it hasn't changed, the stored row is returned untouched.
 *     Without this the map either costs a model call per request or silently
 *     goes stale — the same trap as R29's recomputed-on-every-reload analysis.
 *
 *  2. AN UNANALYSED BIN PRODUCES NO MAP, NOT A GUESSED ONE. If no asset has a
 *     completed profile there is nothing to reason from, and inventing a
 *     project type from filenames and durations is R30's exact failure: a
 *     confident answer over an analysis that never ran. `deriveMap()` returns
 *     `{ status: 'insufficient_data' }` and writes nothing.
 *
 *  3. FAILURE IS RECORDED, NOT SWALLOWED. A derivation that throws writes
 *     `status: 'failed'` rather than leaving the row absent, so a persistently
 *     broken map is distinguishable from a project nobody has opened (R38/R40).
 *
 * Everything here degrades safely: `getMap()` never throws, and a null map
 * simply means the Brain reasons without project-level context, exactly as it
 * did before this file existed.
 */

'use strict';

const crypto = require('crypto');

const { getAIClient, isAIConfigured } = require('../../services/AIProvider');
const { supabaseAdmin } = require('../../config/database');
const { ASSET_ANALYSIS_DONE } = require('./media/analysisStatus');

/** Project types the model may choose from. Kept closed so the value is usable. */
const PROJECT_TYPES = [
    'interview', 'tutorial', 'vlog', 'product_demo',
    'montage', 'presentation', 'narrative', 'unknown',
];

/** Roles an asset can play. Also closed — the Brain switches on these. */
const ASSET_ROLES = [
    'a_roll', 'b_roll', 'intro', 'outro', 'demo', 'cutaway', 'supporting',
];

const MAX_ASSETS_IN_PROMPT = 40;

class ProjectIntelligence {

    constructor({ openai = null } = {}) {
        // Injectable so the regression can execute the real derivation logic
        // against a stub instead of reaching the network.
        this._openai = openai;
    }

    // ── Fingerprint ──────────────────────────────────────────────────────────

    /**
     * Hash of everything the map depends on. Changing ANY of these should
     * invalidate the stored map; changing anything else should not.
     *
     * Deliberately includes each asset's analysis_status: a bin that gains a
     * completed profile is materially different input even though the asset
     * list is identical, and a map derived from a half-analysed bin must not
     * survive once the rest finishes.
     *
     * PURE — no I/O. Exported behaviour, executed directly by the regression.
     */
    computeFingerprint(assets = [], clipCount = 0) {
        const parts = (assets || [])
            .filter(a => a && a.id)
            .map(a => `${a.id}:${a.analysis_status || 'none'}`)
            .sort();
        parts.push(`clips:${clipCount}`);
        return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /**
     * Return the stored map for a project, or null.
     * Never throws — a missing map must degrade to "no project context", not to
     * a failed request.
     */
    async getMap(projectId, userId) {
        if (!projectId || !userId) return null;
        try {
            const { data, error } = await supabaseAdmin
                .from('project_intelligence')
                .select('*')
                .eq('project_id', projectId)
                .eq('user_id', userId)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (err) {
            console.warn('[ProjectIntelligence] getMap failed:', err.message);
            return null;
        }
    }

    // ── Derive + persist ─────────────────────────────────────────────────────

    /**
     * Ensure a current map exists for this project, deriving one only when the
     * inputs have actually changed.
     *
     * @returns {Promise<Object|null>} the map row, or null when there isn't one
     */
    async ensureMap({ projectId, userId, assets = [], clipCount = 0, platform = null }) {
        if (!projectId || !userId) return null;

        const analysed = (assets || []).filter(a => a && a.analysis_status === ASSET_ANALYSIS_DONE);
        const fingerprint = this.computeFingerprint(assets, clipCount);

        const existing = await this.getMap(projectId, userId);
        if (existing && existing.fingerprint === fingerprint && existing.status === 'ok') {
            return existing; // Nothing changed — do not pay for a model call.
        }

        // Rule 2: no analysed footage ⇒ no map. Guessing here would produce a
        // confident description of material nobody has looked at.
        if (analysed.length === 0) {
            console.log(
                `[ProjectIntelligence] project ${projectId}: no analysed assets ` +
                `(${assets.length} in bin) — skipping derivation`
            );
            return existing || null;
        }

        try {
            const derived = await this.deriveMap({ assets: analysed, clipCount, platform });
            if (!derived) return existing || null;

            return await this._persist({
                projectId, userId, fingerprint,
                assetCount: analysed.length,
                status: 'ok',
                map: derived,
            });
        } catch (err) {
            // Rule 3: record the failure so it's visible.
            console.error(`[ProjectIntelligence] derivation failed for ${projectId}:`, err.message);
            await this._persist({
                projectId, userId, fingerprint,
                assetCount: analysed.length,
                status: 'failed',
                map: {},
            }).catch(() => {});
            return existing || null;
        }
    }

    /**
     * One GPT call over the analysed bin. Returns the raw map fields.
     * Separated from persistence so it can be tested without a database.
     */
    async deriveMap({ assets = [], clipCount = 0, platform = null }) {
        if (!assets.length) return null;

        const openai = this._resolveOpenAI();
        if (!openai) {
            throw new Error('OPENAI_API_KEY not configured — cannot derive a project map');
        }

        const prompt = this.buildDerivationPrompt({ assets, clipCount, platform });

        const completion = await openai.chat.completions.create({
            model:           'gpt-4o',
            messages:        [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature:     0.15,
            max_tokens:      1200,
        });

        const raw = completion?.choices?.[0]?.message?.content;
        if (!raw) throw new Error('model returned no content');

        let parsed;
        try { parsed = JSON.parse(raw); }
        catch { throw new Error('model returned malformed JSON'); }

        return this.normalizeMap(parsed, assets);
    }

    /**
     * Build the derivation prompt. PURE — no I/O, so the regression can assert
     * on what the model is actually asked (including that it is told not to
     * invent detail for assets it has no description of).
     */
    buildDerivationPrompt({ assets = [], clipCount = 0, platform = null }) {
        const shown = assets.slice(0, MAX_ASSETS_IN_PROMPT);
        const omitted = assets.length - shown.length;

        const assetLines = shown.map((a, i) => {
            const bits = [
                a.scene_type && `scene: ${a.scene_type}`,
                a.camera_angle && `framing: ${a.camera_angle}`,
                typeof a.subject_count === 'number' && `${a.subject_count} on camera`,
                a.is_broll && 'B-ROLL',
                a.is_screen_recording && 'screen recording',
                a.has_main_speaker && 'has a main speaker',
                a.location_type && `location: ${a.location_type}`,
                a.emotional_tone && `tone: ${a.emotional_tone}`,
                a.has_spoken_word === false && 'no speech',
            ].filter(Boolean).join(', ');

            const transcript = (a.transcript_text || '').slice(0, 200).trim();

            return [
                `Asset ${i + 1} [id: ${a.id}] "${a.name || 'untitled'}"`,
                a.content_description ? `  Describes : ${a.content_description}` : '',
                bits ? `  Signals   : ${bits}` : '',
                transcript ? `  Transcript: "${transcript}"` : '',
            ].filter(Boolean).join('\n');
        }).join('\n\n');

        return `You are a senior video editor building a working map of an edit project.

You are given every analysed clip in the media bin. Your job is to say what the
PROJECT is — not to describe the clips again one by one.

━━━ FOOTAGE (${assets.length} analysed asset${assets.length === 1 ? '' : 's'}${omitted > 0 ? `, showing first ${shown.length}` : ''}) ━━━
${assetLines}

━━━ TIMELINE ━━━
Clips currently placed: ${clipCount}
Target platform: ${platform || 'not specified'}

━━━ RULES ━━━
• Reason about the assets TOGETHER. The point is the relationship between them:
  which is the spine, which support it, what the whole thing adds up to.
• Base every claim on the descriptions above. If the material doesn't tell you
  something (audience, for instance), return null for it rather than guessing.
• coverage_gaps is what the project NEEDS and does not have — e.g. a long
  talking-head stretch with no cutaways, no intro, no outro, no establishing
  shot. Only list a gap you can point at evidence for. An empty list is a
  perfectly good answer for a complete project; do not invent gaps to fill it.
• "serves" is only meaningful for supporting footage (b_roll, cutaway). Use the
  id or name of the asset it supports, or the topic it illustrates. null otherwise.

Return ONLY valid JSON:
{
  "project_type": ${JSON.stringify(PROJECT_TYPES)},   // pick exactly one
  "through_line": "<one sentence: what this video is actually about>",
  "target_audience": "<who it's for, or null>",
  "tone": "<educational | conversational | promotional | personal | dramatic | null>",
  "asset_roles": [
    { "assetId": "<id>", "role": ${JSON.stringify(ASSET_ROLES)}, "serves": "<id, topic, or null>" }
  ],
  "coverage_gaps": [
    { "gap": "<what's missing>", "severity": "low|medium|high", "suggestion": "<what to shoot or add>" }
  ]
}`;
    }

    /**
     * Coerce a model response into the stored shape.
     *
     * PURE. This is where a plausible-but-wrong answer gets contained: roles are
     * clamped to the closed vocabulary, asset ids are checked against the bin
     * that was actually sent (a hallucinated id is dropped, not stored), and
     * every field falls back to a safe empty rather than undefined.
     */
    normalizeMap(parsed, assets = []) {
        const validIds = new Set((assets || []).map(a => a && a.id).filter(Boolean));
        const p = parsed || {};

        const projectType = PROJECT_TYPES.includes(p.project_type) ? p.project_type : 'unknown';

        const asString = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null;

        const assetRoles = Array.isArray(p.asset_roles)
            ? p.asset_roles
                .filter(r => r && validIds.has(r.assetId))
                .map(r => ({
                    assetId: r.assetId,
                    name:    (assets.find(a => a.id === r.assetId) || {}).name || null,
                    role:    ASSET_ROLES.includes(r.role) ? r.role : 'supporting',
                    serves:  asString(r.serves),
                }))
            : [];

        const coverageGaps = Array.isArray(p.coverage_gaps)
            ? p.coverage_gaps
                .filter(g => g && asString(g.gap))
                .map(g => ({
                    gap:        asString(g.gap),
                    severity:   ['low', 'medium', 'high'].includes(g.severity) ? g.severity : 'medium',
                    suggestion: asString(g.suggestion),
                }))
            : [];

        return {
            project_type:    projectType,
            through_line:    asString(p.through_line),
            target_audience: asString(p.target_audience),
            tone:            asString(p.tone),
            asset_roles:     assetRoles,
            coverage_gaps:   coverageGaps,
        };
    }

    // ── Private ──────────────────────────────────────────────────────────────

    async _persist({ projectId, userId, fingerprint, assetCount, status, map }) {
        const row = {
            project_id:      projectId,
            user_id:         userId,
            project_type:    map.project_type    ?? null,
            through_line:    map.through_line    ?? null,
            target_audience: map.target_audience ?? null,
            tone:            map.tone            ?? null,
            asset_roles:     map.asset_roles     ?? [],
            coverage_gaps:   map.coverage_gaps   ?? [],
            fingerprint,
            status,
            asset_count:     assetCount,
            derived_at:      new Date().toISOString(),
            updated_at:      new Date().toISOString(),
        };

        // upsert, not update: there is no row on first derivation, and an
        // `.update()` matching zero rows reports NO error in PostgREST — the
        // exact silent no-op that left media_assets empty for months (R38).
        const { data, error } = await supabaseAdmin
            .from('project_intelligence')
            .upsert(row, { onConflict: 'project_id' })
            .select()
            .maybeSingle();

        if (error) {
            console.error('[ProjectIntelligence] persist failed:', error.message);
            throw error;
        }

        console.log(
            `[ProjectIntelligence] project ${projectId}: map ${status} ` +
            `(${row.project_type || 'n/a'}, ${assetCount} asset(s), ` +
            `${(row.coverage_gaps || []).length} gap(s))`
        );
        return data || row;
    }

    _resolveOpenAI() {
        if (this._openai) return this._openai;
        if (!isAIConfigured()) return null;
        this._openai = getAIClient({ timeout: 60_000 });
        return this._openai;
    }
}

module.exports = { ProjectIntelligence, PROJECT_TYPES, ASSET_ROLES };
