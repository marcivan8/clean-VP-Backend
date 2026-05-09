import json
import random
import os

# Define the structure of intents and operations
INTENTS = {
    "EDIT": [
        "split_clip", "remove_clip", "trim_clip", "ripple_delete",
        "set_clip_speed", "silence_removal", "remove_filler_words"
    ],
    "OPTIMIZE": ["platform_optimize"],
    "APPLY_EFFECT": [
        "auto_reframe", "duck_audio", "normalize_audio",
        "add_transition", "add_filter", "color_grade", "add_text",
        "punch_in", "inject_broll", "adjust_volume"
    ],
    "EXPORT": ["export_video", "nle_export"]
}

# Template prompts for specific operations
TEMPLATES = {
    "ripple_delete": [
        "Ripple delete the {target}.",
        "Delete {target} and close the gap.",
        "Remove the {target} and ripple cut.",
        "Shift delete {target}.",
        "Delete the {target} and collapse the timeline."
    ],
    "punch_in": [
        "Punch in on {target}.",
        "When she says '{word}', punch in real close.",
        "Zoom in on the speaker during the {target}.",
        "Scale this clip up to {scale}%.",
        "Emphasize the '{word}' part with a quick punch in."
    ],
    "duck_audio": [
        "Duck the audio under the {target}.",
        "Lower the background music.",
        "Auto duck the music track when someone speaks.",
        "Dip the audio on {target}.",
        "Drop the volume of the music under the voiceover."
    ],
    "normalize_audio": [
        "Normalize the audio to {lufs} LUFS.",
        "Standardize the volume across all clips.",
        "Make sure the audio levels are consistent.",
        "Level out the dialogue track.",
        "Normalize this clip."
    ],
    "inject_broll": [
        "Inject some broll of {topic} here.",
        "Cover this section with stock footage of {topic}.",
        "Add b-roll over the {target}.",
        "Insert stock video showing {topic}.",
        "Put some broll over the voiceover."
    ],
    "auto_reframe": [
        "Auto reframe for {platform}.",
        "Track the face and keep it in frame.",
        "Center the speaker.",
        "Keep the action in the middle for vertical video."
    ],
    "silence_removal": [
        "Cut out the dead air.",
        "Remove all pauses longer than {time} seconds.",
        "Clean up the silences.",
        "Tighten the pacing by removing gaps.",
        "Trim the silence from the audio."
    ],
    "platform_optimize": [
        "Make this ready for {platform}.",
        "Optimize this video for {platform}.",
        "Format this for {platform}.",
        "Convert to {ratio} aspect ratio for {platform}."
    ],
    "nle_export": [
        "Export this to {nle}.",
        "Send this project to {nle}.",
        "Export an XML for {nle}.",
        "Prepare an export for {nle} editing."
    ]
}

# Variables to inject into templates
VARS = {
    "target": ["intro", "outro", "second clip", "first clip", "voiceover track", "music track", "interview clip"],
    "word": ["boom", "crazy", "wow", "look", "important"],
    "scale": ["120", "150", "130"],
    "lufs": ["-14", "-16", "-23"],
    "topic": ["city skyline", "people working", "nature", "abstract background", "technology"],
    "platform": ["TikTok", "YouTube Shorts", "Instagram Reels", "Twitter"],
    "ratio": ["9:16", "1:1", "16:9"],
    "time": ["1", "0.5", "2", "1.5"],
    "nle": ["Premiere Pro", "DaVinci Resolve", "Final Cut Pro"]
}

SYSTEM_PROMPT = "You are a video editing intent parser. Convert natural language into structured JSON intents."

def fill_template(template):
    import re
    # Find all {var} in template
    vars_needed = re.findall(r'\{(.*?)\}', template)
    kwargs = {}
    for v in vars_needed:
        if v in VARS:
            kwargs[v] = random.choice(VARS[v])
        else:
            kwargs[v] = "unknown"
    return template.format(**kwargs), kwargs

def generate_json(operation, prompt, kwargs):
    # Determine intent type based on operation
    intent_type = "UNKNOWN"
    for k, v in INTENTS.items():
        if operation in v:
            intent_type = k
            break
            
    constraints = {}
    targets = []
    
    # Simple heuristic to build realistic constraints based on the prompt
    if operation == "ripple_delete":
        targets.append("target_clip")
    elif operation == "punch_in":
        if "word" in kwargs:
            constraints = {"trigger": "transcript_match", "text": kwargs["word"], "scale": 1.5 if "scale" not in kwargs else float(kwargs["scale"])/100.0}
        else:
            constraints = {"scale": 1.3}
    elif operation == "duck_audio":
        constraints = {"duckAmount": "-12dB"}
    elif operation == "normalize_audio":
        constraints = {"targetLUFS": kwargs.get("lufs", "-14")}
    elif operation == "inject_broll":
        constraints = {"query": kwargs.get("topic", "generic broll")}
    elif operation == "silence_removal":
        constraints = {"threshold": "-30dB", "minDuration": float(kwargs.get("time", "0.5"))}
    elif operation == "platform_optimize":
        constraints = {"platform": kwargs.get("platform", "tiktok").lower().replace(" ", "_")}
        if "ratio" in kwargs:
            constraints["ratio"] = kwargs["ratio"]
    elif operation == "nle_export":
        constraints = {"nleTarget": kwargs.get("nle", "premiere").lower().replace(" ", "_")}
        
    return {
        "intent": intent_type,
        "operation": operation,
        "targets": targets,
        "constraints": constraints,
        "needs_clarification": False,
        "confidence": "HIGH",
        "missingParameters": []
    }

def main():
    output_data = []
    num_samples_per_template = 10
    
    for operation, templates in TEMPLATES.items():
        for template in templates:
            for _ in range(num_samples_per_template):
                prompt, kwargs = fill_template(template)
                expected_json = generate_json(operation, prompt, kwargs)
                
                # Format as OpenAI Chat Completion fine-tuning JSONL
                message_row = {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": json.dumps(expected_json)}
                    ]
                }
                output_data.append(message_row)
                
    # Shuffle data to avoid sequential bias during training
    random.shuffle(output_data)
    
    # Write to file
    output_path = os.path.join(os.path.dirname(__file__), "intent_training_data.jsonl")
    with open(output_path, "w", encoding="utf-8") as f:
        for row in output_data:
            f.write(json.dumps(row) + "\n")
            
    print(f"✅ Generated {len(output_data)} training examples.")
    print(f"Output saved to: {output_path}")

if __name__ == "__main__":
    main()
