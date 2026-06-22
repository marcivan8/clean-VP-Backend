"""
diarize-service/app.py
WhisperX transcription + pyannote speaker diarization microservice.

POST /diarize
Body (multipart): file=<wav>, language=<str>, min_speakers=<int>, max_speakers=<int>
Body (JSON):      { "filePath": "/abs/path", "language": "en", "min_speakers": 1, "max_speakers": 5 }

Returns: {
  "words": [{ "word": "anyway", "start": 4.2, "end": 4.6, "speaker": "SPEAKER_01" }],
  "speakers": ["SPEAKER_00", "SPEAKER_01"],
  "language": "en",
  "diarization_ran": true
}

Environment variables required:
  HF_TOKEN — HuggingFace access token for pyannote gated models.
             You must also ACCEPT the model terms at:
             https://huggingface.co/pyannote/speaker-diarization-3.1
             https://huggingface.co/pyannote/segmentation-3.0

Optional:
  WHISPERX_DEVICE    — "cpu" or "cuda" (default: cpu)
  WHISPERX_MODEL     — "tiny", "base", "small", "medium", "large-v2" (default: small)
                       NOTE: "base" has poor word alignment — use "small" minimum for
                       reliable speaker diarization. "medium" is recommended for accuracy.
  WHISPERX_COMPUTE   — "float32" or "int8" (default: int8 for cpu, float16 for cuda)
  MAX_SPEAKERS       — Maximum number of speakers to detect (default: 10)
  PORT               — Server port (default: 5001)
"""

import os
import sys
import logging
import tempfile
import traceback

from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="[diarize] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)

# ── Lazy model loading ────────────────────────────────────────────────────────
_whisperx_model   = None
_align_model      = None
_align_meta       = None
_diarize_pipeline = None
_models_attempted = False   # True once _load_models() has been called at least once
_models_error     = None    # Stores the last model-load error string, if any

DEVICE      = os.environ.get("WHISPERX_DEVICE",  "cpu")
# "small" is the minimum recommended for reliable word-level alignment.
# "base" produces imprecise timestamps that cause many words to fall between
# diarization segments and end up with speaker=None.
MODEL_ID    = os.environ.get("WHISPERX_MODEL",   "small")
COMPUTE     = os.environ.get("WHISPERX_COMPUTE", "int8" if DEVICE == "cpu" else "float16")
HF_TOKEN    = os.environ.get("HF_TOKEN", "").strip()
MAX_SPEAKERS = int(os.environ.get("MAX_SPEAKERS", "10"))


def _load_models():
    global _whisperx_model, _align_model, _align_meta, _diarize_pipeline
    global _models_attempted, _models_error

    if _models_attempted:
        return
    _models_attempted = True

    try:
        import whisperx

        log.info(f"Loading WhisperX model={MODEL_ID} device={DEVICE} compute={COMPUTE}")
        _whisperx_model = whisperx.load_model(
            MODEL_ID,
            DEVICE,
            compute_type=COMPUTE,
            language=None,  # auto-detect per request
        )
        log.info("WhisperX transcription model loaded.")

        if HF_TOKEN:
            log.info("Loading pyannote diarization pipeline…")
            log.info("  (requires accepted terms at huggingface.co/pyannote/speaker-diarization-3.1)")
            _diarize_pipeline = whisperx.DiarizationPipeline(
                use_auth_token=HF_TOKEN,
                device=DEVICE,
            )
            log.info("✅ Pyannote diarization pipeline loaded — speaker separation enabled.")
        else:
            log.warning(
                "⚠️  HF_TOKEN is not set — pyannote diarization pipeline will NOT load. "
                "Transcription will run without speaker labels. "
                "Set HF_TOKEN in Railway Variables and accept the pyannote model terms at "
                "https://huggingface.co/pyannote/speaker-diarization-3.1"
            )

    except Exception as e:
        _models_error = str(e)
        log.error(f"Model load failed: {e}\n{traceback.format_exc()}")
        raise


# ── Health check ─────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "ok":                True,
        "model":             MODEL_ID,
        "device":            DEVICE,
        "models_loaded":     _whisperx_model is not None,
        "diarization_ready": _diarize_pipeline is not None,
        "hf_token_set":      bool(HF_TOKEN),
        "models_error":      _models_error,
    })


# ── Main endpoint ─────────────────────────────────────────────────────────────

