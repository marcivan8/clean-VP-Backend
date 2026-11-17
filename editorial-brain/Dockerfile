# editorial-brain/Dockerfile
#
# Dedicated Railway CPU Inference Service for Vibed Editorial Brain
# Runs llama.cpp server with CPU multi-threading (AVX2/AVX-512) and OpenAI-compatible API.

FROM ghcr.io/ggerganov/llama.cpp:server

# Set working directory and model cache
WORKDIR /app
ENV MODEL_DIR=/app/models
ENV PORT=8080
ENV HOST=0.0.0.0
ENV THREADS=4
ENV CTX_SIZE=4096

# By default, downloads and serves Qwen 2.5 3B Instruct Q4_K_M (~1.9GB).
# Overridable with your own fine-tuned model via environment variables or volume mount.
ENV HF_REPO="Qwen/Qwen2.5-3B-Instruct-GGUF"
ENV HF_FILE="qwen2.5-3b-instruct-q4_k_m.gguf"

# Expose standard Railway port
EXPOSE 8080

# Run llama-server with continuous batching and OpenAI-compatible endpoint
ENTRYPOINT ["/llama-server"]
CMD [ \
    "--hf-repo", "Qwen/Qwen2.5-3B-Instruct-GGUF", \
    "--hf-file", "qwen2.5-3b-instruct-q4_k_m.gguf", \
    "--host", "0.0.0.0", \
    "--port", "8080", \
    "--ctx-size", "4096", \
    "--threads", "4", \
    "--n-predict", "1200", \
    "--cont-batching" \
]
