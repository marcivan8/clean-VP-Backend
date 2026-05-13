"""
Transcript Analyzer
====================
Segments transcripts, detects questions/CTAs/emotion, extracts entities,
and computes per-sentence highlight scores.
"""

# pyrefly: ignore [missing-import]
import spacy
from typing import Optional

nlp = spacy.load("en_core_web_sm")

# ── Emotion lexicon (keyword → weight) ─────────────────────────────
EMOTION_WORDS = {
    # Positive high-arousal
    "amazing": 0.9, "incredible": 0.9, "awesome": 0.85, "love": 0.8,
    "excited": 0.85, "wow": 0.9, "beautiful": 0.75, "perfect": 0.8,
    "fantastic": 0.85, "brilliant": 0.8, "wonderful": 0.8,
    # Negative high-arousal
    "terrible": 0.85, "horrible": 0.85, "angry": 0.8, "furious": 0.9,
    "shocking": 0.9, "scary": 0.8, "terrifying": 0.9, "disaster": 0.85,
    "hate": 0.8, "worst": 0.85,
    # Surprise
    "surprised": 0.85, "unexpected": 0.8, "unbelievable": 0.9,
    "crazy": 0.8, "insane": 0.85, "wild": 0.75,
    # Sadness
    "sad": 0.7, "crying": 0.75, "heartbreaking": 0.85, "painful": 0.7,
    "devastating": 0.85,
    # Moderate positive
    "good": 0.3, "nice": 0.3, "great": 0.5, "happy": 0.6,
    "fun": 0.55, "enjoy": 0.5, "like": 0.2,
    # Neutral/filler (low)
    "okay": 0.1, "fine": 0.1, "alright": 0.1,
}

# CTA verbs (imperative calls-to-action)
CTA_VERBS = {
    "subscribe", "like", "share", "comment", "follow", "click",
    "tap", "join", "sign", "register", "download", "check",
    "visit", "buy", "grab", "watch", "listen", "try", "start",
    "smash", "hit",
}


def _is_question(sent) -> bool:
    """Detect question sentences."""
    text = sent.text.strip()
    if text.endswith("?"):
        return True
    # spaCy POS-based: starts with WH-word or auxiliary
    first_token = sent[0] if len(sent) > 0 else None
    if first_token and first_token.tag_ in ("WDT", "WP", "WP$", "WRB"):
        return True
    return False


def _is_cta(sent) -> bool:
    """Detect imperative / call-to-action sentences."""
    tokens = list(sent)
    if len(tokens) == 0:
        return False
    first = tokens[0]
    # Imperative: sentence starts with a base-form verb
    if first.pos_ == "VERB" and first.tag_ == "VB":
        if first.lemma_.lower() in CTA_VERBS:
            return True
    # Also check second token (e.g., "Please subscribe")
    if len(tokens) > 1 and tokens[1].pos_ == "VERB":
        if tokens[1].lemma_.lower() in CTA_VERBS:
            return True
    # Keyword fallback
    lower = sent.text.lower()
    for verb in CTA_VERBS:
        if verb in lower:
            return True
    return False


def _emotion_score(sent) -> float:
    """Compute emotion score for a sentence based on keyword matching."""
    words = [tok.lemma_.lower() for tok in sent if tok.is_alpha]
    if not words:
        return 0.0
    scores = [EMOTION_WORDS.get(w, 0.0) for w in words]
    if not any(s > 0 for s in scores):
        return 0.0
    # Average of non-zero scores, weighted by count
    positives = [s for s in scores if s > 0]
    return round(sum(positives) / max(len(positives), 1), 2)


def _extract_entities(sent) -> list[str]:
    """Extract named entities from a sentence."""
    return list(set(ent.text for ent in sent.ents))


def _highlight_score(is_question: bool, is_cta: bool, emotion: float, entity_count: int) -> float:
    """
    Compute a composite highlight score (0–1).
    Weights:
      - Emotion:   40%
      - CTA:       25%
      - Question:  20%
      - Entities:  15%
    """
    score = 0.0
    score += emotion * 0.40
    score += (1.0 if is_cta else 0.0) * 0.25
    score += (1.0 if is_question else 0.0) * 0.20
    score += min(entity_count / 3.0, 1.0) * 0.15
    return round(min(1.0, score), 2)


def analyze_transcript(
    transcript: str,
    video_duration_seconds: Optional[float] = None,
) -> dict:
    """
    Analyze a transcript and return per-sentence intelligence.
    """
    doc = nlp(transcript)
    sentences = []

    for sent in doc.sents:
        text = sent.text.strip()
        if not text:
            continue

        is_q = _is_question(sent)
        is_c = _is_cta(sent)
        emo = _emotion_score(sent)
        ents = _extract_entities(sent)
        hl = _highlight_score(is_q, is_c, emo, len(ents))

        sentences.append({
            "text": text,
            "is_question": is_q,
            "is_cta": is_c,
            "emotion_score": emo,
            "entities": ents,
            "highlight_score": hl,
        })

    result = {"sentences": sentences}

    # Timeline validation placeholder
    if video_duration_seconds is not None:
        result["video_duration_seconds"] = video_duration_seconds
        result["sentence_count"] = len(sentences)

    return result
