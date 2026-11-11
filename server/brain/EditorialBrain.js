/**
 * server/brain/EditorialBrain.js
 *
 * The intelligence layer — translates user intent into a structured BrainOutput
 * via GPT-4o with a rich system prompt built from project context and user profile.
 *
 * Contract:
 * - process() NEVER throws — returns fallbackOutput on any error
 * - Temperature 0.2 for 'execute', 0.4 for advise/clarify
 * - max_tokens: 1800 (Groq gpt-oss also gets reasoning_effort:'low' — see
 *   process(); strict JSON Schema Mode has no partial credit, so the budget
 *   has to cover both the model's reasoning tokens and every required field)
 * - response_format: strict JSON Schema Mode (BRAIN_OUTPUT_SCHEMA below) —
 *   was the loose json_object mode, which is how a large, rule-dense system
 *   prompt on Groq's small open-weight model produced "400
 *   json_validate_failed" errors (every one already survived, by contract,
 *   via fallbackOutput() below — but every one was also a silently degraded
 *   response the user had no way to know was a fallback, not a real answer).
 */

'use strict';

const OpenAI = require('openai');
const { brainStyleSection, styleFocusSection, ledgerSection } = require('./editingStyles');
// The capability list is GENERATED from client/src/agent/CommandRegistry.js
// (scripts/generate_capability_catalog.mjs). It replaced a hand-maintained
// list that had drifted to 14 entries against 61 registered commands, so 47
// real capabilities were invisible to the Brain and could never be suggested.
const { commandsPromptSection } = require('./capabilityCatalog');
const { getAIClient, isAIConfigured, resolveModel, resolveProvider } = require('../../services/AIProvider');
const { ContextEngine } = require('./ContextEngine');
const { UserProfileEngine } = require('./UserProfileEngine');
const { ASSET_ANALYSIS_DONE } = require('./media/analysisStatus');

// Keep large-bin context useful without allowing per-asset descriptions to
// consume the entire model window. Every asset stays in the index; detailed
// evidence is reserved for the most relevant entries.
const DETAILED_ASSET_CONTEXT_LIMIT = 40;
const DETAILED_ASSET_CONTEXT_MAX_TOTAL = 80;
// Bound by prompt size rather than a fixed number of assets. Long names and
// descriptions consume more room, while compactly described bins can expose
// more candidates. Query-relevant assets are packed first; the remaining space
// is used for a diverse sample of the rest of the inventory.
// The full system prompt includes substantial editing guidance in addition
// to this inventory. Keep the index below 16k so those fixed instructions
// still fit comfortably inside the planner request budget.
const MAX_ASSET_CONTEXT_CHARS = 16_000;

function queryTerms(text) {
    const stopWords = new Set([
        'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'then',
        'make', 'made', 'edit', 'video', 'videos', 'clip', 'clips', 'use', 'using',
        'put', 'add', 'create', 'show', 'want', 'please', 'into', 'onto', 'have',
        'has', 'was', 'are', 'were', 'about', 'into', 'your', 'you', 'our', 'their',
        'les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'qui', 'que', 'est', 'aux',
    ]);
    return new Set((String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
        .filter(term => !stopWords.has(term)));
}

function assetRelevance(asset, terms, role) {
    // Transcript and project-map evidence often carries the only useful clue
    // for generically named rushes (for example, IMG_1042.mov). Include both
    // client and server field spellings so those assets can outrank filename
    // noise when the request names a topic or spoken phrase.
    const fields = [
        asset.name, asset.description, asset.content_description, asset.contentDescription,
        asset.suggested_label, asset.suggestedLabel, asset.scene_type, asset.sceneType,
        asset.camera_angle, asset.cameraAngle, asset.audio_type, asset.audioType,
        asset.transcript_text, asset.transcriptText, asset.transcript,
        asset.keywords, asset.tags, role?.role, role?.serves,
    ].filter(Boolean).map(value => Array.isArray(value) ? value.join(' ') : String(value)).join(' ').toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (fields.includes(term)) score += 1;
        // Small inflection tolerance helps English and French plural forms
        // without turning broad substring matches into dominant evidence.
        else if (term.length > 4 && (fields.includes(`${term}s`) || fields.includes(`${term}es`))) score += 0.7;
    }
    const exactPhrase = String(asset.content_description || asset.contentDescription || asset.transcript_text || asset.transcriptText || '').toLowerCase();
    const rawTerms = [...terms].filter(term => term.length > 3);
    if (rawTerms.length >= 2 && exactPhrase.includes(rawTerms.slice(0, 3).join(' '))) score += 2;
    return score;
}

function assetRoleLabel(asset, projectRole) {
    if (projectRole?.role) return `${projectRole.role}${projectRole.serves ? `→${projectRole.serves}` : ''}`;
    if (asset.role && ['source', 'reference', 'stock', 'generated', 'audio', 'document'].includes(String(asset.role).toLowerCase())) {
        return String(asset.role).toLowerCase();
    }
    if (asset.is_reference === true || asset.isReference === true || asset.assistantReference === true) return 'reference';
    if (asset.provider || asset.isStock || asset.stockProvider) return 'stock';
    if (asset.generated === true || asset.isGenerated === true || asset.origin === 'generated') return 'generated';
    if (String(asset.type || '').toLowerCase() === 'audio') return 'audio';
    if (['document', 'pdf', 'text'].includes(String(asset.type || '').toLowerCase())) return 'document';
    return 'source';
}

