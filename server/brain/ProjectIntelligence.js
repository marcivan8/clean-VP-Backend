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
const { projectMapStyleNote } = require('./editingStyles');

const { getAIClient, isAIConfigured, resolveModel } = require('../../services/AIProvider');
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

const PROJECT_MAP_PROMPT_CHAR_BUDGET = 28_000;
const PROJECT_MAP_ASSET_BATCH_SIZE = 24;
const PROJECT_MAP_SUMMARY_BATCH_SIZE = 20;
const PROJECT_MAP_BATCH_CONCURRENCY = 3;

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
        }
    }));
    return results;
}

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
    computeFingerprint(assets = [], clipCount = 0, editingStyle = null) {
        const parts = (assets || [])
            .filter(a => a && a.id)
            .map(a => `${a.id}:${a.analysis_status || 'none'}`)
            .sort();
        parts.push(`clips:${clipCount}`);
        // R91: a new editing style re-derives the map (gaps depend on it). No
        // style keeps the old hash, so existing maps are not re-paid for.
        if (editingStyle) parts.push(`style:${editingStyle}`);
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
    async ensureMap({ projectId, userId, assets = [], clipCount = 0, platform = null, editingStyle = null }) {
        if (!projectId || !userId) return null;

        const analysed = (assets || []).filter(a => a && a.analysis_status === ASSET_ANALYSIS_DONE);
        const fingerprint = this.computeFingerprint(assets, clipCount, editingStyle);

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
            const derived = await this.deriveMap({ assets: analysed, clipCount, platform, editingStyle });
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

    /** Derive the full map without sending an unbounded prompt to the model. */
    async deriveMap({ assets = [], clipCount = 0, platform = null, editingStyle = null }) {
        if (!assets.length) return null;

        const openai = this._resolveOpenAI();
        if (!openai) {
            throw new Error('OPENAI_API_KEY not configured — cannot derive a project map');
        }

        const prompt = this.buildDerivationPrompt({ assets, clipCount, platform, editingStyle });

        if (prompt.length <= PROJECT_MAP_PROMPT_CHAR_BUDGET) {
            return this.normalizeMap(await this._requestMapJSON(openai, prompt), assets);
        }

        const roleEntries = [];
        let summaries = [];
        const batches = [];
        let batch = [];
        for (const asset of assets) {
            const candidate = [...batch, asset];
            const candidatePrompt = this.buildDerivationPrompt({ assets: candidate, clipCount, platform, editingStyle });
            if (batch.length && (candidate.length > PROJECT_MAP_ASSET_BATCH_SIZE || candidatePrompt.length > PROJECT_MAP_PROMPT_CHAR_BUDGET)) {
                batches.push(batch);
                batch = [asset];
            } else {
                batch = candidate;
            }
        }
        if (batch.length) batches.push(batch);

        const batchResults = await mapWithConcurrency(batches, PROJECT_MAP_BATCH_CONCURRENCY, async (assetBatch, batchIndex) => {
            const batchPrompt = this.buildDerivationPrompt({ assets: assetBatch, clipCount, platform, editingStyle });
            try {
                const result = this.normalizeMap(await this._requestMapJSON(openai, batchPrompt), assetBatch);
                return {
                    roles: result.asset_roles,
                    summary: {
                        assetCount: assetBatch.length,
                        project_type: result.project_type,
                        through_line: result.through_line,
                        target_audience: result.target_audience,
                        tone: result.tone,
                        coverage_gaps: result.coverage_gaps,
                    },
                };
            } catch (error) {
                // Keep every asset addressable if one provider batch fails;
                // the top-level synthesis can still use the successful groups.
                return {
                    roles: assetBatch.filter(asset => asset?.id).map(asset => ({ assetId: asset.id, name: asset.name || null, role: 'supporting', serves: null })),
                    summary: {
                        assetCount: assetBatch.length,
                        project_type: 'unknown',
                        through_line: null,
                        target_audience: null,
                        tone: null,
                        coverage_gaps: [],
                        warning: `Asset group ${batchIndex + 1} could not be analyzed: ${error.message}`,
                    },
                };
            }
        });
        for (const result of batchResults) {
            roleEntries.push(...result.roles);
            summaries.push(result.summary);
        }

        // Reduce summaries hierarchically so even very large bins stay inside
        // the model's context budget without omitting any analyzed group.
        while (summaries.length > PROJECT_MAP_SUMMARY_BATCH_SIZE) {
            const next = [];
            const summaryBatches = [];
            for (let index = 0; index < summaries.length; index += PROJECT_MAP_SUMMARY_BATCH_SIZE) {
                summaryBatches.push(summaries.slice(index, index + PROJECT_MAP_SUMMARY_BATCH_SIZE));
            }
            const reduced = await mapWithConcurrency(summaryBatches, PROJECT_MAP_BATCH_CONCURRENCY, summaryBatch =>
                this._synthesizeMapSummaries(openai, summaryBatch, platform, editingStyle)
                    .catch(() => this._fallbackMapSummary(summaryBatch)));
            next.push(...reduced);
            summaries = next;
        }

        const reconciled = await this._synthesizeMapSummaries(openai, summaries, platform, editingStyle)
            .catch(() => this._fallbackMapSummary(summaries));
        const roleByAssetId = new Map(roleEntries.map(role => [role.assetId, role]));
        for (const asset of assets) {
            if (asset?.id && !roleByAssetId.has(asset.id)) {
                // A partial model response must not make an analyzed asset
                // disappear from the map. Keep it addressable with a neutral role.
                roleByAssetId.set(asset.id, {
                    assetId: asset.id,
                    name: asset.name || null,
                    role: 'supporting',
                    serves: null,
                });
            }
        }
        return {
            ...this.normalizeMap(reconciled, assets),
            // Only the per-asset pass may assign IDs; synthesis cannot drop or invent them.
            asset_roles: [...roleByAssetId.values()],
        };
    }

    async _requestMapJSON(openai, prompt, maxTokens = 1200) {
        const completion = await openai.chat.completions.create({
            model: resolveModel('gpt-4o', 'chat'),
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.15,
            max_tokens: maxTokens,
        });
        const raw = completion?.choices?.[0]?.message?.content;
        if (!raw) throw new Error('model returned no content');
        try { return JSON.parse(raw); }
        catch { throw new Error('model returned malformed JSON'); }
    }

    async _synthesizeMapSummaries(openai, summaries, platform, editingStyle) {
        const styleNote = projectMapStyleNote(editingStyle);
        const prompt = `You are reconciling summaries from every analyzed group of assets in a video project.\n\n` +
            `GROUP SUMMARIES (all groups are represented):\n${JSON.stringify(summaries)}\n\n` +
            `Target platform: ${platform || 'not specified'}${styleNote ? `\n${styleNote}` : ''}\n\n` +
            `Return one grounded project-level synthesis. Preserve uncertainty: use null when evidence is insufficient. ` +
            `Merge duplicate coverage gaps and do not invent new gaps. Asset role assignments are handled separately.\n` +
            `Return only JSON with project_type (${JSON.stringify(PROJECT_TYPES)}), through_line, target_audience, tone, ` +
            `coverage_gaps [{gap, severity: low|medium|high, suggestion}].`;
        return this._requestMapJSON(openai, prompt, 1200);
    }

    _fallbackMapSummary(summaries = []) {
        const gaps = summaries.flatMap(summary => Array.isArray(summary.coverage_gaps) ? summary.coverage_gaps : []);
        return {
            project_type: summaries.map(summary => summary.project_type).find(type => PROJECT_TYPES.includes(type)) || 'unknown',
            through_line: summaries.map(summary => summary.through_line).find(Boolean) || null,
            target_audience: summaries.map(summary => summary.target_audience).find(Boolean) || null,
            tone: summaries.map(summary => summary.tone).find(Boolean) || null,
            coverage_gaps: gaps,
        };
    }

    /**
     * Build the derivation prompt. PURE — no I/O, so the regression can assert
     * on what the model is actually asked (including that it is told not to
     * invent detail for assets it has no description of).
     */
    buildDerivationPrompt({ assets = [], clipCount = 0, platform = null, editingStyle = null }) {
        const styleNote = projectMapStyleNote(editingStyle);
        // Keep the AI's project-level map grounded in the same complete bin
        // that the edit planner receives. A first-N cap caused later rushes to
        // be invisible to role assignment and coverage analysis.
        const assetLines = assets.map((a, i) => {
            const bits = [
                a.scene_type && `scene: ${String(a.scene_type).slice(0, 60)}`,
                a.camera_angle && `framing: ${String(a.camera_angle).slice(0, 60)}`,
                typeof a.subject_count === 'number' && `${a.subject_count} on camera`,
                a.is_broll && 'B-ROLL',
                a.is_screen_recording && 'screen recording',
                a.has_main_speaker && 'has a main speaker',
                a.location_type && `location: ${String(a.location_type).slice(0, 60)}`,
                a.emotional_tone && `tone: ${String(a.emotional_tone).slice(0, 60)}`,
                a.has_spoken_word === false && 'no speech',
            ].filter(Boolean).join(', ');

            const transcript = String(a.transcript_text || '').slice(0, 120).trim();

            return [
                `Asset ${i + 1} [id: ${String(a.id || '').slice(0, 100)}] "${String(a.name || 'untitled').slice(0, 120)}"`,
                a.content_description ? `  Describes : ${String(a.content_description).slice(0, 240)}` : '',
                bits ? `  Signals   : ${bits}` : '',
                transcript ? `  Transcript: "${transcript}"` : '',
            ].filter(Boolean).join('\n');
        }).join('\n\n');

        return `You are a senior video editor building a working map of an edit project.

You are given every analysed clip in the media bin. Your job is to say what the
PROJECT is — not to describe the clips again one by one.

━━━ FOOTAGE (${assets.length} analysed asset${assets.length === 1 ? '' : 's'}; complete inventory) ━━━
${assetLines}

━━━ TIMELINE ━━━
Clips currently placed: ${clipCount}
Target platform: ${platform || 'not specified'}${styleNote ? `
${styleNote}` : ''}

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
