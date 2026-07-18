/**
 * server/brain/Orchestrator.js
 *
 * Single entry point for all brain requests.
 * Coordinates: session guard → context build → brain → execution → learning → response.
 *
 * SAFETY RULES:
 * - session.processing guard prevents concurrent requests on same session
 * - learner.observe() is NEVER awaited — always fire-and-forget
 * - On 'advise'/'clarify'/'learn_only': execution is skipped entirely
 * - filterSuggestions() never returns more than 4 items
 */

'use strict';

const { EditorialBrain }          = require('./EditorialBrain');
const { UserProfileEngine }       = require('./UserProfileEngine');
const { PatternLearner }          = require('./PatternLearner');
const { MediaIntelligencePipeline } = require('./media/MediaIntelligencePipeline');
const { ContextEngine }           = require('./ContextEngine');
const { getOrCreateSession }      = require('./Session');
const { getPlatform }             = require('./PlatformKnowledge');
const { executeAICommand }        = require('./PipelineAdapter');

class BrainOrchestrator {

    constructor() {
        this.brain         = new EditorialBrain();
        this.profileEngine = new UserProfileEngine();
        this.learner       = new PatternLearner();
        this.mediaIntel    = new MediaIntelligencePipeline();
        this.contextEngine = new ContextEngine();

        // DO NOT instantiate IntentParser, EditPlanner, CommandCompiler,
        // MediaExecutionEngine here — they are client-side and run in the browser.
        // PipelineAdapter is the ONLY connection to the existing AI pipeline.
    }

    /**
     * Process a BrainInput and return a BrainOutput.
     *
     * @param {import('./types').BrainInput} input
     * @returns {Promise<import('./types').BrainOutput>}
     */
    async process(input) {
        // PHASE 1 — SESSION GUARD
        const userId    = input?.userId    || 'anonymous';
        const projectId = input?.context?.projectId || 'default';

        const session = getOrCreateSession(userId, projectId);

        if (session.processing) {
            return this.buildBusyResponse();
        }

        session.processing = true;

        try {
            return await this._processInternal(input, session);
        } finally {
            session.processing = false;
        }
    }