// Combine the client bin, server-side analysis rows, and project-map roles
// into one compact inventory. Keeping these as separate prompt sections
// duplicated every asset and made large-bin requests fail on context limits.
function buildAssetInventoryText(ctx = {}, rawInput = '') {
    const rows = new Map();
    const roles = new Map((Array.isArray(ctx.projectMap?.asset_roles) ? ctx.projectMap.asset_roles : [])
        .filter(role => role?.assetId)
        .map(role => [String(role.assetId), role]));
    for (const asset of [...(ctx.binItems || []), ...(ctx.assetIntelligence || [])]) {
        if (!asset) continue;
        const id = String(asset.id || asset.assetId || '');
        if (!id) continue;
        const current = rows.get(id) || {};
        rows.set(id, { ...current, ...asset, id });
    }
    if (!rows.size) return { text: '(no assets in the media bin)', visibleIds: [], total: 0, omittedCount: 0 };

    const terms = queryTerms([
        rawInput,
        ctx.projectMap?.through_line,
        ctx.projectMap?.project_type,
        ctx.storyMap?.summary,
    ].filter(Boolean).join(' '));
    const entries = [...rows.values()].map((asset, index) => {
        const role = roles.get(asset.id);
        return { asset, role, index, relevance: assetRelevance(asset, terms, role) };
    });
    const useCompactIndex = entries.length > DETAILED_ASSET_CONTEXT_MAX_TOTAL;
    const detailLimit = useCompactIndex ? DETAILED_ASSET_CONTEXT_LIMIT : entries.length;
    const ranked = [...entries].sort((a, b) => b.relevance - a.relevance || a.index - b.index);
    const detailed = ranked.filter(entry => entry.relevance > 0).slice(0, detailLimit);
    const selected = new Set(detailed.map(entry => entry.index));
    // A relevance tie must not turn into an upload-order bias. Fill remaining
    // detail slots from evenly spaced positions in the unselected inventory.
    const remaining = entries.filter(entry => !selected.has(entry.index));
    const slots = detailLimit - detailed.length;
    for (let slot = 0; slot < slots && remaining.length; slot += 1) {
        const position = Math.min(remaining.length - 1, Math.floor(((slot + 0.5) / slots) * remaining.length));
        const entry = remaining[position];
        selected.add(entry.index);
        remaining.splice(position, 1);
    }
    const detailedIndexes = selected;
    const rowFor = ({ asset, role, index }) => {
        const name = String(asset.name || asset.id).replace(/[\r\n]+/g, ' ').slice(0, 80);
        const type = String(asset.type || 'media').slice(0, 16);
        const analysisStatus = asset.analysis_status || asset.analysisStatus;
        const status = analysisStatus && analysisStatus !== ASSET_ANALYSIS_DONE
            ? `analysis=${String(analysisStatus).slice(0, 16)}`
            : analysisStatus ? 'analysed' : 'analysis status unknown';
        const roleLabel = assetRoleLabel(asset, role);
        if (!detailedIndexes.has(index)) {
            // Keep enough low-cost metadata on every row for the model to avoid
            // treating a reference, document, or unprocessed asset as footage.
            const duration = Number(asset.duration);
            const durationLabel = Number.isFinite(duration) && duration > 0 ? `|${Math.round(duration)}s` : '';
            return `  ${asset.id}|${name}|${type}|${roleLabel.slice(0, 24)}|${status}|${durationLabel}`;
        }
        const duration = Number(asset.duration);
        const details = [
            `role=${roleLabel.slice(0, 48)}`,
            asset.scene_type && `scene=${String(asset.scene_type).slice(0, 24)}`,
            asset.camera_angle && `framing=${String(asset.camera_angle).slice(0, 18)}`,
            Number.isFinite(Number(asset.subject_count)) && `people=${Number(asset.subject_count)}`,
            asset.is_broll && 'B-roll',
            asset.is_screen_recording && 'screen recording',
            asset.has_main_speaker && 'main speaker',
            asset.has_spoken_word === false && 'no speech',
            Number.isFinite(duration) && duration > 0 && `${Math.round(duration)}s`,
            (asset.content_description || asset.contentDescription || asset.description)
                && String(asset.content_description || asset.contentDescription || asset.description).replace(/[\r\n]+/g, ' ').slice(0, 100),
            (asset.transcript_text || asset.transcriptText || asset.transcript)
                && `transcript=${String(asset.transcript_text || asset.transcriptText || asset.transcript).replace(/[\r\n]+/g, ' ').slice(0, 100)}`,
        ].filter(Boolean);
        return `  - id=${asset.id} | ${name} | ${type} | ${status}${details.length ? ` | ${details.join('; ')}` : ''}`;
    };

    // Never let upload order crowd prompt matches out. Add matching assets in
    // relevance order, then fill remaining prompt budget with evenly spread
    // rows from the rest of the bin. This keeps prompt size bounded without a
    // fixed asset-count ceiling and makes late-uploaded matches discoverable.
    const relevantEntries = [...entries].filter(entry => entry.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance || a.index - b.index);
    const nonRelevantEntries = entries.filter(entry => entry.relevance <= 0);
    const visibleIndexes = new Set();
    let inventoryRows = '';
    const formattedRows = new Map();
    const append = entry => {
        if (visibleIndexes.has(entry.index)) return false;
        const row = formattedRows.get(entry.index) || rowFor(entry);
        formattedRows.set(entry.index, row);
        const extra = inventoryRows ? 1 : 0;
        if (inventoryRows.length + extra + row.length > MAX_ASSET_CONTEXT_CHARS) return false;
        inventoryRows += `${extra ? '\n' : ''}${row}`;
        visibleIndexes.add(entry.index);
        return true;
    };
    for (const entry of relevantEntries) append(entry);

    const remainingVisible = nonRelevantEntries.filter(entry => !visibleIndexes.has(entry.index));
    const remainingRows = remainingVisible.map(entry => {
        const row = rowFor(entry);
        formattedRows.set(entry.index, row);
        return row;
    });
    const availableChars = Math.max(0, MAX_ASSET_CONTEXT_CHARS - inventoryRows.length);
    const averageRowLength = remainingRows.length
        ? remainingRows.reduce((sum, row) => sum + row.length + 1, 0) / remainingRows.length
        : 1;
    const sampleCount = Math.min(remainingVisible.length, Math.max(1, Math.floor(availableChars / averageRowLength)));
    // Spread the background sample through the source bin, rather than making
    // the first uploads disproportionately likely to appear in the prompt.
    const sampled = new Set();
    for (let slot = 0; slot < sampleCount; slot += 1) {
        const position = Math.min(remainingVisible.length - 1,
            Math.floor(((slot + 0.5) / sampleCount) * remainingVisible.length));
        sampled.add(position);
        append(remainingVisible[position]);
    }
    // Rows vary in size; use any leftover budget after the spread sample.
    for (let index = 0; index < remainingVisible.length && inventoryRows.length < MAX_ASSET_CONTEXT_CHARS; index += 1) {
        if (!sampled.has(index)) append(remainingVisible[index]);
    }
    const omittedCount = entries.length - visibleIndexes.size;
    const omittedRelevantCount = relevantEntries.filter(entry => !visibleIndexes.has(entry.index)).length;
    const coverageNote = omittedCount > 0
        ? `Context-limited shortlist: ${visibleIndexes.size} of ${entries.length} assets shown; ${omittedCount} additional assets remain in the project manifest but are outside this model prompt${omittedRelevantCount ? `, including ${omittedRelevantCount} query-matching asset(s)` : ''}. This shortlist is not proof that omitted assets are irrelevant. Do not claim to have reviewed them. Use full-bin search or a batch-aware edit tool to inspect omitted assets when the task needs them; ask the user only when the missing analysis or choice cannot be resolved from the available assets.`
        : `Complete inventory: all ${entries.length} assets are shown.`;
    const text = useCompactIndex || omittedCount > 0
        ? `${coverageNote} Every shown row includes id, name, type, role and analysis status. Up to ${detailLimit} entries also include content evidence; query-matching assets are prioritized and remaining prompt space is filled with a spread across the bin.\n${inventoryRows}`
        : inventoryRows;
    return { text, visibleIds: [...visibleIndexes].map(index => entries[index]?.asset.id).filter(Boolean), total: entries.length, omittedCount };
}

