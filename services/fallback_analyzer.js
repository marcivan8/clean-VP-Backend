/**
 * fallback_analyzer.js
 * =====================
 * Pure-JS drop-in replacement for the spaCy microservice.
 * Used automatically when http://spacy-service.railway.internal:8001 is
 * unreachable (cold start, crash, deploy gap, etc.).
 *
 * Output schema is identical to the Python service so callers need zero
 * changes — just swap the HTTP call for a local function call.
 *
 * Covers:
 *   - analyzePrompt()     → /analyze-prompt
 *   - analyzeTranscript() → /analyze-transcript
 */

// ─── Lookup tables (ported from Python) ──────────────────────────────────────

const PLATFORM_MAP = {
  tiktok: "tiktok", "tik tok": "tiktok",
  youtube: "youtube", "youtube shorts": "youtube_shorts",
  "yt shorts": "youtube_shorts", shorts: "youtube_shorts",
  instagram: "instagram", "instagram reels": "instagram_reels",
  "ig reels": "instagram_reels", reels: "instagram_reels",
  facebook: "facebook", twitter: "twitter", x: "twitter",
  linkedin: "linkedin", snapchat: "snapchat",
};

const CONTENT_TYPES = {
  clip: "clips", clips: "clips",
  highlight: "highlights", highlights: "highlights",
  trailer: "trailer", summary: "summary", montage: "montage",
  reel: "reels", reels: "reels", short: "shorts", shorts: "shorts",
  video: "video", edit: "edit", cut: "cuts", cuts: "cuts",
  compilation: "compilation", teaser: "teaser",
  "b-roll": "b-roll", broll: "b-roll", voiceover: "voiceover",
};

const INTENT_KEYWORDS = {
  emotional: "emotional moments", emotion: "emotional moments",
  funny: "funny moments", humor: "funny moments",
  dramatic: "dramatic moments", exciting: "exciting moments",
  best: "best moments", interesting: "interesting moments",
  informative: "informative moments", educational: "educational content",
  inspiring: "inspiring moments", sad: "sad moments",
  intense: "intense moments", cool: "best moments",
  viral: "viral moments", engaging: "engaging moments",
  hook: "hook/attention-grabbing", attention: "hook/attention-grabbing",
  pacing: "pacing/flow", flow: "pacing/flow",
  dynamic: "dynamic/fast-paced", retention: "retention-optimized",
  cinematic: "cinematic/high-quality",
};

const ACTION_VERBS = new Set([
  "make","create","cut","trim","edit","extract","generate","build","produce",
  "compile","find","select","pick","grab","remove","delete","split","merge",
  "combine","add","apply","shorten","lengthen","crop","resize","reframe",
  "ripple","duck","normalize","punch","zoom","desaturate","overlay","caption",
  "inject","enhance","grade","clean","denoise","export","undo","redo","mute",
  "unmute","silence","analyze","detect","fix",
]);

const DIRECT_EDITING_VERBS = new Set([
  "split","trim","cut","remove","delete","silence","clean","denoise",
  "normalize","export","undo","redo","duplicate","speed","slow","fast",
  "mute","unmute","caption","subtitle","filter","grade","color","transition",
  "filler","analyze","hook","reframe","zoom","punch","fix","detect",
]);

const VAGUE_PRONOUNS = new Set(["this","that","it","something","stuff","thing","things"]);
const GENERIC_VERBS  = new Set(["do","make","get","put","use"]);

const EMOTION_WORDS = {
  amazing:0.9, incredible:0.9, awesome:0.85, love:0.8, excited:0.85, wow:0.9,
  beautiful:0.75, perfect:0.8, fantastic:0.85, brilliant:0.8, wonderful:0.8,
  terrible:0.85, horrible:0.85, angry:0.8, furious:0.9, shocking:0.9,
  scary:0.8, terrifying:0.9, disaster:0.85, hate:0.8, worst:0.85,
  surprised:0.85, unexpected:0.8, unbelievable:0.9, crazy:0.8, insane:0.85,
  wild:0.75, sad:0.7, crying:0.75, heartbreaking:0.85, painful:0.7,
  devastating:0.85, good:0.3, nice:0.3, great:0.5, happy:0.6,
  fun:0.55, enjoy:0.5, like:0.2, okay:0.1, fine:0.1, alright:0.1,
};

