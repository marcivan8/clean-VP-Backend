"""
Prompt Analyzer
===============
Extracts structured information from user prompts using spaCy NLP.
"""

import re
import spacy
from typing import Optional
from .clarity import compute_clarity_score

nlp = spacy.load("en_core_web_sm")

# ── Lookup tables ──────────────────────────────────────────────────

PLATFORM_MAP = {
    "tiktok":           "tiktok",
    "tik tok":          "tiktok",
    "youtube":          "youtube",
    "youtube shorts":   "youtube_shorts",
    "yt shorts":        "youtube_shorts",
    "shorts":           "youtube_shorts",
    "instagram":        "instagram",
    "instagram reels":  "instagram_reels",
    "ig reels":         "instagram_reels",
    "reels":            "instagram_reels",
    "facebook":         "facebook",
    "twitter":          "twitter",
    "x":                "twitter",
    "linkedin":         "linkedin",
    "snapchat":         "snapchat",
}

CONTENT_TYPES = {
    "clip":       "clips",
    "clips":      "clips",
    "highlight":  "highlights",
    "highlights": "highlights",
    "trailer":    "trailer",
    "summary":    "summary",
    "montage":    "montage",
    "reel":       "reels",
    "reels":      "reels",
    "short":      "shorts",
    "shorts":     "shorts",
    "video":      "video",
    "edit":       "edit",
    "cut":        "cuts",
    "cuts":       "cuts",
    "compilation":"compilation",
    "teaser":     "teaser",
    "b-roll":     "b-roll",
    "broll":      "b-roll",
    "stock":      "b-roll",
    "voiceover":  "voiceover",
    "vo":         "voiceover",
}

INTENT_KEYWORDS = {
    "emotional":   "emotional moments",
    "emotion":     "emotional moments",
    "funny":       "funny moments",
    "humor":       "funny moments",
    "dramatic":    "dramatic moments",
    "exciting":    "exciting moments",
    "best":        "best moments",
    "interesting": "interesting moments",
    "informative": "informative moments",
    "educational": "educational content",
    "inspiring":   "inspiring moments",
    "sad":         "sad moments",
    "intense":     "intense moments",
    "cool":        "best moments",
    "viral":       "viral moments",
    "engaging":    "engaging moments",
    "hook":        "hook/attention-grabbing",
    "attention":   "hook/attention-grabbing",
    "pacing":      "pacing/flow",
    "flow":        "pacing/flow",
    "dynamic":     "dynamic/fast-paced",
    "retention":   "retention-optimized",
    "cinematic":   "cinematic/high-quality",
}

# Regex patterns for timeline references like 00:20, 2:30, 1:05:30, 30s, 2min
TIME_PATTERN = re.compile(
    r'(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d+\s*(?:s|sec|seconds?|m|min|minutes?|h|hours?))',
    re.IGNORECASE,
)

# "between X and Y" or "from X to Y"
RANGE_PATTERN = re.compile(
    r'(?:between|from)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(?:and|to)\s+(\d{1,2}:\d{2}(?::\d{2})?)',
    re.IGNORECASE,
)

ACTION_VERBS = {
    "make", "create", "cut", "trim", "edit", "extract", "generate",
    "build", "produce", "compile", "find", "select", "pick", "grab",
    "remove", "delete", "split", "merge", "combine", "add", "apply",
    "shorten", "lengthen", "crop", "resize", "reframe", "ripple",
    "duck", "normalize", "punch", "zoom", "desaturate", "overlay",
    "caption", "inject", "enhance", "grade",
    # Direct editing verbs that map to self-contained operations
    "clean", "denoise", "export", "undo", "redo", "mute", "unmute",
    "silence", "analyze", "detect", "fix",
}