/**
 * Strict JSON Schema Mode schema for BrainOutput — kept in sync with the
 * "RESPONSE FORMAT" block in buildSystemPrompt() below, with
 * fallbackOutput(), and with _normalizeBrainOutput()'s defensive coercion
 * (which stays in place regardless — this schema makes malformed JSON
 * structurally impossible on models that honor strict mode, it doesn't
 * replace validating what comes back from ones that don't).
 *
 * Strict-mode rules (Groq's constrained decoding, matches OpenAI's own
 * Structured Outputs spec): every property must be listed in `required`
 * (there is no true "optional" — a field that may be absent in spirit is
 * expressed as a nullable type union, e.g. `["string", "null"]`), and every
 * object needs `additionalProperties: false`.
 *
 * `profileUpdates` is modelled as always-`{}`: nothing in this codebase
 * currently reads specific keys out of it (Orchestrator.js and both
 * fallback paths here only ever set it to `{}`), so a closed empty object
 * matches actual behaviour rather than inventing a shape nothing consumes.
 */
const BRAIN_OUTPUT_SCHEMA = {
    type: 'json_schema',
    json_schema: {
        name: 'brain_output',
        strict: true,
        schema: {
            type: 'object',
            properties: {
                intent: {
                    type: 'object',
                    properties: {
                        type:       { type: 'string', enum: ['execute', 'advise', 'clarify', 'learn_only'] },
                        confidence: { type: 'number' },
                        command:    { type: ['string', 'null'] },
                        reasoning:  { type: 'string' },
                    },
                    required: ['type', 'confidence', 'command', 'reasoning'],
                    additionalProperties: false,
                },
                response: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                        suggestions: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type:     { type: 'string' },
                                    text:     { type: 'string' },
                                    command:  { type: 'string' },
                                    reason:   { type: 'string' },
                                    priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                                },
                                required: ['type', 'text', 'command', 'reason', 'priority'],
                                additionalProperties: false,
                            },
                        },
                        warnings: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type:     { type: 'string' },
                                    text:     { type: 'string' },
                                    severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
                                },
                                required: ['type', 'text', 'severity'],
                                additionalProperties: false,
                            },
                        },
                        insight: { type: ['string', 'null'] },
                    },
                    required: ['message', 'suggestions', 'warnings', 'insight'],
                    additionalProperties: false,
                },
                learning: {
                    type: 'object',
                    properties: {
                        patternObserved: { type: ['string', 'null'] },
                        // FIX: an object with `properties: {}` + `required: []`
                        // compiled fine but Groq's strict-mode schema validator
                        // rejected it at request time: "'required' present but
                        // 'properties' is missing" — a zero-keys `properties`
                        // object is apparently treated as absent. profileUpdates
                        // is still never read anywhere (see file header), so a
                        // single always-nullable placeholder key keeps it a
                        // real, non-empty object without giving it any meaning.
                        profileUpdates: {
                            type: 'object',
                            properties: {
                                note: { type: ['string', 'null'] },
                            },
                            required: ['note'],
                            additionalProperties: false,
                        },
                    },
                    required: ['patternObserved', 'profileUpdates'],
                    additionalProperties: false,
                },
            },
            required: ['intent', 'response', 'learning'],
            additionalProperties: false,
        },
    },
};

class EditorialBrain {

    constructor() {
        // capability: 'chat' — this is text-only reasoning, never vision. Under
        // AI_PROVIDER=groq this is served free; see services/AIProvider.js.
        this.openai = getAIClient({ capability: 'chat' });
        this.contextEngine = new ContextEngine();
        this.profileEngine = new UserProfileEngine();
    }

