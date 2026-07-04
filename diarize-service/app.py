"""
diarize-service/app.py
WhisperX transcription + pyannote speaker diarization microservice.
Also hosts the semantic clip-analysis endpoint used by the organize-clips pipeline.

POST /diarize
Body: multipart/form-data with field "audio" (file) and optional "language"
      OR application/json: { "filePath": "/abs/path/to/audio.wav", "language": "en" }
Returns: {
  "words": [{ "word": "anyway", "start": 4.2, "end": 4.6, "speaker": "SPEAKER_01" }],
  "speakers": ["SPEAKER_00", "SPEAKER_01"],
  "language": "en",
  "diarization_enabled": true
}

GET /status
Returns model loading status — useful for diagnosing HF_TOKEN / pyannote issues.

POST /classify-clips
Body: {
  "clips": [
    {
      "id": "clip1",
      "frames": ["<base64-jpeg>", "<base64-jpeg>", "<base64-jpeg>"],
      "transcript": "Hello everyone, welcome...",
      "duration": 45.2
    }
  ]
}

Environment variables required:
  HF_TOKEN — HuggingFace access token (for pyannote gated model).
             The account that created this token MUST have accepted the terms at:
               https://huggingface.co/pyannote/segmentation-3.0
               https://huggingface.co/pyannote/speaker-diarization-3.1

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
import threading

from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="[diarize] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

DEVICE       = os.environ.get("WHISPERX_DEVICE",  "cpu")
MODEL_ID     = os.environ.get("WHISPERX_MODEL",   "base")
COMPUTE      = os.environ.get("WHISPERX_COMPUTE", "int8" if DEVICE == "cpu" else "float16")
HF_TOKEN     = os.environ.get("HF_TOKEN", "").strip()
MAX_SPEAKERS = int(os.environ.get("MAX_SPEAKERS", "5"))

# ── Model state ───────────────────────────────────────────────────────────────

_whisperx_model   = None
_align_model      = None
_align_meta       = None
_diarize_pipeline = None
_models_loading   = False
_models_loaded    = False
_whisperx_error   = None   # set if WhisperX failed to load
_diarize_error    = None   # set if pyannote failed to load (non-fatal)

_load_lock = threading.Lock()


def _load_models():
    """
    Load WhisperX and (optionally) the pyannote diarization pipeline.

    pyannote failures are NON-FATAL — the service continues in
    transcription-only mode and returns words without speaker labels.
    This handles gated model errors, missing HF_TOKEN, network issues, etc.
    """
    global _whisperx_model, _diarize_pipeline
    global _models_loading, _models_loaded
    global _whisperx_error, _diarize_error

    with _load_lock:
        if _models_loaded:
            return
        _models_loading = True

    # ── 1. WhisperX (required) ────────────────────────────────────────────────
    try:
        import whisperx
        log.info(f"Loading WhisperX model={MODEL_ID} device={DEVICE} compute={COMPUTE}")
        _whisperx_model = whisperx.load_model(
            MODEL_ID, DEVICE, compute_type=COMPUTE, language=None,
        )
        log.info("✅ WhisperX model loaded.")
    except Exception as e:
        _whisperx_error = str(e)
        log.error(f"❌ WhisperX failed to load: {e}\n{traceback.format_exc()}")
        _models_loading = False
        return  # can't do anything without WhisperX

    # ── 2. pyannote diarization pipeline (optional) ───────────────────────────
    if not HF_TOKEN:
        _diarize_error = "HF_TOKEN env var not set — speaker diarization disabled."
        log.warning(f"⚠️  {_diarize_error}")
        log.warning("    Set HF_TOKEN and redeploy to enable speaker labels.")
    else:
        try:
            import whisperx
            log.info("Loading pyannote/speaker-diarization-3.1 …")
            _diarize_pipeline = whisperx.DiarizationPipeline(
                use_auth_token=HF_TOKEN,
                device=DEVICE,
            )
            log.info("✅ pyannote diarization pipeline loaded.")
        except Exception as e:
            _diarize_error = str(e)
            _diarize_pipeline = None

            # Produce a helpful diagnostic based on the error type
            err_lower = str(e).lower()
            if "gated" in err_lower or "403" in err_lower or "access" in err_lower:
                log.error(
                    "❌ pyannote: model is gated — you must accept the HuggingFace terms.\n"
                    "   1. Log into https://huggingface.co with the account that owns HF_TOKEN\n"
                    "   2. Accept terms at https://huggingface.co/pyannote/segmentation-3.0\n"
                    "   3. Accept terms at https://huggingface.co/pyannote/speaker-diarization-3.1\n"
                    "   4. Redeploy this service so it re-downloads the models.\n"
                    "   → Running in transcription-only mode (no speaker labels)."
                )
            elif "401" in err_lower or "unauthorized" in err_lower or "invalid" in err_lower:
                log.error(
                    "❌ pyannote: HF_TOKEN is invalid or expired.\n"
                    "   Generate a new token at https://huggingface.co/settings/tokens\n"
                    "   and update the HF_TOKEN Railway environment variable.\n"
                    "   → Running in transcription-only mode (no speaker labels)."
                )
            else:
                log.error(
                    f"❌ pyannote failed to load: {e}\n{traceback.format_exc()}\n"
                    "   → Running in transcription-only mode (no speaker labels)."
                )

    _models_loaded = True
    _models_loading = False


# ── Eager model load on startup (background thread) ───────────────────────────
# Start loading immediately so the first /diarize request doesn't have to wait.
# The health check passes instantly; we just log warnings if models fail.

def _startup_load():
    try:
        _load_models()
    except Exception as e:
        log.error(f"Startup model load error: {e}")

threading.Thread(target=_startup_load, daemon=True).start()


# ── CLIP + MediaPipe + sentence-transformers (lazy) ───────────────────────────

_clip_model      = None
_clip_processor  = None
_st_model        = None
_mp_face_det     = None

CLIP_MODEL_ID = "openai/clip-vit-base-patch32"
ST_MODEL_ID   = "all-MiniLM-L6-v2"

CLIP_LABELS = [
    "a person talking directly to camera in close-up, face fills most of the frame",
    "a person talking to camera in medium shot, upper body and shoulders visible",
    "a person talking to camera in wide shot, full body or room visible behind them",
    "a selfie-style video, person holding camera at arm length in front of themselves",
    "two or more people having a conversation, interview or podcast format",
    "outdoor scenery, landscape, city street, or nature — no one speaking to camera",
    "indoor scene without people, empty room, or object on a surface",
    "a person demonstrating or teaching something hands-on, tutorial style",
    "a product or item being shown and reviewed in front of the camera",
    "a screen recording showing a computer application or website",
    "a person expressing strong emotion: laughing, excited, surprised, or emphasizing a point",
    "an establishing shot of a building, location, or environment for context",
    "a person presenting in front of slides, whiteboard, or visual aids",
]

LABEL_TYPES = [
    "talking_head_close",
    "talking_head_medium",
    "talking_head_wide",
    "selfie_vlog",
    "multi_person",
    "broll_outdoor",
    "broll_indoor",
    "tutorial_demo",
    "product_shot",
    "screen_recording",
    "emotional_moment",
    "establishing_shot",
    "presentation",
]

_TYPE_ENERGY = {
    "talking_head_close":  "high",
    "emotional_moment":    "high",
    "talking_head_medium": "medium",
    "selfie_vlog":         "medium",
    "tutorial_demo":       "medium",
    "multi_person":        "medium",
    "presentation":        "medium",
    "talking_head_wide":   "low",
    "product_shot":        "low",
    "broll_outdoor":       "neutral",
    "broll_indoor":        "neutral",
    "establishing_shot":   "neutral",
    "screen_recording":    "neutral",
}


def _load_clip_models():
    global _clip_model, _clip_processor, _st_model
    import torch
    from transformers import CLIPModel, CLIPProcessor
    from sentence_transformers import SentenceTransformer

    if _clip_model is None:
        log.info(f"Loading CLIP model: {CLIP_MODEL_ID}")
        _clip_processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
        _clip_model     = CLIPModel.from_pretrained(CLIP_MODEL_ID)
        _clip_model.eval()
        log.info("CLIP model loaded.")

    if _st_model is None:
        log.info(f"Loading sentence-transformer: {ST_MODEL_ID}")
        _st_model = SentenceTransformer(ST_MODEL_ID)
        log.info("Sentence-transformer loaded.")


# ── /status ───────────────────────────────────────────────────────────────────

@app.route("/status")
def status():
    """Returns the model loading state — useful for diagnosing issues."""
    return jsonify({
        "whisperx": {
            "loaded": _whisperx_model is not None,
            "model":  MODEL_ID,
            "device": DEVICE,
            "error":  _whisperx_error,
        },
        "diarization": {
            "enabled":    _diarize_pipeline is not None,
            "hf_token":   bool(HF_TOKEN),
            "error":      _diarize_error,
        },
        "models_loading": _models_loading,
        "models_loaded":  _models_loaded,
    })


# ── /health ───────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "ok":     True,
        "model":  MODEL_ID,
        "device": DEVICE,
        "diarization": _diarize_pipeline is not None,
    })


# ── /classify-clips ───────────────────────────────────────────────────────────

@app.route("/classify-clips", methods=["POST"])
def classify_clips():
    import base64
    import numpy as np
    from io import BytesIO
    from PIL import Image
    import torch

    body  = request.get_json(force=True, silent=True) or {}
    clips = body.get("clips", [])

    if not clips:
        return jsonify({"error": "No clips provided"}), 400

    try:
        _load_clip_models()
    except Exception as e:
        log.error(f"/classify-clips model load failed: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"Model loading failed: {e}"}), 500

    results     = []
    embed_texts = []

    for clip in clips:
        clip_id    = clip.get("id", "unknown")
        frames_b64 = clip.get("frames", [])
        transcript = (clip.get("transcript") or "").strip()
        duration   = float(clip.get("duration") or 0)

        pil_images = []
        for fb64 in frames_b64:
            try:
                raw = base64.b64decode(fb64)
                img = Image.open(BytesIO(raw)).convert("RGB")
                pil_images.append(img)
            except Exception:
                pass

        clip_type            = "unknown"
        clip_type_confidence = 0.0
        top_types            = {}

        if pil_images and _clip_model is not None:
            try:
                inputs = _clip_processor(
                    text=CLIP_LABELS,
                    images=pil_images,
                    return_tensors="pt",
                    padding=True,
                    truncation=True,
                )
                with torch.no_grad():
                    outputs = _clip_model(**inputs)
                    probs = outputs.logits_per_image.softmax(dim=1).mean(dim=0)

                best_idx             = int(probs.argmax())
                clip_type            = LABEL_TYPES[best_idx]
                clip_type_confidence = float(probs[best_idx])
                top3_idx = probs.topk(min(3, len(LABEL_TYPES))).indices.tolist()
                top_types = {LABEL_TYPES[i]: round(float(probs[i]), 4) for i in top3_idx}
            except Exception as e:
                log.warning(f"CLIP failed for clip {clip_id}: {e}")

        has_face  = False
        face_count = 0
        face_size  = "none"

        if pil_images:
            try:
                import mediapipe as mp
                mp_face = mp.solutions.face_detection

                ref_img = pil_images[len(pil_images) // 2]
                img_np  = np.array(ref_img)

                with mp_face.FaceDetection(model_selection=1, min_detection_confidence=0.4) as face_det:
                    mp_result = face_det.process(img_np)

                if mp_result.detections:
                    has_face   = True
                    face_count = len(mp_result.detections)
                    largest = max(
                        mp_result.detections,
                        key=lambda d: (
                            d.location_data.relative_bounding_box.width *
                            d.location_data.relative_bounding_box.height
                        ),
                    )
                    bbox      = largest.location_data.relative_bounding_box
                    face_area = bbox.width * bbox.height
                    if face_area > 0.12:
                        face_size = "large"
                    elif face_area > 0.04:
                        face_size = "medium"
                    else:
                        face_size = "small"
            except Exception as e:
                log.warning(f"MediaPipe failed for clip {clip_id}: {e}")

        if has_face and clip_type in ("establishing_shot", "broll_outdoor", "broll_indoor"):
            if face_size == "large":
                clip_type = "talking_head_close"
            elif face_size == "medium":
                clip_type = "talking_head_medium"
            else:
                clip_type = "talking_head_wide"

        energy = _TYPE_ENERGY.get(clip_type, "neutral")
        if face_size == "large" and energy not in ("high",):
            energy = "high"
        if duration < 4.0 and has_face:
            energy = "high"

        visual_ctx = f"[{clip_type.replace('_', ' ')}]"
        embed_text = f"{visual_ctx} {transcript}".strip() if transcript else visual_ctx
        embed_texts.append(embed_text)

        results.append({
            "id":                   clip_id,
            "clip_type":            clip_type,
            "clip_type_confidence": round(clip_type_confidence, 4),
            "has_face":             has_face,
            "face_count":           face_count,
            "face_size":            face_size,
            "energy":               energy,
            "duration":             duration,
            "top_types":            top_types,
            "topic_cluster":        0,
        })

    topic_clusters = [0] * len(results)

    if _st_model is not None and len(results) >= 2:
        try:
            from sklearn.metrics.pairwise import cosine_similarity as cos_sim

            embeddings  = _st_model.encode(embed_texts, show_progress_bar=False)
            sim_matrix  = cos_sim(embeddings)

            THRESHOLD  = 0.55
            cluster_id = 0
            assigned   = {}

            for i in range(len(results)):
                if i in assigned:
                    continue
                assigned[i] = cluster_id
                for j in range(i + 1, len(results)):
                    if j not in assigned and sim_matrix[i][j] >= THRESHOLD:
                        assigned[j] = cluster_id
                cluster_id += 1

            topic_clusters = [assigned.get(i, 0) for i in range(len(results))]
        except Exception as e:
            log.warning(f"Semantic clustering failed: {e}")

    for i, r in enumerate(results):
        r["topic_cluster"] = topic_clusters[i]

    num_clusters = len(set(topic_clusters))
    log.info(
        f"[classify-clips] {len(results)} clips | "
        f"{sum(1 for r in results if r['has_face'])} with face | "
        f"{num_clusters} topic cluster(s)"
    )

    return jsonify({"clips": results, "num_topic_clusters": num_clusters})


# ── /detect-faces ─────────────────────────────────────────────────────────────
# Used by the virtual-multicam pipeline to determine where each speaker sits in
# the frame (left half vs right half), enabling correct crop regions.
#
# POST /detect-faces
# Body (JSON): {
#   "frames": ["<base64-jpeg>", ...]   — 1–5 frames from the video
# }
# Returns: {
#   "faces": [
#     {
#       "cx": 0.28,           — horizontal center of face in [0,1] (0=left, 1=right)
#       "cy": 0.42,           — vertical center
#       "w":  0.18,           — width of bounding box [0,1]
#       "h":  0.24,           — height
#       "side": "left"|"right"  — which half of the frame this face is in
#     }
#   ],
#   "frame_used": 0           — which frame index was used (middle of input list)
# }
#
# If MediaPipe or the frame decode fails, returns {"faces": [], "frame_used": null}.
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/detect-faces", methods=["POST"])
def detect_faces():
    import base64
    import numpy as np
    from io import BytesIO
    from PIL import Image

    data   = request.get_json(force=True, silent=True) or {}
    frames = data.get("frames") or []

    if not frames:
        return jsonify({"faces": [], "frame_used": None})

    # Use the middle frame for the best representative pose
    frame_idx  = len(frames) // 2
    frame_b64  = frames[frame_idx]
    pil_image  = None

    try:
        img_bytes = base64.b64decode(frame_b64)
        pil_image = Image.open(BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        log.warning(f"[detect-faces] Frame decode failed: {e}")
        return jsonify({"faces": [], "frame_used": None})

    faces = []
    try:
        import mediapipe as mp
        mp_face = mp.solutions.face_detection

        img_np = np.array(pil_image)
        with mp_face.FaceDetection(model_selection=1, min_detection_confidence=0.35) as face_det:
            mp_result = face_det.process(img_np)

        if mp_result.detections:
            for det in mp_result.detections:
                bbox = det.location_data.relative_bounding_box
                # Clamp to [0,1] — MediaPipe can return slightly out-of-bounds values
                x = max(0.0, float(bbox.xmin))
                y = max(0.0, float(bbox.ymin))
                w = min(float(bbox.width),  1.0 - x)
                h = min(float(bbox.height), 1.0 - y)
                cx = x + w / 2.0
                cy = y + h / 2.0
                faces.append({
                    "cx":   round(cx, 4),
                    "cy":   round(cy, 4),
                    "w":    round(w,  4),
                    "h":    round(h,  4),
                    "side": "left" if cx < 0.5 else "right",
                })
    except Exception as e:
        log.warning(f"[detect-faces] MediaPipe failed: {e}")
        return jsonify({"faces": [], "frame_used": None})

    log.info(f"[detect-faces] Found {len(faces)} face(s) in frame {frame_idx}")
    return jsonify({"faces": faces, "frame_used": frame_idx})


# ── /diarize ──────────────────────────────────────────────────────────────────

@app.route("/diarize", methods=["POST"])
def diarize():
    """
    Accepts two calling conventions:

    1. multipart/form-data (production — Node server streams the WAV bytes):
         field "audio"    — the audio/video file
         field "language" — (optional) ISO-639-1 code

    2. application/json (local dev — services share a filesystem):
         { "filePath": "/abs/path/to/audio.wav", "language": "en" }
    """
    import tempfile

    temp_path = None

    content_type = request.content_type or ""
    if "multipart/form-data" in content_type:
        if "audio" not in request.files:
            return jsonify({"error": "multipart request must include an 'audio' field"}), 400

        upload   = request.files["audio"]
        language = request.form.get("language") or None
        suffix   = os.path.splitext(upload.filename or "audio.wav")[1] or ".wav"
        fd, temp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        upload.save(temp_path)
        file_path = temp_path
        log.info(f"Received upload → {temp_path} ({os.path.getsize(temp_path)} bytes)")
    else:
        body      = request.get_json(force=True, silent=True) or {}
        file_path = body.get("filePath") or body.get("file_path")
        language  = body.get("language") or None

        if not file_path:
            return jsonify({"error": "Provide 'filePath' in JSON or upload via multipart 'audio' field"}), 400
        if not os.path.isfile(file_path):
            return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        import whisperx

        # Block until models are ready (they load in background on startup).
        # In practice the first request arrives well after startup on Railway.
        if not _models_loaded:
            _load_models()

        if _whisperx_model is None:
            return jsonify({
                "error": f"WhisperX failed to load: {_whisperx_error}",
                "code":  "WHISPERX_NOT_LOADED",
            }), 503

        # ── 1. Transcribe ─────────────────────────────────────────────────────
        log.info(f"Transcribing: {file_path}")
        audio  = whisperx.load_audio(file_path)
        result = _whisperx_model.transcribe(audio, batch_size=4, language=language)
        detected_lang = result.get("language", "en")
        log.info(f"Transcription done. lang={detected_lang}, segments={len(result['segments'])}")

        # ── 2. Word-level alignment ──────────────────────────────────────────
        global _align_model, _align_meta
        if _align_model is None or (_align_meta and _align_meta.get("language") != detected_lang):
            log.info(f"Loading alignment model for lang={detected_lang}")
            _align_model, _align_meta = whisperx.load_align_model(
                language_code=detected_lang, device=DEVICE,
            )
            _align_meta["language"] = detected_lang

        result = whisperx.align(
            result["segments"], _align_model, _align_meta, audio, DEVICE,
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
            # No diarization — return words without speaker labels.
            # The client can still use timestamps for silence removal etc.
            for seg in result["segments"]:
                for w in seg.get("words", []):
                    words_out.append({
                        "word":    w.get("word", "").strip(),
                        "start":   round(w.get("start", 0), 3),
                        "end":     round(w.get("end",   0), 3),
                        "speaker": None,
                    })
            log.info(f"Transcription-only (no diarization). {len(words_out)} words.")

        return jsonify({
            "words":                words_out,
            "speakers":             speakers,
            "language":             detected_lang,
            "diarization_enabled":  _diarize_pipeline is not None,
            # Surface the reason diarization is off so the client can inform the user
            "diarization_error":    _diarize_error if _diarize_pipeline is None else None,
        })

    except Exception as e:
        log.error(f"Diarization failed: {e}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, threaded=False)