const CTA_VERBS = new Set([
  "subscribe","like","share","comment","follow","click","tap","join","sign",
  "register","download","check","visit","buy","grab","watch","listen","try",
  "start","smash","hit",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIME_RE = /(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d+\s*(?:s|sec|seconds?|m|min|minutes?|h|hours?))/gi;
const RANGE_RE = /(?:between|from)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(?:and|to)\s+(\d{1,2}:\d{2}(?::\d{2})?)/i;

function timeToSeconds(t) {
  t = t.trim().toLowerCase();
  const parts = t.split(":");
  if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + +parts[2];
  if (parts.length === 2) return +parts[0] * 60 + +parts[1];
  const m = t.match(/^(\d+)\s*(s|m|h)/);
  if (m) {
    const n = +m[1];
    if (m[2] === "h") return n * 3600;
    if (m[2] === "m") return n * 60;
    return n;
  }
  return parseFloat(t) || 0;
}

function tokenize(text) {
  return text.toLowerCase().match(/\b\w+\b/g) || [];
}

/** Naive sentence splitter — good enough without a full NLP stack. */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ─── Clarity scoring ─────────────────────────────────────────────────────────

function computeClarityScore({ action, platform, contentType, timeline, intent, tokens, videoDurationSeconds }) {
  const weights = {
    no_platform:      0.15,
    no_content_type:  0.15,
    no_timeline_long: 0.12,
    vague_pronouns:   0.08,
    generic_verbs:    0.10,
    no_action:        0.10,
    no_intent:        0.08,
  };

  const isDirectEdit = (action && DIRECT_EDITING_VERBS.has(action)) ||
                       tokens.some(t => DIRECT_EDITING_VERBS.has(t));

  let score = 1.0;
  const questions = [];

  if (!platform && !isDirectEdit) {
    score -= weights.no_platform;
    questions.push("Which platform is this for? (TikTok, YouTube, Instagram, etc.)");
  }
  if (!contentType && !isDirectEdit) {
    score -= weights.no_content_type;
    questions.push("What type of content do you want? (clips, highlights, trailer, summary)");
  }
  if (!action) score -= weights.no_action;
  if (!intent && !isDirectEdit) {
    score -= weights.no_intent;
    questions.push("Do you want emotional, funny, or informative moments?");
  }

  const isLong = videoDurationSeconds != null && videoDurationSeconds > 300;
  if (isLong && !timeline && !isDirectEdit) {
    score -= weights.no_timeline_long;
    const min = Math.floor(videoDurationSeconds / 60);
    questions.push(`The video is ${min} minutes long. Which section should I focus on?`);
  }

  const vagueCount = tokens.filter(t => VAGUE_PRONOUNS.has(t)).length;
  if (vagueCount > 0 && !isDirectEdit) {
    score -= weights.vague_pronouns * Math.min(vagueCount, 3);
  }
  if (action && GENERIC_VERBS.has(action) && !contentType) {
    score -= weights.generic_verbs;
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { clarityScore: score, needsClarification: score < 0.55, clarificationQuestions: questions };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * analyzePrompt
 * Mirrors POST /analyze-prompt from the Python service.
 *
 * @param {string} prompt
 * @param {number|null} videoDurationSeconds
 * @returns {object} Same schema as Python service response
 */
function analyzePrompt(prompt, videoDurationSeconds = null) {
  const lower = prompt.toLowerCase();
  const tokens = tokenize(prompt);

  // 1. Action verb
  let action = null;
  for (const t of tokens) {
    if (ACTION_VERBS.has(t)) { action = t; break; }
  }

  // 2. Platform
  let platform = null;
  for (const [key, val] of Object.entries(PLATFORM_MAP)) {
    if (lower.includes(key)) { platform = val; break; }
  }

  // 3. Content type
  let contentType = null;
  for (const [key, val] of Object.entries(CONTENT_TYPES)) {
    if (lower.includes(key)) { contentType = val; break; }
  }

  // 4. Timeline
  let timeline = null;
  const rangeMatch = RANGE_RE.exec(prompt);
  if (rangeMatch) {
    timeline = { start: rangeMatch[1], end: rangeMatch[2] };
  } else {
    const timeMatches = [...prompt.matchAll(TIME_RE)].map(m => m[1].trim());
    if (timeMatches.length >= 2)     timeline = { start: timeMatches[0], end: timeMatches[1] };
    else if (timeMatches.length === 1) timeline = { start: timeMatches[0], end: null };
  }

  // 5. Timeline validation
  let timelineError = false;
  let timelineErrorMessage = null;
  if (timeline && videoDurationSeconds != null) {
    const checkVal = timeline.end
      ? timeToSeconds(timeline.end)
      : timeToSeconds(timeline.start);
    if (checkVal > videoDurationSeconds) {
      timelineError = true;
      timelineErrorMessage =
        `Requested timeline (${timeline.start} – ${timeline.end ?? "?"}) ` +
        `exceeds video duration (${Math.floor(videoDurationSeconds)}s)`;
    }
  }

  // 6. Intent
  let intent = null;
  for (const [key, val] of Object.entries(INTENT_KEYWORDS)) {
    if (lower.includes(key)) { intent = val; break; }
  }

  // 7. Clarity
  const { clarityScore, needsClarification, clarificationQuestions } =
    computeClarityScore({ action, platform, contentType, timeline, intent, tokens, videoDurationSeconds });

  // 8. Missing fields
  const missingFields = [];
  if (!action)       missingFields.push("action");
  if (!platform)     missingFields.push("platform");
  if (!contentType)  missingFields.push("content_type");
  if (!timeline && videoDurationSeconds && videoDurationSeconds > 300) missingFields.push("timeline");

  const result = {
    action,
    platform,
    content_type: contentType,
    timeline,
    intent,
    clarity_score:           clarityScore,
    missing_fields:          missingFields,
    needs_clarification:     needsClarification,
    clarification_questions: clarificationQuestions,
    _fallback: true,
  };

  if (timelineError) {
    result.timeline_error = true;
    result.message        = timelineErrorMessage;
    result.video_duration = videoDurationSeconds;
  }

  return result;
}

/**
 * analyzeTranscript
 * Mirrors POST /analyze-transcript from the Python service.
 *
 * @param {string} transcript
 * @param {number|null} videoDurationSeconds
 * @returns {object} Same schema as Python service response
 */
function analyzeTranscript(transcript, videoDurationSeconds = null) {
  const rawSentences = splitSentences(transcript);

  const sentences = rawSentences.map(text => {
    const words = tokenize(text);

    const isQuestion = text.endsWith("?") ||
      /^(what|who|where|when|why|how|is|are|was|were|do|does|did|can|could|would|should|will)\b/i.test(text);

    const isCta = CTA_VERBS.has(words[0]) ||
      (words[1] && CTA_VERBS.has(words[1])) ||
      words.some(w => CTA_VERBS.has(w));

    const emotionScores = words.map(w => EMOTION_WORDS[w] || 0).filter(s => s > 0);
    const emotionScore = emotionScores.length
      ? Math.round((emotionScores.reduce((a, b) => a + b, 0) / emotionScores.length) * 100) / 100
      : 0;

    const entities = text.match(/(?<!\. )\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) || [];
    const uniqueEntities = [...new Set(entities)];

    const highlightScore = Math.min(1,
      emotionScore * 0.40 +
      (isCta       ? 1 : 0) * 0.25 +
      (isQuestion  ? 1 : 0) * 0.20 +
      Math.min(uniqueEntities.length / 3, 1) * 0.15
    );

    return {
      text,
      is_question:     isQuestion,
      is_cta:          isCta,
      emotion_score:   emotionScore,
      entities:        uniqueEntities,
      highlight_score: Math.round(highlightScore * 100) / 100,
    };
  });

  const result = { sentences, _fallback: true };
  if (videoDurationSeconds != null) {
    result.video_duration_seconds = videoDurationSeconds;
    result.sentence_count         = sentences.length;
  }
  return result;
}

module.exports = { analyzePrompt, analyzeTranscript };