    /** @private */
    async _processInternal(input, session) {
        // PHASE 2 — BUILD CONTEXT
        const rawContext = input?.context || {};
        const context    = this.contextEngine.build(rawContext);
        const profile    = await this.profileEngine.getProfile(input?.userId);
        const platform   = getPlatform(rawContext.platform || null);

        const enrichedInput = {
            ...input,
            context: {
                ...rawContext,
                builtContext: context,
                profile,
                platform,
            },
        };

        // PHASE 3 — BRAIN
        const brainOutput = await this.brain.process(enrichedInput, session);

        session.record({
            type:    'brain_interpreted',
            trigger: input?.trigger || 'unknown',
            raw:     input?.rawInput || null,
            intent:  brainOutput?.intent,
            summary: `"${input?.rawInput || input?.trigger}" → ${brainOutput?.intent?.type}: ${brainOutput?.intent?.command || 'null'}`,
        });

        // PHASE 4 — EARLY EXITS (no execution)
        const intentType = brainOutput?.intent?.type;

        if (intentType === 'clarify') {
            // No await — fire-and-forget
            this.learner.observe(enrichedInput, brainOutput, null, session);
            return brainOutput;
        }

        if (intentType === 'advise') {
            // No await — fire-and-forget
            this.learner.observe(enrichedInput, brainOutput, null, session);
            return brainOutput;
        }

        if (intentType === 'learn_only') {
            // No await — fire-and-forget
            this.learner.observe(enrichedInput, brainOutput, null, session);
            return brainOutput;
        }

        // PHASE 5 — DELEGATE TO EXISTING PIPELINE
        const command = brainOutput?.intent?.command;
        const executionResult = await this._executeViaExistingPipeline(
            command,
            enrichedInput.context,
            input?.userId
        );

        session.record({
            type:    'executed',
            success: executionResult.success,
            summary: `Executed: ${executionResult.success ? 'OK' : (executionResult.error || 'failed')}`,
        });

        if (executionResult.success) {
            session.commandsRun.push(command);
        }

        // PHASE 6 — LEARN (non-blocking — intentionally NOT awaited)
        const observation = this.learner.observe(enrichedInput, brainOutput, executionResult, session);

        // PHASE 6.5 — ASSET RECOMMENDATIONS (fire-and-forget, never awaited)
        // Request SFX + LUT + preset recommendations in the background for the
        // current project. Results are cached server-side; the client polls or
        // re-requests on next panel open. This is intentionally non-blocking.
        if (input?.projectState && input?.userId) {
            const { recommendationEngine } = require('../audio-engine/recommendations/RecommendationEngine.js');
            recommendationEngine.recommendAll(input.projectState, input.userId)
                .then(recs => {
                    if ((recs.sfx?.length || 0) + (recs.luts?.length || 0) + (recs.presets?.length || 0) > 0) {
                        session.record({
                            type:    'asset_recommendations_ready',
                            sfx:     recs.sfx?.length     || 0,
                            luts:    recs.luts?.length    || 0,
                            presets: recs.presets?.length || 0,
                        });
                    }
                })
                .catch(() => {}); // always non-blocking — errors silently suppressed
        }

        // PHASE 7 — RESPOND
        const filteredSuggestions = this.filterSuggestions(
            [
                ...(brainOutput?.response?.suggestions || []),
                ...(observation?.nextSuggestions       || []),
            ],
            session,
            profile
        );

        return {
            ...brainOutput,
            response: {
                ...brainOutput.response,
                message: executionResult.success
                    ? (brainOutput?.response?.message || 'Done.')
                    : `Could not execute: ${executionResult.error || 'Unknown error'}`,
                suggestions: filteredSuggestions,
            },
        };
    }

    /**
     * Execute the brain's resolved command via PipelineAdapter.
     * @private
     */
    async _executeViaExistingPipeline(commandString, projectContext, userId) {
        return executeAICommand(commandString, projectContext, userId);
    }

    /**
     * Deduplicate, filter hidden/shown suggestions, sort by priority, cap at 4.
     *
     * @param {import('./types').Suggestion[]} suggestions
     * @param {import('./Session').EditingSession} session
     * @param {import('./types').UserProfile} profile
     * @returns {import('./types').Suggestion[]}
     */
    filterSuggestions(suggestions, session, profile) {
        const shown  = session?.shownSuggestions || new Set();
        const hidden = Array.isArray(profile?.permanently_hidden) ? profile.permanently_hidden : [];

        const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

        const seen = new Set();
        const filtered = [];

        for (const s of suggestions) {
            if (!s?.type) continue;
            if (seen.has(s.type)) continue;        // deduplicate by type
            if (shown.has(s.type)) continue;        // already shown this session
            if (hidden.includes(s.type)) continue;  // permanently dismissed

            seen.add(s.type);
            filtered.push(s);
        }

        // Sort by priority
        filtered.sort((a, b) => {
            const pa = PRIORITY_ORDER[a.priority] ?? 3;
            const pb = PRIORITY_ORDER[b.priority] ?? 3;
            return pa - pb;
        });

        const result = filtered.slice(0, 4);

        // Mark all returned as shown
        for (const s of result) {
            session?.markSuggestionShown(s.type);
        }

        return result;
    }

    /**
     * Response returned when session.processing is already true.
     * @returns {import('./types').BrainOutput}
     */
    buildBusyResponse() {
        return {
            intent: {
                type:       'advise',
                confidence: 1.0,
                command:    null,
                reasoning:  'Previous command still processing',
            },
            response: {
                message:     'Still working on your last command…',
                suggestions: [],
                warnings:    [],
                insight:     null,
            },
            learning: {
                patternObserved: null,
                profileUpdates:  {},
            },
        };
    }
}

module.exports = { BrainOrchestrator };