@app.route("/diarize", methods=["POST"])
def diarize():
    tmp_path  = None
    file_path = None

    if request.content_type and "multipart/form-data" in request.content_type:
        uploaded = request.files.get("file")
        if not uploaded:
            return jsonify({"error": "multipart request must include a 'file' field"}), 400
        language    = request.form.get("language") or None
        min_speakers = int(request.form.get("min_speakers") or 1)
        max_speakers = int(request.form.get("max_speakers") or MAX_SPEAKERS)
        fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        uploaded.save(tmp_path)
        file_path = tmp_path
        log.info(f"Received multipart upload → saved to {tmp_path}")
    else:
        body = request.get_json(force=True, silent=True) or {}
        file_path    = body.get("filePath") or body.get("file_path")
        language     = body.get("language") or None
        min_speakers = int(body.get("min_speakers") or 1)
        max_speakers = int(body.get("max_speakers") or MAX_SPEAKERS)
        if not file_path:
            return jsonify({"error": "filePath is required"}), 400
        if not os.path.isfile(file_path):
            return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        import whisperx

        _load_models()

        if _whisperx_model is None:
            return jsonify({"error": f"WhisperX model failed to load: {_models_error}"}), 500

        # ── 1. Transcribe ─────────────────────────────────────────────────────
        log.info(f"Transcribing: {file_path}  language={language or 'auto'}")
        audio = whisperx.load_audio(file_path)
        result = _whisperx_model.transcribe(audio, batch_size=4, language=language)
        detected_lang = result.get("language", "en")
        log.info(f"Transcription done. language={detected_lang} segments={len(result['segments'])}")

        # ── 2. Word-level alignment ──────────────────────────────────────────
        # Alignment is critical for diarization — imprecise word timestamps
        # cause words to fall between speaker segments and get speaker=None.
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
        log.info("Word-level alignment done.")

        # ── 3. Diarization (speaker labels) ──────────────────────────────────
        words_out      = []
        speakers       = []
        diarization_ran = False

        if _diarize_pipeline is not None:
            log.info(f"Running speaker diarization  min_speakers={min_speakers}  max_speakers={max_speakers}")
            diarize_segments = _diarize_pipeline(
                audio,
                min_speakers=min_speakers,
                max_speakers=max_speakers,
            )
            result = whisperx.assign_word_speakers(diarize_segments, result)
            diarization_ran = True

            seen_speakers = set()
            for seg in result["segments"]:
                for w in seg.get("words", []):
                    # Prefer word-level speaker; fall back to segment-level.
                    speaker = w.get("speaker") or seg.get("speaker") or None
                    words_out.append({
                        "word":    w.get("word", "").strip(),
                        "start":   round(w.get("start", 0), 3),
                        "end":     round(w.get("end",   0), 3),
                        "speaker": speaker,
                    })
                    if speaker:
                        seen_speakers.add(speaker)

            # ── Fill-forward / fill-backward propagation ──────────────────────
            # assign_word_speakers leaves words at speaker-change boundaries with
            # speaker=None when word timestamps don't overlap any diarization
            # segment. Propagate the nearest known speaker to fill these gaps.
            #
            # Forward pass: inherit from the previous word's speaker.
            last_speaker = None
            for w in words_out:
                if w["speaker"] is not None:
                    last_speaker = w["speaker"]
                elif last_speaker is not None:
                    w["speaker"] = last_speaker
                    seen_speakers.add(last_speaker)

            # Backward pass: fill any remaining Nones at the very start
            # (before the first labelled word) using the first known speaker.
            first_speaker = next((w["speaker"] for w in words_out if w["speaker"]), None)
            if first_speaker:
                for w in words_out:
                    if w["speaker"] is None:
                        w["speaker"] = first_speaker
                        seen_speakers.add(first_speaker)
                    else:
                        break   # reached the first labelled word

            speakers = sorted(seen_speakers)
            null_count = sum(1 for w in words_out if w["speaker"] is None)
            log.info(
                f"✅ Diarization done. {len(speakers)} speaker(s): {speakers}  "
                f"{len(words_out)} words  {null_count} still null after propagation."
            )
        else:
            # No diarization — HF_TOKEN absent or pipeline failed to load.
            log.warning(
                "⚠️  Diarization pipeline not available — returning words without speaker labels. "
                f"hf_token_set={bool(HF_TOKEN)}"
            )
            for seg in result["segments"]:
                for w in seg.get("words", []):
                    words_out.append({
                        "word":    w.get("word", "").strip(),
                        "start":   round(w.get("start", 0), 3),
                        "end":     round(w.get("end",   0), 3),
                        "speaker": None,
                    })
            log.info(f"Transcription only (no diarization). {len(words_out)} words returned.")

        return jsonify({
            "words":           words_out,
            "speakers":        speakers,
            "language":        detected_lang,
            "diarization_ran": diarization_ran,
        })

    except Exception as e:
        log.error(f"Diarization failed: {e}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, threaded=False)