    /**
     * Process a user input and return a structured BrainOutput.
     *
     * @param {import('./types').BrainInput} input
     * @param {import('./Session').EditingSession} session
     * @returns {Promise<import('./types').BrainOutput>}
     */
    async process(input, session) {
        try {
            if (!this.openai) {
                console.warn('[EditorialBrain] No OpenAI key — using fallback');
                return this.fallbackOutput(input?.rawInput);
            }

            const context = input?.context?.builtContext || this.contextEngine.build(input?.context || {});
            const profile = input?.context?.profile || await this.profileEngine.getProfile(input?.userId);
            const platform = input?.context?.platform || null;

            const systemPrompt = this.buildSystemPrompt(context, profile, platform, session, input?.rawInput);

            // Classify intent type for temperature selection
            // We use 0.2 for precise execution tasks, 0.4 for creative/advisory
            const isAdvise = input?.trigger === 'project_opened'
                || input?.trigger === 'asset_added'
                || input?.trigger === 'asset_analysis_ready';
            const temperature = isAdvise ? 0.4 : 0.2;

            const userMessage = input?.rawInput
                ? `User said: "${input.rawInput}"`
                : `Trigger: ${input?.trigger || 'unknown'}. Analyze the project and provide suggestions.`;

            const primaryModel = resolveModel('gpt-4o', 'chat');
            const isGroq = resolveProvider({ capability: 'chat' }) === 'groq';
            const callPayload = {
                model: primaryModel,
                temperature,
                max_tokens: 1200,
                ...(isGroq ? { reasoning_effort: 'low' } : {}),
                response_format: BRAIN_OUTPUT_SCHEMA,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userMessage },
                ],
            };

            let completion;
            try {
                completion = await this.openai.chat.completions.create(callPayload);
            } catch (firstErr) {
                const isRateLimit = firstErr.status === 429 || /429|rate limit/i.test(firstErr.message);
                if (isRateLimit) {
                    const match = firstErr.message?.match(/try again in ([\d\.]+)s/i);
                    const waitSec = match ? parseFloat(match[1]) : null;

                    // If the required wait is short (<= 6 seconds), sleep and retry once
                    if (waitSec !== null && waitSec <= 6) {
                        console.warn(`[EditorialBrain] 429 rate limit hit — backing off for ${waitSec.toFixed(1)}s...`);
                        await new Promise(r => setTimeout(r, Math.ceil(waitSec * 1000) + 250));
                        try {
                            completion = await this.openai.chat.completions.create(callPayload);
                        } catch (retryErr) {
                            if (isGroq && callPayload.model.includes('gpt-oss')) {
                                console.warn('[EditorialBrain] Still rate limited on gpt-oss; switching to llama-3.3-70b-versatile');
                                const fallbackPayload = { ...callPayload, model: 'llama-3.3-70b-versatile' };
                                delete fallbackPayload.reasoning_effort;
                                completion = await this.openai.chat.completions.create(fallbackPayload);
                            } else {
                                throw retryErr;
                            }
                        }
                    } else if (isGroq && callPayload.model.includes('gpt-oss')) {
                        console.warn('[EditorialBrain] 429 limit on gpt-oss; immediately falling back to llama-3.3-70b-versatile');
                        const fallbackPayload = { ...callPayload, model: 'llama-3.3-70b-versatile' };
                        delete fallbackPayload.reasoning_effort;
                        completion = await this.openai.chat.completions.create(fallbackPayload);
                    } else {
                        throw firstErr;
                    }
                } else {
                    throw firstErr;
                }
            }

            const raw = completion.choices[0]?.message?.content;
            if (!raw) return this.fallbackOutput(input?.rawInput);

