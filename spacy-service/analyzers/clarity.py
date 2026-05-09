"""
Clarity Scoring Engine
======================
Computes a 0-1 clarity score for user prompts.
Deductions are applied for missing fields, vague language, etc.
Weights are configurable per platform for future extensibility.
"""

from typing import Optional

# ── Default deduction weights ──────────────────────────────────────
DEFAULT_WEIGHTS = {
    "no_platform":        0.15,
    "no_content_type":    0.15,
    "no_timeline_long":   0.12,   # only applied when video > 5 min
    "vague_pronouns":     0.08,
    "generic_verbs":      0.10,
    "no_action":          0.10,
    "no_intent":          0.08,
}

# ── Per-platform weight overrides ──────────────────────────────────
PLATFORM_WEIGHTS = {
    "tiktok": {
        "no_timeline_long": 0.05,   # TikTok clips are short; timeline less critical
        "no_content_type":  0.10,
    },
    "youtube": {
        "no_timeline_long": 0.18,   # YouTube videos are long; timeline matters more
    },
    "instagram": {
        "no_timeline_long": 0.06,
    },
}

VAGUE_PRONOUNS = {"this", "that", "it", "something", "stuff", "thing", "things"}
GENERIC_VERBS  = {"do", "make", "get", "put", "use"}

# Direct editing operations that never need a platform or content type.
# These are self-contained commands where asking for a platform is pointless.
DIRECT_EDITING_VERBS = {
    "split", "trim", "cut", "remove", "delete", "silence",
    "clean", "denoise", "normalize", "export", "undo", "redo",
    "duplicate", "speed", "slow", "fast", "mute", "unmute",
    "caption", "subtitle", "filter", "grade", "color", "transition",
    "filler", "analyze", "hook", "reframe", "zoom", "punch",
    "fix", "detect", "silence",
}


def compute_clarity_score(
    action: Optional[str],
    platform: Optional[str],
    content_type: Optional[str],
    timeline: Optional[dict],
    intent: Optional[str],
    raw_tokens: list[str],
    video_duration_seconds: Optional[float] = None,
) -> tuple[float, bool, list[str]]:
    """
    Returns (clarity_score, needs_clarification, clarification_questions).
    """
    # Merge platform-specific weights on top of defaults
    weights = {**DEFAULT_WEIGHTS}
    if platform and platform in PLATFORM_WEIGHTS:
        weights.update(PLATFORM_WEIGHTS[platform])

    score = 1.0
    questions: list[str] = []
    lower_tokens = [t.lower() for t in raw_tokens]

    # ── Fast path: direct editing command ─────────────────────────
    # If the prompt is a clear, direct editing command (e.g. "remove silences",
    # "clean this clip", "normalize audio"), we never ask about platform or
    # content type — that would be annoying and irrelevant.
    is_direct_edit = action and action in DIRECT_EDITING_VERBS
    if not is_direct_edit:
        # Also check raw tokens in case spaCy missed the action verb
        is_direct_edit = any(t in DIRECT_EDITING_VERBS for t in lower_tokens)

    # ── Missing platform ───────────────────────────────────────────
    # Skip penalty for direct editing commands
    if not platform and not is_direct_edit:
        score -= weights["no_platform"]
        questions.append("Which platform is this for? (TikTok, YouTube, Instagram, etc.)")

    # ── Missing content type ───────────────────────────────────────
    # Skip penalty for direct editing commands
    if not content_type and not is_direct_edit:
        score -= weights["no_content_type"]
        questions.append("What type of content do you want? (clips, highlights, trailer, summary)")

    # ── Missing action verb ────────────────────────────────────────
    if not action:
        score -= weights["no_action"]

    # ── No intent detected ─────────────────────────────────────────
    # Skip for direct editing commands — they don't have emotional intent
    if not intent and not is_direct_edit:
        score -= weights["no_intent"]
        questions.append("Do you want emotional, funny, or informative moments?")

    # ── No timeline for long videos ────────────────────────────────
    is_long_video = video_duration_seconds is not None and video_duration_seconds > 300
    if is_long_video and not timeline and not is_direct_edit:
        score -= weights["no_timeline_long"]
        dur_min = int(video_duration_seconds / 60)
        questions.append(
            f"The video is {dur_min} minutes long. Which section should I focus on?"
        )

    # ── Vague pronoun usage ────────────────────────────────────────
    # Only penalize if not a direct edit ("this" in "clean this clip" is fine)
    vague_count = sum(1 for t in lower_tokens if t in VAGUE_PRONOUNS)
    if vague_count > 0 and not is_direct_edit:
        score -= weights["vague_pronouns"] * min(vague_count, 3)

    # ── Generic verb without clear object ──────────────────────────
    if action and action in GENERIC_VERBS and not content_type:
        score -= weights["generic_verbs"]

    score = max(0.0, min(1.0, round(score, 2)))
    # Threshold lowered: direct edit commands score 1.0, vague ones go below 0.55
    needs_clarification = score < 0.55

    return score, needs_clarification, questions
