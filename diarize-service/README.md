# Diarize Service

This service provides audio transcription, speaker diarization, scene classification, and face detection capabilities for the Vibed application. It runs as a separate Python microservice.

## API Contract

The service exposes the following HTTP endpoints.

### `GET /status`
Returns the model loading state — useful for diagnosing issues.

**Response:**
```json
{
  "whisperx": {
    "loaded": true,
    "model": "medium",
    "device": "cuda",
    "error": null
  },
  "diarization": {
    "enabled": true,
    "hf_token": true,
    "error": null
  },
  "models_loading": false,
  "models_loaded": true
}
```

### `GET /health`
Returns a basic health check and model status.

**Response:**
```json
{
  "ok": true,
  "model": "medium",
  "device": "cuda",
  "diarization": true
}
```

### `POST /classify-clips`
Uses CLIP and MediaPipe to classify the visual content (e.g., talking head, b-roll) and compute a topic cluster based on the transcript and visual context.

**Request Body (JSON):**
```json
{
  "clips": [
    {
      "id": "clip-123",
      "frames": ["<base64-jpeg>", "..."],
      "transcript": "Hello world",
      "duration": 5.5
    }
  ]
}
```

**Response:**
```json
{
  "clips": [
    {
      "id": "clip-123",
      "clip_type": "talking_head_medium",
      "clip_type_confidence": 0.85,
      "has_face": true,
      "face_count": 1,
      "face_size": "medium",
      "energy": "medium",
      "duration": 5.5,
      "top_types": {
        "talking_head_medium": 0.85,
        "tutorial_demo": 0.05,
        "presentation": 0.02
      },
      "topic_cluster": 0
    }
  ],
  "num_topic_clusters": 1
}
```

### `POST /detect-faces`
Determines where each speaker sits in the frame to enable correct crop regions for virtual multicam.

**Request Body (JSON):**
```json
{
  "frames": ["<base64-jpeg>", "..."]
}
```

**Response:**
```json
{
  "faces": [
    {
      "cx": 0.28,
      "cy": 0.42,
      "w": 0.18,
      "h": 0.24,
      "side": "left"
    }
  ],
  "frame_used": 0
}
```

### `POST /diarize`
Transcribes audio and assigns words to speakers using WhisperX and pyannote.

**Request format (Option 1: Production)**
- `Content-Type`: `multipart/form-data`
- `audio`: The audio/video file (required)
- `language`: ISO-639-1 language code (optional)

**Request format (Option 2: Local Development)**
- `Content-Type`: `application/json`
- `filePath`: Absolute path to the audio file on the shared filesystem (required)
- `language`: ISO-639-1 language code (optional)

**Response:**
```json
{
  "words": [
    {
      "word": "Hello",
      "start": 0.5,
      "end": 1.2,
      "speaker": "SPEAKER_00"
    }
  ],
  "speakers": ["SPEAKER_00"],
  "language": "en",
  "diarization_enabled": true,
  "diarization_error": null
}
```

## Integration with Node.js Backend

The Node.js backend communicates with this service via standard HTTP requests.
- Ensure the `DIARIZE_SERVICE_URL` environment variable on the Node backend points to this service.
- The Node backend typically uses `multipart/form-data` to send audio files directly to the `/diarize` endpoint, unless running locally with a shared volume where `filePath` is used instead.