def _time_str_to_seconds(t: str) -> float:
    """Convert a time string like '02:30' or '1:05:30' or '30s' to seconds."""
    t = t.strip().lower()
    # HH:MM:SS or MM:SS
    parts = t.split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    # Number with unit suffix
    m = re.match(r'(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)', t)
    if m:
        val = int(m.group(1))
        unit = m.group(2)[0]  # first char: s, m, h
        if unit == 'h':
            return val * 3600
        if unit == 'm':
            return val * 60
        return float(val)
    # Plain number → assume seconds
    try:
        return float(t)
    except ValueError:
        return 0.0


def analyze_prompt(
    prompt: str,
    video_duration_seconds: Optional[float] = None,
) -> dict:
    """
    Analyze a user prompt and return structured extraction + clarity score.
    """
    doc = nlp(prompt)
    lower = prompt.lower()
    tokens = [tok.text for tok in doc]

    # ── 1. Action verb ─────────────────────────────────────────────
    action = None
    for tok in doc:
        if tok.pos_ == "VERB" and tok.lemma_.lower() in ACTION_VERBS:
            action = tok.lemma_.lower()
            break
    # Fallback: scan raw text
    if not action:
        for v in ACTION_VERBS:
            if v in lower:
                action = v
                break

    # ── 2. Platform ────────────────────────────────────────────────
    platform = None
    for key, val in PLATFORM_MAP.items():
        if key in lower:
            platform = val
            break

    # ── 3. Content type ────────────────────────────────────────────
    content_type = None
    for key, val in CONTENT_TYPES.items():
        if key in lower:
            content_type = val
            break

    # ── 4. Timeline references ─────────────────────────────────────
    timeline = None
    range_match = RANGE_PATTERN.search(prompt)
    if range_match:
        start_str, end_str = range_match.group(1), range_match.group(2)
        timeline = {"start": start_str, "end": end_str}
    else:
        time_matches = TIME_PATTERN.findall(prompt)
        if len(time_matches) >= 2:
            timeline = {"start": time_matches[0].strip(), "end": time_matches[1].strip()}
        elif len(time_matches) == 1:
            timeline = {"start": time_matches[0].strip(), "end": None}

    # ── 5. Timeline validation ─────────────────────────────────────
    timeline_error = False
    timeline_error_message = None
    if timeline and video_duration_seconds is not None:
        end_val = None
        if timeline.get("end"):
            end_val = _time_str_to_seconds(timeline["end"])
        start_val = _time_str_to_seconds(timeline.get("start", "0"))
        check_val = end_val if end_val else start_val
        if check_val > video_duration_seconds:
            timeline_error = True
            timeline_error_message = (
                f"Requested timeline ({timeline.get('start', '0')} – {timeline.get('end', '?')}) "
                f"exceeds video duration ({int(video_duration_seconds)}s)"
            )

    # ── 6. Emotional intent ────────────────────────────────────────
    intent = None
    for key, val in INTENT_KEYWORDS.items():
        if key in lower:
            intent = val
            break

    # ── 7. Clarity score ───────────────────────────────────────────
    clarity_score, needs_clarification, clarification_questions = compute_clarity_score(
        action=action,
        platform=platform,
        content_type=content_type,
        timeline=timeline,
        intent=intent,
        raw_tokens=tokens,
        video_duration_seconds=video_duration_seconds,
    )

    # ── 8. Missing fields ──────────────────────────────────────────
    missing_fields = []
    if not action:
        missing_fields.append("action")
    if not platform:
        missing_fields.append("platform")
    if not content_type:
        missing_fields.append("content_type")
    if not timeline and video_duration_seconds and video_duration_seconds > 300:
        missing_fields.append("timeline")

    # ── Build response ─────────────────────────────────────────────
    result = {
        "action": action,
        "platform": platform,
        "content_type": content_type,
        "timeline": timeline,
        "intent": intent,
        "clarity_score": clarity_score,
        "missing_fields": missing_fields,
        "needs_clarification": needs_clarification,
        "clarification_questions": clarification_questions,
    }

    if timeline_error:
        result["timeline_error"] = True
        result["message"] = timeline_error_message
        result["video_duration"] = video_duration_seconds

    return result
