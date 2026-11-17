#!/usr/bin/env python3
"""
scripts/train_editorial_brain.py

Fine-tunes a domain-specialized 3B model (Qwen 2.5 3B Instruct) for Vibed's
Editorial Brain using Unsloth (fast QLoRA).

Exports directly to 4-bit quantized GGUF (editorial-brain-3b-q4_k_m.gguf)
ready to run on Railway CPU via llama.cpp.

Usage:
    # On a GPU instance (or free Google Colab T4):
    pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
    python scripts/train_editorial_brain.py
"""

import os
import sys

def main():
    print("🚀 Initializing Vibed Editorial Brain Training Pipeline...")

    try:
        from unsloth import FastLanguageModel
        import torch
        from datasets import load_dataset
        from trl import SFTTrainer
        from transformers import TrainingArguments
    except ImportError:
        print("""
⚠️ Missing dependencies. To run training on a GPU (e.g. Colab, RunPod, Lambda Labs):
    pip install --upgrade --no-cache-dir "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
    pip install --no-deps trl peft accelerate bitsandbytes
""")
        sys.exit(0)

    max_seq_length = 4096
    dtype = None # Auto detection (Float16 or Bfloat16)
    load_in_4bit = True

    # 1. Load Base Model: Qwen 2.5 3B Instruct
    # Qwen 2.5 is the highest performing 3B model for structured JSON,
    # timestamps, and editing logic.
    base_model_name = "unsloth/Qwen2.5-3B-Instruct"
    print(f"📦 Loading base model: {base_model_name}...")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = base_model_name,
        max_seq_length = max_seq_length,
        dtype = dtype,
        load_in_4bit = load_in_4bit,
    )

    # 2. Add LoRA Adapters
    print("⚙️ Configuring LoRA adapters...")
    model = FastLanguageModel.get_peft_model(
        model,
        r = 16, # Rank
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                          "gate_proj", "up_proj", "down_proj"],
        lora_alpha = 32,
        lora_dropout = 0, # Unsloth supports 0 for maximum speed
        bias = "none",
        use_gradient_checkpointing = "unsloth",
        random_state = 3407,
    )

    # 3. Format Dataset
    data_path = os.path.join(os.path.dirname(__file__), "../ML_Dataset/editorial_brain_train.jsonl")
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Dataset not found at {data_path}. Run `node scripts/generate_editorial_dataset.js` first.")

    print(f"📊 Loading dataset from {data_path}...")
    dataset = load_dataset("json", data_files=data_path, split="train")

    def format_chatml(examples):
        convos = examples["messages"]
        texts = [tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False) for convo in convos]
        return { "text": texts }

    dataset = dataset.map(format_chatml, batched = True)

    # 4. Training Arguments
    output_dir = os.path.join(os.path.dirname(__file__), "../ML_Models/editorial_brain_checkpoints")
    trainer = SFTTrainer(
        model = model,
        tokenizer = tokenizer,
        train_dataset = dataset,
        dataset_text_field = "text",
        max_seq_length = max_seq_length,
        dataset_num_proc = 2,
        packing = False,
        args = TrainingArguments(
            per_device_train_batch_size = 2,
            gradient_accumulation_steps = 4,
            warmup_steps = 25,
            max_steps = 300, # ~2-3 epochs on 2k examples
            learning_rate = 2e-4,
            fp16 = not torch.cuda.is_bf16_supported(),
            bf16 = torch.cuda.is_bf16_supported(),
            logging_steps = 10,
            optim = "adamw_8bit",
            weight_decay = 0.01,
            lr_scheduler_type = "cosine",
            seed = 3407,
            output_dir = output_dir,
            save_strategy = "no",
        ),
    )

    print("🏋️ Training Editorial Brain...")
    trainer.train()

    # 5. Export to GGUF Q4_K_M for Railway CPU execution
    export_dir = os.path.join(os.path.dirname(__file__), "../ML_Models/editorial_brain_gguf")
    os.makedirs(export_dir, exist_ok=True)
    print(f"💾 Exporting quantized GGUF (Q4_K_M) to {export_dir}...")

    # Native Unsloth GGUF export directly to 4-bit CPU format
    model.save_pretrained_gguf(export_dir, tokenizer, quantization_method = "q4_k_m")

    print("🎉 Editorial Brain successfully trained and exported for Railway CPU deployment!")

if __name__ == "__main__":
    main()
