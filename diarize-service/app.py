"""
diarize-service/app.py
WhisperX transcription + pyannote speaker diarization microservice.

POST /diarize
Body: { "filePath": "/abs/path/to/audio.wav", "language": "en" }  (language optional)
Returns: {
  "words": [{ "word": "anyway", "start": 4.2, "end": 4.6, "speaker": "SPEAKER_01" }],
  "speakers": ["SPEAKER_00", "SPEAKER_01"],
  "language": "en"
}

Environment variables required:
  HF_TOKEN — HuggingFace access token (for pyannote gated model)

Optional:
  WHISPERX_DEVICE    — "cpu" or "cuda" (default: cpu)
  WHISPERX_MODEL     — "base", "small", "medium", "large-v2" (default: base)
  WHISPERX_COMPUTE   — "float32" or "int8" (default: int8 for cpu, float16 for cuda)
  MAX_SPEAKERS       — Maximum number of speakers to detect (default: 5)
  PORT               — Server port (default: 5001)
"""

import os
import sys
import logging
import traceback

from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="[diarize] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)

# ── Lazy model loading ────────────────────────────────────────────────────────
# Models are loaded once on first request so the container starts fast and
# Railway's health check can pass before the 3–5 GB model download completes.

_whisperx_model  = None
_align_model     = None
_align_meta      = None
_diarize_pipeline = None

DEVICE   = os.environ.get("WHISPERX_DEVICE",  "cpu")
MODEL_ID = os.environ.get("WHISPERX_MODEL",   "base")
COMPUTE  = os.environ.get("WHISPERX_COMPUTE", "int8" if DEVICE == "cpu" else "float16")
HF_TOKEN = os.environ.get("HF_TOKEN", "")
MAX_SPEAKERS = int(os.environ.get("MAX_SPEAKERS", "5"))


def _load_models():
    global _whisperx_model, _align_model, _align_meta, _diarize_pipeline
    if _whisperx_model is not None:
        return

    import whisperx

    log.info(f"Loading WhisperX model={MODEL_ID} device={DEVICE} compute={COMPUTE}")
    _whisperx_model = whisperx.load_model(
        MODEL_ID,
        DEVICE,
        compute_type=COMPUTE,
        language=None,  # auto-detect
    )
    log.info("WhisperX model loaded.")

    if HF_TOKEN:
        log.info("Loading pyannote diarization pipeline…")
        _diarize_pipeline = whisperx.DiarizationPipeline(
            use_auth_token=HF_TOKEN,
            device=DEVICE,
        )
        log.info("Diarization pipeline loaded.")
    else:
        log.warning("HF_TOKEN not set — diarization disabled, speaker labels will be null.")


# ── Health check ─────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True, "model": MODEL_ID, "device": DEVICE})


# ── Main endpoint ─────────────────────────────────────────────────────────────

@app.route("/diarize", methods=["POST"])
def diarize():
    body = request.get_json(force=True, silent=True) or {}
    file_path = body.get("filePath") or body.get("file_path")
    language  = body.get("language") or None  # None → auto-detect

    if not file_path:
        return jsonify({"error": "filePath is required"}), 400

    if not os.path.isfile(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        import whisperx

        _load_models()

        # ── 1. Transcribe ─────────────────────────────────────────────────────
        log.info(f"Transcribing: {file_path}")
        audio = whisperx.load_audio(file_path)
        result = _whisperx_model.transcribe(audio, batch_size=4, language=language)
        detected_lang = result.get("language", "en")
        log.info(f"Transcription done. Language={detected_lang}, segments={len(result['segments'])}")

        # ── 2. Word-level alignment ──────────────────────────────────────────
        global _align_model, _align_meta
        if _align_model is None or (_align_meta and _align_meta.get("language") != detected_lang):
            log.info(f"Loading alignment model for language={detected_lang}")
            _align_model, _align_meta = whisperx.load_align_model(
                language_code=detected_lang,
                device=DEVICE,
            )
            _align_meta["language"] = detected_lang

        result = whisperx.align(
            result["segments"],
            _align_model,
            _align_meta,
            audio,
            DEVICE,
            return_char_alignments=False,
        )
        log.info("Alignment done.")

        # ── 3. Diarization (speaker labels) ──────────────────────────────────
        words_out = []
        speakers  = []

        if _diarize_pipeline is not None:
            diarize_segments = _diarize_pipeline(
                audio,
                min_speakers=1,
                max_speakers=MAX_SPEAKERS,
            )
            result = whisperx.assign_word_speakers(diarize_segments, result)

            seen_speakers = set()
            for seg in result["segments"]:
                for w in seg.get("words", []):
                    speaker = w.get("speaker") or seg.get("speaker") or None
                    words_out.append({
                        "word":    w.get("word", "").strip(),
                        "start":   round(w.get("start", 0), 3),
                        "end":     round(w.get("end",   0), 3),
                        "speaker": speaker,
                    })
                    if speaker:
                        seen_speakers.add(speaker)

            speakers = sorted(seen_speakers)
            log.info(f"Diarization done. {len(speakers)} speakers, {len(words_out)} words.")
        else:
            # No diarization — return words without speaker labels
            for seg in result["segments"]:
                for w in seg.get("words", []):
                    words_out.append({
                        "word":    w.get("word", "").strip(),
                        "start":   round(w.get("start", 0), 3),
                        "end":     round(w.get("end",   0), 3),
                        "speaker": None,
                    })
            log.info(f"No diarization (HF_TOKEN absent). {len(words_out)} words returned.")

        return jsonify({
            "words":    words_out,
            "speakers": speakers,
            "language": detected_lang,
        })

    except Exception as e:
        log.error(f"Diarization failed: {e}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    # Use threaded=False — model inference is not thread-safe without locks
    app.run(host="0.0.0.0", port=port, threaded=False)
