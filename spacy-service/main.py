"""
Viral Pilot — spaCy NLP Microservice
=====================================
FastAPI application providing prompt analysis, transcript analysis,
and clarity scoring for the Viral Pilot video editing platform.

Run: uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""

import sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

# Lazy imports — only fail when an endpoint is actually called
_prompt_analyzer = None
_transcript_analyzer = None
_model_loaded = False

def _ensure_model():
    """Load analyzers on first use. Raises HTTPException if model is missing."""
    global _prompt_analyzer, _transcript_analyzer, _model_loaded
    if _model_loaded:
        return
    try:
        from analyzers.prompt_analyzer import analyze_prompt as _pa
        from analyzers.transcript_analyzer import analyze_transcript as _ta
        _prompt_analyzer = _pa
        _transcript_analyzer = _ta
        _model_loaded = True
    except OSError as e:
        raise HTTPException(
            status_code=503,
            detail=(
                "spaCy model 'en_core_web_sm' is not installed. "
                "Run: python -m spacy download en_core_web_sm"
            ),
        )

app = FastAPI(
    title="Viral Pilot NLP Service",
    description="spaCy-powered prompt & transcript analysis for Viral Pilot",
    version="1.0.0",
)

# Allow Node.js backend to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Startup check ─────────────────────────────────────────────────
@app.on_event("startup")
def check_model():
    global _prompt_analyzer, _transcript_analyzer, _model_loaded
    try:
        from analyzers.prompt_analyzer import analyze_prompt as _pa
        from analyzers.transcript_analyzer import analyze_transcript as _ta
        _prompt_analyzer = _pa
        _transcript_analyzer = _ta
        _model_loaded = True
        print("✅ spaCy model loaded successfully")
    except OSError:
        print("⚠️  spaCy model 'en_core_web_sm' not found.")
        print("   Run: python -m spacy download en_core_web_sm")
        print("   The service will start but endpoints will return 503 until the model is installed.")


# ── Request / Response Models ──────────────────────────────────────

class PromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="User's natural language prompt")
    video_duration_seconds: Optional[float] = Field(
        None, description="Duration of the video in seconds (for timeline validation)"
    )

class TranscriptRequest(BaseModel):
    transcript: str = Field(..., min_length=1, description="Full transcript text")
    video_duration_seconds: Optional[float] = Field(
        None, description="Duration of the video in seconds"
    )


# ── Endpoints ──────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok" if _model_loaded else "degraded",
        "service": "spacy-nlp",
        "version": "1.0.0",
        "model_loaded": _model_loaded,
    }


@app.post("/analyze-prompt")
def endpoint_analyze_prompt(req: PromptRequest):
    """
    Analyze a user prompt and return structured extraction + clarity score.
    """
    _ensure_model()
    try:
        result = _prompt_analyzer(
            prompt=req.prompt,
            video_duration_seconds=req.video_duration_seconds,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze-transcript")
def endpoint_analyze_transcript(req: TranscriptRequest):
    """
    Analyze a transcript and return per-sentence intelligence.
    """
    _ensure_model()
    try:
        result = _transcript_analyzer(
            transcript=req.transcript,
            video_duration_seconds=req.video_duration_seconds,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Main entry point ───────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
