# editorial-brain/Dockerfile
#
# Dedicated Railway CPU Inference Service for Vibed Editorial Brain
# Runs llama.cpp server with CPU multi-threading (AVX2/AVX-512) and OpenAI-compatible API.

FROM ghcr.io/ggml-org/llama.cpp:server

# Set default configuration via LLAMA_ARG environment variables
ENV LLAMA_ARG_HOST="0.0.0.0"
ENV LLAMA_ARG_PORT="8080"
ENV LLAMA_ARG_CTX_SIZE="4096"
ENV LLAMA_ARG_THREADS="4"
ENV LLAMA_ARG_N_PREDICT="1200"
ENV LLAMA_ARG_CONT_BATCHING="true"

# Automatically downloads and serves Qwen 2.5 3B Instruct Q4_K_M (~1.9GB).
# Overridable with your own fine-tuned model via Railway env vars:
ENV LLAMA_ARG_HF_REPO="Qwen/Qwen2.5-3B-Instruct-GGUF"
ENV LLAMA_ARG_HF_FILE="qwen2.5-3b-instruct-q4_k_m.gguf"

# Expose standard Railway HTTP port
EXPOSE 8080

CMD ["--hf-repo", "Qwen/Qwen2.5-3B-Instruct-GGUF", "--hf-file", "qwen2.5-3b-instruct-q4_k_m.gguf"]