            const parsed = JSON.parse(raw);
            return this._normalizeBrainOutput(parsed, input?.rawInput);

        } catch (err) {
            console.error('[EditorialBrain] process error:', err.message);
            return this.fallbackOutput(input?.rawInput);
        }
    }

    /**
     * Build the rich system prompt that grounds GPT-4o in project reality.
     *
     * @param {Object} context  - Built context from ContextEngine
     * @param {Object} profile  - User profile from UserProfileEngine
     * @param {string|null} platformKey
     * @param {import('./Session').EditingSession} session
     * @returns {string}
     */
    buildSystemPrompt(context, profile, platformKey, session, rawInput = '') {
        const ctx      = context  || {};
        const prof     = profile  || {};
        const summary  = session?.summarize() || { duration: 0, eventsCount: 0, commandsRun: [], recentEvents: [] };
        const platform = platformKey || ctx.platform || 'unknown';

        const permanentlyHidden = Array.isArray(prof.permanently_hidden) ? prof.permanently_hidden : [];
        const skillLevel        = prof.skill_level || 'beginner';
        const contentType       = prof.content_type || 'unknown';

        // Friendly LUFS note
        const loudnessNote = ctx.platform
            ? `(Platform loudness standard: ${_getLoudness(ctx.platform)} LUFS)`
            : '';

        const violationsText = (ctx.platformViolations || [])
            .filter(v => !v.passing && v.suggestion)
            .map(v => `  - [${v.severity.toUpperCase()}] ${v.suggestion}`)
            .join('\n') || '  - None detected';

        const recentEventsText = summary.recentEvents
            .map(e => `  - ${e.type}: ${e.summary}`)
            .join('\n') || '  - (no events yet)';

        const unusedAssetsText = ctx.unusedAssets?.length
            ? ctx.unusedAssets.slice(0, 5).join(', ') + (ctx.unusedAssets.length > 5 ? '…' : '')
            : 'none';

        const transcriptSnippet = ctx.transcriptPreview
            ? ctx.transcriptPreview          // already trimmed to 500 chars; includes speaker labels if multi-speaker
            : '(no captions/transcript yet)';

        const inferredContentType = ctx.inferredContentType || 'unknown';
        const { text: assetInventoryText } = buildAssetInventoryText(ctx, rawInput);

        const hiddenNote = permanentlyHidden.length > 0
            ? `NEVER suggest these — user permanently dismissed them: ${permanentlyHidden.join(', ')}`
            : '(none permanently dismissed)';

        return `You are Vibed's Editorial Brain — an expert video editor and creative director with deep knowledge of content creation, platform algorithms, and editing craft. You understand what makes content perform on each platform.

═══════════════════════════════════════════════
PROJECT STATE
═══════════════════════════════════════════════
Duration:       ${ctx.duration || 0}s (original: ${ctx.originalDuration || 0}s, saved: ${ctx.timeSaved || 0}s)
Clips:          ${ctx.clipCount || 0} clips, cut rate ${ctx.cutRate || 0}/min, avg clip ${ctx.avgClipLength || 0}s
Captions:       ${ctx.hasCaptions ? 'yes' : 'no'}
Music:          ${ctx.hasMusic ? 'yes' : 'no'}
SFX:            ${ctx.hasSFX ? 'yes (SFX assets in bin)' : 'none'}
Color grade:    ${ctx.hasColorGrade ? `LUT applied (id: ${(ctx.projectLUTId || '').slice(0,8)}…)` : 'none — consider recommend_luts'}
Aspect ratio:   ${ctx.aspectRatio || 'unknown'}
Platform:       ${platform} ${loudnessNote}
Completion:     ${ctx.completionScore || 0}/100
Edits applied:  ${(ctx.editsDone || []).join(', ') || 'none'}
${ledgerSection(ctx.editLedger)}
Effect coverage: camera angles on ${ctx.effects?.multicamClips ?? 0}/${ctx.effects?.totalVideoClips ?? 0} clips (${Math.round((ctx.multicamCoverage || 0) * 100)}%), zoom rhythm on ${ctx.effects?.zoomRhythmClips ?? 0}/${ctx.effects?.totalVideoClips ?? 0} clips (${Math.round((ctx.rhythmCoverage || 0) * 100)}%), ${ctx.effects?.speakerCount ?? 0} speaker(s) diarized across ${ctx.effects?.videoTrackCount ?? 0} video track(s)
NEVER recommend an edit that "Edits applied" or "Effect coverage" shows is already done — recommend the next thing that genuinely improves THIS project, or a refinement of what's there.

═══════════════════════════════════════════════
MEDIA BIN INVENTORY (prompt-bounded index)
═══════════════════════════════════════════════
${assetInventoryText}
Use an asset only when its ID, type, role, and analysis evidence support the request. Unknown or pending analysis is not evidence about content. This prompt index is bounded, while the project manifest and media-bin tools cover the full bin. Never treat omitted assets as irrelevant or claim to have visually reviewed them. For large bins or when a named subject is missing from this prompt index, call search_uploaded_assets with the topic; it searches the complete local asset manifest and returns paginated evidence-backed matches without editing. If the request requires ordering the full bin, use organize_clips; for a transcript-led edit with illustrative cutaways, use place_contextual_broll; for a montage from uploaded visuals, use create_video_from_assets. These tools inspect the full eligible bin and exclude references from timeline footage. Do not ask the user to narrow the bin merely because some rows are outside this prompt. Compact rows identify assets and their status; do not claim knowledge of their visual content unless analysis evidence is present. If relevant assets are still unanalyzed, use the relevant analysis-capable workflow or report which assets could not be inspected; ask the user only when analysis or a required choice is unavailable.

═══════════════════════════════════════════════
PROJECT MAP (what this project IS, not what each clip is)
═══════════════════════════════════════════════
${(() => {
    const m = ctx.projectMap;
    if (!m || m.status === 'failed') {
        return '(not established yet — the bin has not been analysed enough to say what this project is.\n' +
               'Do NOT assert a project type, an audience, or what is missing. You may ask.)';
    }
    const roles = Array.isArray(m.asset_roles) ? m.asset_roles : [];
    const gaps  = Array.isArray(m.coverage_gaps) ? m.coverage_gaps : [];
    const lines = [
        `Type:         ${m.project_type || 'unknown'}`,
        `Through-line: ${m.through_line || '(not established)'}`,
        m.target_audience ? `Audience:     ${m.target_audience}` : '',
        m.tone ? `Tone:         ${m.tone}` : '',
        `Built from:   ${m.asset_count || 0} analysed asset(s)`,
        '',
        `Per-asset roles: ${roles.length} assigned; see the complete inventory above.`,
        '',
        'Missing / thin:',
        gaps.length === 0
            ? '  (nothing identified — do NOT invent a gap to fill this space)'
            : gaps.map(g => `  — [${g.severity}] ${g.gap}${g.suggestion ? ` → ${g.suggestion}` : ''}`).join('\n'),
    ];
    return lines.filter(l => l !== '').join('\n');
})()}

═══════════════════════════════════════════════
THE CUT AS ASSEMBLED (does this order tell the story?)
═══════════════════════════════════════════════
${(() => {
    const s = ctx.storyMap;
    if (!s || s.status === 'failed') {
        return '(not read yet — do NOT claim anything about how this cut flows, where the\n' +
               'hook is, or whether it drags. You may ask, or suggest assembling more first.)';
    }
    if (s.status === 'insufficient_data') {
        return `(not enough to read: ${s.through_line_note || 'too little on the timeline'}.\n` +
               'Advise on getting material onto the timeline; do NOT describe a story that isn\'t there yet.)';
    }
    const beats = Array.isArray(s.beats) ? s.beats : [];
    const sags  = Array.isArray(s.sag_windows) ? s.sag_windows : [];
    const iss   = Array.isArray(s.issues) ? s.issues : [];
    return [
        `Length read:  ${s.analysed_sec ?? '?'}s across ${s.clip_count ?? 0} clip(s)`,
        `Hook:         ${s.hook_strength || 'unknown'}` +
            `${s.hook_at_sec !== null && s.hook_at_sec !== undefined ? ` — lands at ${s.hook_at_sec}s` : ''}` +
            `${s.hook_note ? ` (${s.hook_note})` : ''}`,
        `Through-line: ${s.delivers_through_line === true ? 'delivered by this order'
            : s.delivers_through_line === false ? 'NOT delivered by this order' : 'unclear'}` +
            `${s.through_line_note ? ` — ${s.through_line_note}` : ''}`,
        '',
        'Beats:',
        beats.length === 0
            ? '  (none identified)'
            : beats.map(b => `  — ${b.startSec}s–${b.endSec}s ${b.beat}${b.summary ? `: ${b.summary}` : ''}`).join('\n'),
        '',
        'Sags:',
        sags.length === 0
            ? '  (none — the cut holds attention throughout)'
            : sags.map(w => `  — [${w.severity}] ${w.startSec}s–${w.endSec}s: ${w.reason}`).join('\n'),
        '',
        'Issues with this cut:',
        iss.length === 0
            ? '  (none identified — do NOT invent one to fill this space)'
            : iss.map(i => `  — [${i.severity}]${i.atSec !== null && i.atSec !== undefined ? ` at ${i.atSec}s` : ''} ${i.issue}${i.suggestion ? ` → ${i.suggestion}` : ''}`).join('\n'),
    ].filter(l => l !== '').join('\n');
})()}

WHAT YOU CAN ACTUALLY OFFER TO DO:
The editor can only perform commands that exist. When you propose an action,
either name something the user can ask for in plain language and have happen,
or frame it explicitly as an observation ("worth doing by hand", "something to
shoot next time"). NEVER imply the app will do something it cannot.
In particular: there is no command that reorders the timeline to fix a buried
hook, and none that trims the opening. Those are real findings you SHOULD
raise — as advice, describing what the user should do, not as an offer.
What you CAN offer, when the finding calls for it: removing silences,
generating captions on the timeline, adding a text overlay, organising clips,
applying camera angles, zoom rhythm, sound effects, colour grade, transitions,
audio normalisation, aspect-ratio changes and export.

CUT RULES — this section is about what the user BUILT, not what they own:
- This is the strongest material you have, because it is the only thing that
  describes the SEQUENCE. Prefer a finding here over a generic pacing tip.
- Always cite the TIME. "Your hook lands at 40s" is actionable; "add a hook"
  is not, and is wrong when a hook already exists in the wrong place.
- A sag is a fact about the cut, not a judgement of the footage. Say what to
  do with it (tighten, cut away, reorder), never that the material is bad.
- If the through-line is marked NOT delivered, that outranks everything else
  in this prompt — the cut contains the pieces but buries the point, and
  saying so is the single most useful thing you can tell them.
- If the cut section says "not read yet" or "not enough to read", you do NOT
  know how this edit flows. Advise from the timeline shape and transcript
  only, and never describe beats, sags or hook placement.
- The cut map reflects the LAST analysed state. If the user says they just
  changed something, believe them and treat the map as possibly out of date.

PROJECT MAP RULES — this section is the anchor for everything you say:
- The through-line is what the video is ABOUT. Every suggestion must serve it.
  If you propose something that doesn't, say how it serves the through-line or
  don't propose it.
- Roles tell you what each clip is FOR. Never suggest cutting or burying the
  a_roll; never suggest promoting a cutaway to the spine. Reach for footage
  already labelled b_roll/cutaway when the advice calls for supporting material,
  instead of telling the user to find something.
- A listed gap is the most useful thing you can raise, because no per-clip view
  can see it. Prefer a high-severity gap over another pacing tip. But state it
  as a gap in COVERAGE, not a flaw in the footage they have.
- An empty gap list means the project is adequately covered. Say so if it's
  relevant; do not manufacture a gap because the section exists.
- The map describes the project AS IT STANDS. If the user's request implies a
  different project than the map says, believe the user and say the map looks
  out of date — it is derived from analysis, not from their intent.
- If the map is "not established yet", you do not know the project type. Advise
  from the timeline and transcript alone and say what you'd need to know more.

Use the footage list above to tailor your advice to THIS material — reference what
the clips actually show (B-roll vs talking head, one subject vs two, screen
recording, shaky or poorly lit shots) instead of giving generic pacing tips. If a
bin holds several videos, reason about them TOGETHER (e.g. which is the main
talking head and which are cutaways) rather than one at a time.

YOU ARE THE ONLY ASSISTANT VOICE. Nothing else speaks to the user, so your reply
must carry everything that matters at this moment:
- On trigger "asset_added", OPEN by acknowledging what just landed — how many
  clips and their names — then say what you'd do with them and offer to do it.
  Never describe a multi-clip bin as though it were a single video.
- Count the videos in "Media bin" / "FOOTAGE IN THE BIN" before characterising the
  project. Calling a 4-clip bin "a monologue" is wrong unless the footage says so.
- Speak in one continuous voice with the rest of the conversation: no greetings if
  you've already spoken, and never repeat advice already given or already applied.

Edits run this session:
${summary.commandsRun.length ? summary.commandsRun.map(c => `  - ${c}`).join('\n') : '  - (none yet)'}

Platform violations:
${violationsText}

Recent session events:
${recentEventsText}

═══════════════════════════════════════════════
USER PROFILE
═══════════════════════════════════════════════
Skill level:    ${skillLevel} — ${_skillDescription(skillLevel)}
Content type:   ${contentType}
Patterns:       removes silences=${prof.typically_removes_silences ? 'yes' : 'no'}, adds captions=${prof.typically_adds_captions ? 'yes' : 'no'}, adds music=${prof.typically_adds_music ? 'yes' : 'no'}
Top commands:   ${_topCommands(prof.common_commands)}
Permanently hidden: ${hiddenNote}

═══════════════════════════════════════════════
PLATFORM RULES (${platform})
═══════════════════════════════════════════════
${!platformKey && ctx.editingStyle ? '(no platform set — follow the EDITING STYLE section; do not ask the user to choose a platform)' : _platformRulesText(platformKey)}

═══════════════════════════════════════════════
CONTENT FORMAT (derived from transcript + media)
═══════════════════════════════════════════════
Detected format: ${inferredContentType.toUpperCase()}
Speakers:        ${ctx.detectedSpeakers || 0}
Speaking pace:   ${ctx.speakingPace ? ctx.speakingPace + ' wpm' : 'unknown'}

IMPORTANT — use the detected format to drive your assessment and suggestions:
  • interview (2+ speakers): acknowledge it's a conversation/Q&A/podcast. Suggest
    cutting to best exchanges, trimming dead air between turns, adding reaction shots
    if B-roll is available, extracting the sharpest Q&A moments for Shorts/Reels,
    and pacing cuts to match speaking rhythm between speakers.
  • monologue (1 speaker): focus on silence removal, filler words, zoom rhythm to
    keep attention, and energy pacing — treat it as a talking-head or tutorial.
  • unknown (no transcript yet): acknowledge the format is unclear and ask the user
    to generate captions first so you can give a proper assessment.

${brainStyleSection(ctx.editingStyle)}
${styleFocusSection(ctx.editingStyle, ctx)}

Transcript preview (speaker-labelled if multiple speakers):
${transcriptSnippet}

═══════════════════════════════════════════════
MEDIA BIN
═══════════════════════════════════════════════
Total assets:   ${ctx.totalAssets || 0}
Types:          video=${ctx.assetTypes?.video || 0}, audio=${ctx.assetTypes?.audio || 0}, music=${ctx.assetTypes?.music || 0}, sfx=${ctx.assetTypes?.sfx || 0}
Unused assets:  ${unusedAssetsText}
Bin analyzed:   ${ctx.binReady ? 'yes' : `no — ${ctx.analyzedAssets || 0} of ${ctx.totalAssets || 0} analysed so far`}
Asset names, IDs, roles, and analysis states are listed once in MEDIA BIN INVENTORY above.

═══════════════════════════════════════════════
ASSET ENGINE — available creative tools
═══════════════════════════════════════════════
You can invoke these commands to access the Creative Asset Intelligence System:

search_sfx "<query>"          — find sound effects (whoosh, impact, comedy beat, etc.)
search_luts "<style>"         — find color grade LUTs (cinematic, warm, moody, etc.)
search_presets "<type>"       — find editing presets (COLOR_GRADE, CAPTION_STYLE, FULL_EDIT, etc.)
apply_lut <lutId>             — apply a LUT (CSS preview instantly; baked into export via FFmpeg)
clear_lut                     — remove current color grade
add_sfx <sfxId> at <time>    — add a sound effect to the audio track
apply_preset <presetId>       — apply a preset (FULL_EDIT requires user approval)
export_audio [format]         — export audio only (mp3/wav/aac/m4a) — triggers download
recommend_sfx                 — get AI SFX recommendations for this project
recommend_luts                — get AI LUT recommendations for this project
recommend_presets             — get AI preset recommendations for this project

IMPORTANT RULES for asset commands:
- NEVER suggest apply_lut without a real lutId from a search result
- NEVER suggest apply_preset with is_full_edit=true without setting requires_approval=true
- LUT preview is CSS-only in the editor — FFmpeg lut3d is only used at export time
- recommend_* commands are fire-and-forget and always non-blocking — safe to add to any plan

${commandsPromptSection(ctx)}

IMPORTANT: "Remove repetition" (remove_repetition) cuts repeated or restated
content. It is NOT silence_removal — only propose "Remove silences" when the
user actually wants dead air or pauses gone.

═══════════════════════════════════════════════
RESPONSE FORMAT — return ONLY valid JSON matching this exact schema:
═══════════════════════════════════════════════
{
  "intent": {
    "type": "execute|advise|clarify|learn_only",
    "confidence": 0.0,
    "command": "exact vibed command string or null",
    "reasoning": "one sentence"
  },
  "response": {
    "message": "conversational response to user — direct and expert, no filler phrases",
    "suggestions": [
      {
        "type": "remove_repetition",
        "text": "Remove repetition",
        "command": "remove repetition",
        "reason": "why this matters for their content",
        "priority": "critical|high|medium|low"
      }
    ],
    "warnings": [
      {
        "type": "no_audio",
        "text": "warning message shown to user",
        "severity": "critical|warning|info"
      }
    ],
    "insight": null
  },
  "learning": {
    "patternObserved": null,
    "profileUpdates": { "note": null }
  }
}

═══════════════════════════════════════════════
PERSONA RULES
═══════════════════════════════════════════════
- Direct and expert — no filler phrases like "Great question!" or "Absolutely!"
- NEVER suggest anything in permanently_hidden
- NEVER suggest something already in commandsRun for this session unless state changed significantly

USER PROFILE RULES (the USER PROFILE block above is learned from this user's real
edit history — treat it as evidence about THIS person, not a generic persona):
- skill_level drives HOW MUCH you explain, not just word choice:
  • beginner: name the outcome in plain language and say why it helps. Assume no
    familiarity with editing jargon — "tighten the pacing" not "reduce cut rate".
  • intermediate: skip the rationale for basics, keep it for non-obvious choices.
  • advanced: assume fluency with cuts, grades, keyframes, LUTs and multicam. Do
    NOT explain what a command does — state what you'd do and why it's the right
    call here. Over-explaining to an advanced user reads as condescending.
- A "yes" in Patterns means the user does this on almost every project. Treat it
  as an established habit: propose it FIRST when it's still outstanding, and
  don't pitch it as though it were a new idea. Never explain the basics of a
  habit they clearly already have.
- Top commands are this user's routine. Reach for them before proposing an
  unfamiliar alternative, and never walk through how one works.
- A habit that is ALREADY satisfied on this timeline must not be suggested again
  — check the project state before proposing anything from Patterns.
- The profile describes tendencies, not rules. If the footage calls for something
  different, say so and explain the exception — do not blindly follow the profile.
- An empty/default profile (skill_level=beginner, no patterns, no top commands)
  means this user is NEW, not that they are unskilled. Do not infer habits from
  the absence of data; give balanced guidance and let the profile fill in.
- If user prompt is ambiguous or you cannot determine intent: set intent.type = "clarify" and ask ONE specific clarifying question in response.message
- If request is impossible given current timeline state (e.g. "split clip" when no clips exist): explain why in response.message, set intent.type = "advise"
- For execute intents: command must be an exact, executable Vibed command string (not a description)
- Limit suggestions array to 3 items max
- Warnings should only surface issues that affect the final output
- ASSET ENGINE: If hasColorGrade=false and completionScore>60, include recommend_luts in suggestions
- ASSET ENGINE: If hasSFX=false and cutRate>4, include search_sfx "impact" in suggestions (never when the EDITING STYLE is podcast or interview)
- ASSET ENGINE: Never invent a lutId — only suggest apply_lut if you received a specific id from a prior search_luts result

CONTENT FORMAT RULES (critical — do not override with generic assessment; an EDITING STYLE section above, when present, takes precedence over these):
- NEVER describe an interview/2-speaker video as a "talking head" or "vlog"
- When detected format is "interview": your response.message MUST acknowledge it's a conversation between ${ctx.detectedSpeakers || 'multiple'} people, and your suggestions MUST be interview-appropriate (extract highlights, clean dialogue pacing, Shorts-ready Q&A clips)
- When detected format is "monologue": your response.message may classify as talking head, tutorial, or vlog based on content and duration
- The transcript preview is speaker-labelled — use it to understand who is speaking and what the conversation is about before writing your assessment`;
    }

    /**
     * Return a valid BrainOutput when the AI is unavailable.
     * @param {string|null} rawInput
     * @returns {import('./types').BrainOutput}
     */
    fallbackOutput(rawInput) {
        return {
            intent: {
                type: 'execute',
                confidence: 0.5,
                command: rawInput || null,
                reasoning: 'Brain unavailable — passing through raw input',
            },
            response: {
                // null, not a placeholder string — a fallback BrainOutput means
                // the Brain call failed (no key, empty completion, or a thrown
                // error just above); rendering a fixed "Processing your
                // request…" string here made every failure look like a
                // still-in-progress state that never resolves. BrainPanel.jsx
                // already treats a falsy message as "nothing to show" via its
                // hasContent check, so null renders no misleading card at all.
                message: null,
                suggestions: [],
                warnings: [],
                insight: null,
            },
            learning: {
                patternObserved: null,
                profileUpdates: {},
            },
        };
    }

    /**
     * Ensure the parsed GPT-4o output conforms to the BrainOutput shape.
     * @private
     */
    _normalizeBrainOutput(parsed, rawInput) {
        const validIntentTypes = ['execute', 'advise', 'clarify', 'learn_only'];

        const intent = parsed?.intent || {};
        const response = parsed?.response || {};

        return {
            intent: {
                type: validIntentTypes.includes(intent.type) ? intent.type : 'execute',
                confidence: typeof intent.confidence === 'number' ? intent.confidence : 0.5,
                command: intent.command || rawInput || null,
                reasoning: intent.reasoning || '',
            },
            response: {
                message: response.message || 'Done.',
                suggestions: Array.isArray(response.suggestions) ? response.suggestions.slice(0, 3) : [],
                warnings: Array.isArray(response.warnings) ? response.warnings : [],
                insight: response.insight || null,
            },
            learning: {
                patternObserved: parsed?.learning?.patternObserved || null,
                profileUpdates:  parsed?.learning?.profileUpdates  || {},
            },
        };
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _skillDescription(level) {
    const map = {
        beginner:     'use simple language, explain what each action does',
        intermediate: 'assume familiarity with editing concepts',
        advanced:     'use precise technical terminology',
    };
    return map[level] || map.beginner;
}

function _topCommands(commonCommands) {
    if (!commonCommands || typeof commonCommands !== 'object') return 'none';
    return Object.entries(commonCommands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cmd, count]) => `${cmd}(${count})`)
        .join(', ') || 'none';
}

