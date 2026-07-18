/**
 * server/brain/types.js
 *
 * Shared contract types for the Editorial Brain system.
 * No logic — JSDoc typedefs only.
 * All files in server/brain/ import from this file for type reference.
 */

'use strict';

/**
 * @typedef {Object} BrainInput
 * @property {string} userId           - Authenticated user ID
 * @property {string} rawInput         - The user's raw text command (may be null for triggers)
 * @property {string} trigger          - What triggered this: 'user_typed'|'user_spoke'|'suggestion_tapped'|'project_opened'|'asset_added'
 * @property {Object} context          - Full project context snapshot
 * @property {Object} context.timeline - Timeline state (tracks, clips, assets)
 * @property {Array}  context.captions - Caption/transcript data
 * @property {number} context.duration - Total project duration in seconds
 * @property {Array}  context.mediaBin - All assets in the media bin
 * @property {string} context.platform - Target platform key (tiktok, youtube_long, etc.)
 * @property {Array}  context.editHistory - List of edit action names applied this session
 * @property {string} context.projectId   - Project UUID
 */

/**
 * @typedef {Object} Intent
 * @property {'execute'|'advise'|'clarify'|'learn_only'} type - What the brain decided to do
 * @property {number} confidence    - 0.0–1.0 confidence score
 * @property {string|null} command  - Resolved vibed command string, or null for advise/clarify
 * @property {string} reasoning     - One-sentence explanation of the decision
 */

/**
 * @typedef {Object} Suggestion
 * @property {string} type     - Unique key for this suggestion type (e.g. 'generate_captions')
 * @property {string} text     - Short label for chip display
 * @property {string} command  - Exact vibed command string to execute
 * @property {string} reason   - Why this suggestion matters
 * @property {'critical'|'high'|'medium'|'low'} priority - Display priority
 */

/**
 * @typedef {Object} Warning
 * @property {string} type    - Warning type key
 * @property {string} text    - Human-readable warning message
 * @property {'critical'|'warning'|'info'} severity
 */

/**
 * @typedef {Object} Insight
 * @property {boolean} show  - Whether to display this insight
 * @property {string} title  - Short title
 * @property {string} body   - 1–2 sentences of context
 */

/**
 * @typedef {Object} BrainResponse
 * @property {string}      message     - Conversational response to the user
 * @property {Suggestion[]} suggestions - Up to 4 ranked suggestions
 * @property {Warning[]}   warnings    - Platform/quality warnings
 * @property {Insight|null} insight    - Optional insight card
 */

/**
 * @typedef {Object} BrainLearning
 * @property {string|null} patternObserved - Pattern detected (or null)
 * @property {Object}      profileUpdates  - Partial profile fields to update
 */

/**
 * @typedef {Object} BrainOutput
 * @property {Intent}        intent   - What the brain resolved
 * @property {BrainResponse} response - What to show the user
 * @property {BrainLearning} learning - What to persist
 */

/**
 * @typedef {Object} EngineResult
 * @property {boolean}     success       - Whether execution succeeded
 * @property {string|null} error         - Error message if failed
 * @property {Object|null} timelineAfter - Timeline state after execution (or null)
 * @property {string}      actionTaken   - Human-readable summary of what was done
 */

/**
 * @typedef {Object} BrainObservation
 * @property {Suggestion[]} nextSuggestions - Suggestions inferred from patterns
 */

/**
 * @typedef {Object} SessionEvent
 * @property {string} id        - Unique event ID (uuid-like)
 * @property {string} sessionId - Parent session ID
 * @property {string} timestamp - ISO timestamp
 * @property {string} type      - Event type key
 * @property {string} summary   - Human-readable summary
 * @property {*}      [data]    - Optional additional data
 */

/**
 * @typedef {Object} UserProfile
 * @property {string}  user_id
 * @property {number}  avg_cut_rate
 * @property {string}  preferred_pace
 * @property {Array}   preferred_fonts
 * @property {Array}   preferred_platforms
 * @property {Object}  accepted_suggestions
 * @property {Object}  rejected_suggestions
 * @property {Array}   permanently_hidden
 * @property {Object}  common_commands
 * @property {'beginner'|'intermediate'|'advanced'} skill_level
 * @property {string}  content_type
 * @property {boolean} typically_removes_silences
 * @property {boolean} typically_adds_captions
 * @property {boolean} typically_adds_music
 * @property {string}  updated_at
 */

module.exports = {};
