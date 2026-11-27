# Vibed Editorial Brain — Model Training & Railway Deployment

This directory contains artifacts and deployment configs for Vibed's specialized 3B Editorial Brain model running on Railway CPU.

## Architecture

- **Base Model**: Qwen 2.5 3B Instruct
- **Quantization**: 4-bit GGUF (`Q4_K_M`) — RAM footprint: **~1.9 GB**
- **Inference Server**: `llama.cpp` server (C++ multi-threaded CPU binary)
- **API Spec**: Standard OpenAI-compatible `/v1/chat/completions` endpoint
- **Grammar Enforcement**: Constrained JSON schema decoding (100% syntax compliance, zero 400 validation failures)

---

## 1. Dataset Generation

The dataset is synthetically generated from Vibed's real timeline schemas, story beats, and media assets:

```bash
node scripts/generate_editorial_dataset.js
```

Outputs:
- `ML_Dataset/editorial_brain_train.jsonl` (2,200+ samples)
- `ML_Dataset/editorial_brain_val.jsonl` (250+ samples)

---

## 2. Fine-Tuning (Free Google Colab / GPU)

To train in ~1.5 hours using Unsloth on a free GPU:

```bash
# Install Unsloth
pip install --upgrade --no-cache-dir "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft accelerate bitsandbytes

# Run training & automatic GGUF export
python scripts/train_editorial_brain.py
```

The script automatically produces `editorial_brain-unsloth.Q4_K_M.gguf`.

---

## 3. Deployment on Railway

Deploy as a new service in your existing Railway project using `editorial-brain/Dockerfile`.

- Set environment variables in your main Railway Express app:
  ```env
  AI_BRAIN_PROVIDER=custom
  BRAIN_AI_BASE_URL=http://editorial-brain.railway.internal:8080/v1
  BRAIN_AI_MODEL=editorial-brain-3b
  ```
- If the Railway CPU model ever takes longer than 15s or restarts, the backend **automatically fails over to Gemini/Groq** seamlessly.
