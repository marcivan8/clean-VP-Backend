"""
diarize-service/app.py
WhisperX transcription + pyannote speaker diarization microservice.
Also hosts the semantic clip-analysis endpoint used by the organize-clips pipeline.

POST /diarize
Body: { "filePath": "/abs/path/to/audio.wav", "language": "en" }  (language optional)
Returns: {
  "words": [{ "word": "anyway", "start": 4.2, "end": 4.6, "speaker": "SPEAKER_01" }],
  "speakers": ["SPEAKER_00", "SPEAKER_01"],
  "language": "en"
}

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
Returns: {
  "clips": [
    {
      "id": "clip1",
      "clip_type": "talking_head_medium",
      "clip_type_confidence": 0.87,
      "has_face": true,
      "face_count": 1,
      "face_size": "medium",
      "energy": "medium",
      "topic_cluster": 0,
      "top_types": { "talking_head_medium": 0.87, "talking_head_close": 0.08 }
    }
  ],
  "num_topic_clusters": 2
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

_whisperx_model   = None
_align_model      = None
_align_meta       = None
_diarize_pipeline = None

DEVICE       = os.environ.get("WHISPERX_DEVICE",  "cpu")
MODEL_ID     = os.environ.get("WHISPERX_MODEL",   "base")
COMPUTE      = os.environ.get("WHISPERX_COMPUTE", "int8" if DEVICE == "cpu" else "float16")
HF_TOKEN     = os.environ.get("HF_TOKEN", "")
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


# ── CLIP + MediaPipe + sentence-transformers (lazy) ───────────────────────────
# These models are independent of WhisperX and are only loaded when the
# /classify-clips endpoint is first called.  Cold-start adds ~30 s on CPU.

_clip_model      = None
_clip_processor  = None
_st_model        = None   # sentence-transformers
_mp_face_det     = None   # MediaPipe FaceDetection

CLIP_MODEL_ID = "openai/clip-vit-base-patch32"
ST_MODEL_ID   = "all-MiniLM-L6-v2"

# CLIP text labels — order must match LABEL_TYPES below.
# Rich, specific descriptions outperform short category words for CLIP.
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

# Map clip_type → default energy level (overridden by face-size signal)
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
    """Load CLIP + sentence-transformers on first /classify-clips call."""
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


# ── /classify-clips endpoint ──────────────────────────────────────────────────

@app.route("/classify-clips", methods=["POST"])
def classify_clips():
    """
    Receives base64-encoded JPEG frames + optional transcript per clip.
    Runs CLIP (visual classification), MediaPipe (face detection), and
    sentence-transformers (semantic transcript clustering) on the batch.
    Returns rich per-clip metadata used by Node to build a GPT-4o-mini
    text prompt for final narrative ordering.
    """
    import base64
    import numpy as np
    from io import BytesIO
    from PIL import Image
    import torch

    body  = request.get_json(force=True, silent=True) or {}
    clips = body.get("clips", [])

    if not clips:
        return jsonify({"error": "No clips provided"}), 400

    # ── Load models (first call only) ──────────────────────────────────────────
    try:
        _load_clip_models()
    except Exception as e:
        log.error(f"/classify-clips model load failed: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"Model loading failed: {e}"}), 500

    results         = []
    embed_texts     = []   # one string per clip for sentence-transformers

    for clip in clips:
        clip_id    = clip.get("id", "unknown")
        frames_b64 = clip.get("frames", [])
        transcript = (clip.get("transcript") or "").strip()
        duration   = float(clip.get("duration") or 0)

        # ── Decode frames ─────────────────────────────────────────────────────
        pil_images = []
        for fb64 in frames_b64:
            try:
                raw = base64.b64decode(fb64)
                img = Image.open(BytesIO(raw)).convert("RGB")
                pil_images.append(img)
            except Exception:
                pass   # skip corrupt frames silently

        # ── CLIP zero-shot visual classification ──────────────────────────────
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
                    # logits_per_image: [num_images, num_labels]
                    # Average softmax across all frames → one distribution per clip
                    probs = outputs.logits_per_image.softmax(dim=1).mean(dim=0)

                best_idx             = int(probs.argmax())
                clip_type            = LABEL_TYPES[best_idx]
                clip_type_confidence = float(probs[best_idx])
                # Return top-3 labels for transparency
                top3_idx = probs.topk(min(3, len(LABEL_TYPES))).indices.tolist()
                top_types = {LABEL_TYPES[i]: round(float(probs[i]), 4) for i in top3_idx}
            except Exception as e:
                log.warning(f"CLIP failed for clip {clip_id}: {e}")

        # ── MediaPipe face detection ──────────────────────────────────────────
        has_face  = False
        face_count = 0
        face_size  = "none"   # none | small | medium | large

        if pil_images:
            try:
                import mediapipe as mp
                mp_face = mp.solutions.face_detection

                # Use the middle frame as the reference for face analysis
                ref_img = pil_images[len(pil_images) // 2]
                img_np  = np.array(ref_img)

                with mp_face.FaceDetection(
                    model_selection=1,          # 1 = full-range (up to 5 m)
                    min_detection_confidence=0.4,
                ) as face_det:
                    mp_result = face_det.process(img_np)

                if mp_result.detections:
                    has_face   = True
                    face_count = len(mp_result.detections)
                    # Use the largest detected face for shot-size estimation
                    largest = max(
                        mp_result.detections,
                        key=lambda d: (
                            d.location_data.relative_bounding_box.width *
                            d.location_data.relative_bounding_box.height
                        ),
                    )
                    bbox      = largest.location_data.relative_bounding_box
                    face_area = bbox.width * bbox.height  # 0.0 – 1.0
                    # Thresholds calibrated on typical camera distances:
                    #   > 0.12  → close-up (face fills frame)
                    #   0.04–0.12 → medium shot
                    #   < 0.04  → wide shot / small face in background
                    if face_area > 0.12:
                        face_size = "large"
                    elif face_area > 0.04:
                        face_size = "medium"
                    else:
                        face_size = "small"
            except Exception as e:
                log.warning(f"MediaPipe failed for clip {clip_id}: {e}")

        # ── Refine clip_type with face-detection signal ───────────────────────
        # CLIP sometimes confuses wide talking-head with establishing shot;
        # MediaPipe ground-truth overrides when a face is clearly detected.
        if has_face and clip_type in ("establishing_shot", "broll_outdoor", "broll_indoor"):
            if face_size == "large":
                clip_type = "talking_head_close"
            elif face_size == "medium":
                clip_type = "talking_head_medium"
            else:
                clip_type = "talking_head_wide"

        # ── Energy heuristic ──────────────────────────────────────────────────
        energy = _TYPE_ENERGY.get(clip_type, "neutral")
        # Promote energy when face is very close (engaged / emphatic delivery)
        if face_size == "large" and energy not in ("high",):
            energy = "high"
        # Short clips with a face are usually key moments
        if duration < 4.0 and has_face:
            energy = "high"

        # ── Prepare text for semantic embedding ───────────────────────────────
        # Combine transcript + inferred visual context for richer embedding.
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
            "topic_cluster":        0,   # filled below
        })

    # ── Semantic transcript clustering (sentence-transformers) ─────────────────
    # Embeds the combined visual+transcript text for each clip, then performs
    # greedy cosine-similarity clustering so GPT can reason about topic groups.
    topic_clusters = [0] * len(results)

    if _st_model is not None and len(results) >= 2:
        try:
            from sklearn.metrics.pairwise import cosine_similarity as cos_sim

            embeddings  = _st_model.encode(embed_texts, show_progress_bar=False)
            sim_matrix  = cos_sim(embeddings)

            # Greedy threshold clustering: similarity > 0.55 → same topic group
            THRESHOLD   = 0.55
            cluster_id  = 0
            assigned    = {}

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

    # Inject clusters
    for i, r in enumerate(results):
        r["topic_cluster"] = topic_clusters[i]

    num_clusters = len(set(topic_clusters))
    log.info(
        f"[classify-clips] {len(results)} clips processed | "
        f"{sum(1 for r in results if r['has_face'])} with face | "
        f"{num_clusters} topic cluster(s)"
    )

    return jsonify({"clips": results, "num_topic_clusters": num_clusters})


# ── Health check ─────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True, "model": MODEL_ID, "device": DEVICE})


# ── Main endpoint ─────────────────────────────────────────────────────────────

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

    temp_path = None   # set when we receive an upload so we can clean up

    content_type = request.content_type or ""
    if "multipart/form-data" in content_type:
        # ── Streaming upload ──────────────────────────────────────────────────
        if "audio" not in request.files:
            return jsonify({"error": "multipart request must include an 'audio' field"}), 400

        upload  = request.files["audio"]
        language = request.form.get("language") or None

        suffix  = os.path.splitext(upload.filename or "audio.wav")[1] or ".wav"
        fd, temp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        upload.save(temp_path)
        file_path = temp_path
        log.info(f"Received uploaded file → {temp_path} ({os.path.getsize(temp_path)} bytes)")

    else:
        # ── JSON body with local path (local dev / same-machine deployment) ──
        body      = request.get_json(force=True, silent=True) or {}
        file_path = body.get("filePath") or body.get("file_path")
        language  = body.get("language") or None

        if not file_path:
            return jsonify({"error": "Provide 'filePath' in JSON or upload via multipart 'audio' field"}), 400
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

    finally:
        # Remove the temp file we created from the upload (not the caller's file)
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    # Use threaded=False — model inference is not thread-safe without locks
    app.run(host="0.0.0.0", port=port, threaded=False)