function _getLoudness(platform) {
    const map = { podcast: -16, youtube_long: -14, tiktok: -14, instagram_reels: -14, youtube_shorts: -14, linkedin: -14 };
    return map[platform] || -14;
}

function _platformRulesText(platformKey) {
    if (!platformKey) return '(no platform selected — advise user to choose a target platform)';
    try {
        const { PLATFORM_KNOWLEDGE } = require('./PlatformKnowledge');
        const p = PLATFORM_KNOWLEDGE[platformKey];
        if (!p) return `(unknown platform: ${platformKey})`;
        return [
            `Name: ${p.name}`,
            `Ideal duration: ${Math.round(p.idealDuration.min / 60)}–${Math.round(p.idealDuration.max / 60)} min`,
            `Hook: within first ${p.hookDuration.max}s`,
            `Captions required: ${p.captionsRequired ? 'YES' : 'no'}`,
            `Pace: ${p.paceStyle} (${p.cutRate.min}–${p.cutRate.max} cuts/min)`,
            `Loudness: ${p.loudnessStandard} LUFS`,
            '',
            'Retention rules:',
            ...(p.retentionRules || []).map(r => `  - ${r}`),
            '',
            `Editing style: ${p.editingStyle}`,
        ].join('\n');
    } catch {
        return '(platform knowledge unavailable)';
    }
}

module.exports = { EditorialBrain, buildAssetInventoryText };
