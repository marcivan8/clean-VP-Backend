/**
 * scripts/generate_editorial_dataset.js
 *
 * Generates instruction-tuning datasets for training Vibed's custom
 * Editorial Brain model (Qwen 2.5 3B / Llama 3.2 3B).
 *
 * Covers 3 core editorial intelligences:
 *  1. EditorialBrain (advisory reviews, suggestions, warnings, action recommendations)
 *  2. StoryIntelligence (hook evaluation, narrative beat mapping, sag detection)
 *  3. ProjectIntelligence (asset roles, project archetype, coverage gaps)
 *
 * Output:
 *  - ML_Dataset/editorial_brain_train.jsonl
 *  - ML_Dataset/editorial_brain_val.jsonl
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../ML_Dataset');
const TRAIN_PATH = path.join(OUTPUT_DIR, 'editorial_brain_train.jsonl');
const VAL_PATH   = path.join(OUTPUT_DIR, 'editorial_brain_val.jsonl');

const FORMATS = ['reels', 'tiktok', 'youtube', 'shorts', 'podcast'];
const STYLES = ['talking_head_fast', 'cinematic_vlog', 'tutorial_clean', 'interview_balanced', 'product_punchy'];

const HOOK_VOCAB = ['strong', 'adequate', 'weak', 'absent'];
const BEAT_VOCAB = ['hook', 'setup', 'build', 'turn', 'payoff', 'outro', 'filler'];
const SEVERITY_VOCAB = ['low', 'medium', 'high'];
const ROLE_VOCAB = ['a_roll', 'b_roll', 'intro', 'outro', 'demo', 'cutaway', 'supporting'];
const PROJECT_TYPES = ['interview', 'tutorial', 'vlog', 'product_demo', 'montage', 'presentation', 'narrative'];

// Realistic speech pools across domains
const SPEECH_BANKS = {
    hook_strong: [
        "Stop making this massive video editing mistake right now.",
        "Here is the secret reason your reels get zero views in the first 3 seconds.",
        "I tested 50 AI video editors and this one blew my mind completely.",
        "Never export your video in 4K before you change this hidden setting.",
        "This one editing trick doubled our retention overnight, look at this graph.",
        "Nobody is talking about this secret audio technique that pro YouTubers use."
    ],
    hook_weak: [
        "Um, hey guys, welcome back to another video on my channel.",
        "So today I kind of wanted to talk about a few random things.",
        "Testing, testing, one two, is this microphone on?",
        "Okay, so in this video we might look at some features if we have time.",
        "Hey everyone, sorry I haven't uploaded in like three months."
    ],
    setup: [
        "To understand why this happens, we have to look at how viewers scroll on mobile.",
        "First, let's open the project settings and check the timeline frame rate.",
        "The problem starts when you leave too much dead air between your thoughts.",
        "Here's the baseline footage before we apply any color grade or sound design."
    ],
    build: [
        "Notice what happens when I tighten the jump cut right on the breath.",
        "Now we add a subtle whoosh and punch in by 15% on the key word.",
        "Watch the waveform here as we duck the background music by 8dB.",
        "When the camera switches to the product closeup, the story instantly clarifies."
    ],
    turn: [
        "But here is where 90% of creators completely ruin the pacing.",
        "Instead of cutting away, keep the viewer guessing by delaying the reveal.",
        "Suddenly, the viewer realizes the punchline isn't what they expected."
    ],
    payoff: [
        "And boom, that is how you hold viewer attention all the way to the end.",
        "The final result is crisp, punchy, and retention stays above 70%.",
        "Export it directly in 9:16 vertical and watch your watch-time skyrocket."
    ],
    outro: [
        "Drop a comment if you want the project preset, and make sure to subscribe.",
        "Save this reel for your next edit and follow for daily editing tips.",
        "Link in the bio for the full template, see you guys in the next one."
    ],
    filler: [
        "Um, like, you know what I mean, basically sort of like that.",
        "So yeah, anyway, moving on to the next part I guess.",
        "Wait, where was I? Oh yeah, let me find that clip."
    ]
};

function randChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randRange(min, max, dec = 1) {
    const factor = Math.pow(10, dec);
    return Math.round((min + Math.random() * (max - min)) * factor) / factor;
}

function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
}

// ── 1. Editorial Brain Sample Generator ──────────────────────────────────────
function generateEditorialBrainSample(id) {
    const format = randChoice(FORMATS);
    const style = randChoice(STYLES);
    const clipCount = randInt(4, 25);
    const duration = randRange(15, 180, 1);
    const hasCaptions = Math.random() > 0.3;
    const hasMusic = Math.random() > 0.4;
    const hasSilence = Math.random() > 0.35;
    const isAdvise = Math.random() > 0.3;

    const userQuestions = [
        "How can I make this video more engaging for TikTok?",
        "Where does the pacing feel slow?",
        "Clean up the pauses and give me recommendations for B-roll.",
        "Analyze the project and tell me what to fix first.",
        "Does the hook work or should I trim the opening?"
    ];
    const userPrompt = isAdvise ? randChoice(userQuestions) : "Trigger: project_opened. Analyze the project and provide suggestions.";

    const systemPrompt = `You are Vibed's Senior Editorial Brain. You reason over the user's video project state (timeline, clips, speech transcripts, asset intelligence, and editing style) to produce expert post-production advice and actionable commands.

Rules:
1. Return strictly valid JSON adhering to the brain_output schema.
2. Provide concrete, high-leverage editing recommendations with valid command names.
3. Keep suggestions prioritized (critical, high, medium, low) and cite exact times or clips when relevant.
4. Ground observations in timeline reality: hook timing, dialogue pacing, sound balance, visual rhythm.`;

    const projectContext = {
        format,
        editingStyle: style,
        durationSec: duration,
        clipCount,
        hasCaptions,
        hasMusicTrack: hasMusic,
        hasUncutSilence: hasSilence,
        primarySpeakerPace: randChoice(['too_fast', 'balanced', 'hesitant', 'monotone'])
    };

    const suggestions = [];
    const warnings = [];

    if (!hasCaptions) {
        suggestions.push({
            type: 'captions',
            text: 'Generate kinetic animated subtitles to boost mobile retention.',
            command: 'generate_captions',
            reason: 'Over 75% of social video feeds are watched with audio muted.',
            priority: 'high'
        });
    }

    if (hasSilence) {
        suggestions.push({
            type: 'pacing',
            text: 'Trim hesitation pauses and dead air across dialogue clips.',
            command: 'cut_silence',
            reason: 'Removes 2.8s of hesitation, improving flow into the first beat.',
            priority: 'critical'
        });
        warnings.push({
            type: 'retention_risk',
            text: 'Dead air detected near the opening: viewers may swipe away before the hook.',
            severity: 'warning'
        });
    }

    if (format === 'reels' || format === 'tiktok' || format === 'shorts') {
        suggestions.push({
            type: 'visual_rhythm',
            text: 'Apply subtle punch-in zoom rhythm (1.12x) on emphasized statements.',
            command: 'apply_rhythm_zoom',
            reason: 'Breaks visual monotony during static talking-head moments.',
            priority: 'medium'
        });
    }

    if (!hasMusic) {
        suggestions.push({
            type: 'audio',
            text: 'Add low ambient background music ducked at -18dB under speech.',
            command: 'add_background_music',
            reason: 'Provides emotional energy without masking vocal clarity.',
            priority: 'medium'
        });
    }

    const output = {
        intent: {
            type: isAdvise ? 'advise' : 'execute',
            confidence: randRange(0.88, 0.99, 2),
            command: isAdvise ? null : suggestions[0]?.command || null,
            reasoning: `Reviewed ${clipCount} timeline clips for ${format} pacing (${style}). Evaluated retention drivers, hook placement, and vocal clarity.`
        },
        response: {
            message: `Analyzed your ${format} edit (${duration}s). ${hasSilence ? 'Found hesitation pauses to tighten.' : 'Timeline flow is solid.'} Suggested ${suggestions.length} high-impact improvements.`,
            suggestions: suggestions.slice(0, 3),
            warnings: warnings.slice(0, 2),
            insight: `For ${format}, videos that deliver their main promise within 2.5s retain 38% more viewers past the 30-second mark.`
        },
        learning: {
            patternObserved: `User prefers ${style} editing on ${format} format.`,
            profileUpdates: {
                note: `Style tuned for ${format}`
            }
        }
    };

    return {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `User instruction: "${userPrompt}"\n\nProject State:\n${JSON.stringify(projectContext, null, 2)}` },
            { role: 'assistant', content: JSON.stringify(output) }
        ]
    };
}

// ── 2. Story Intelligence Sample Generator ───────────────────────────────────
function generateStoryIntelligenceSample(id) {
    const isStrongHook = Math.random() > 0.4;
    const clipCount = randInt(4, 12);
    const platform = randChoice(FORMATS);
    const projectType = randChoice(PROJECT_TYPES);
    const throughLine = `Mastering ${randChoice(['color grading', 'sound design', 'jump cuts', 'hook retention', 'viral storytelling'])}`;

    let cursor = 0;
    const clips = [];
    const beats = [];
    const clipIds = [];

    for (let i = 0; i < clipCount; i++) {
        const cId = `clip_${id}_${i}`;
        clipIds.push(cId);
        const dur = randRange(1.8, 6.5, 1);
        const start = cursor;
        const end = Math.round((cursor + dur) * 10) / 10;
        cursor = end;

        let role = 'build';
        let text = '';
        if (i === 0) {
            role = 'hook';
            text = isStrongHook ? randChoice(SPEECH_BANKS.hook_strong) : randChoice(SPEECH_BANKS.hook_weak);
        } else if (i === 1) {
            role = 'setup';
            text = randChoice(SPEECH_BANKS.setup);
        } else if (i === clipCount - 2) {
            role = 'payoff';
            text = randChoice(SPEECH_BANKS.payoff);
        } else if (i === clipCount - 1) {
            role = 'outro';
            text = randChoice(SPEECH_BANKS.outro);
        } else {
            role = randChoice(['build', 'turn', 'filler']);
            text = randChoice(SPEECH_BANKS[role]);
        }

        clips.push({ id: cId, name: `Take_${i + 1}`, duration: dur, start, transcript: text, role });
        beats.push({
            beat: role,
            startSec: start,
            endSec: end,
            clipIds: [cId],
            summary: text.slice(0, 60)
        });
    }

    const hookStrength = isStrongHook ? 'strong' : (Math.random() > 0.5 ? 'weak' : 'adequate');
    const hookAt = isStrongHook ? randRange(0.2, 1.8, 1) : randRange(2.5, 4.5, 1);

    const sagWindows = [];
    if (!isStrongHook) {
        sagWindows.push({
            startSec: 0,
            endSec: 3.5,
            reason: 'Opening dialogue rambles before stating the core premise',
            severity: 'high'
        });
    }

    const issues = [];
    if (!isStrongHook) {
        issues.push({
            issue: 'Weak opening hook may lose mobile viewers in feed',
            severity: 'high',
            suggestion: 'Cut directly to the main assertion at 0.0s',
            atSec: 0.1
        });
    }

    const storyMap = {
        beats,
        hook: {
            atSec: hookAt,
            strength: hookStrength,
            note: isStrongHook ? 'Punchy proposition stated within 2 seconds' : 'Slow introductory greeting delays thesis'
        },
        sagWindows,
        deliversThroughLine: isStrongHook,
        throughLineNote: isStrongHook ? 'Directly supports through-line with evidence' : 'Narrative wanders in setup',
        issues
    };

    const systemPrompt = `You are a senior editor reviewing an ASSEMBLED cut — not raw footage.
The clips below are in the exact order they play. Your job is to say whether this SEQUENCE works as a story, where it lands its hook, where it sags, and how it delivers the project's through-line.

Return strictly valid JSON matching the story_map schema.`;

    const promptText = `━━━ THE PROJECT ━━━
Type:         ${projectType}
Through-line: "${throughLine}"
Platform:     ${platform}
Total length: ${cursor}s across ${clips.length} clip(s)

━━━ THE CUT, IN ORDER ━━━
${clips.map((c, i) => `${i + 1}. [${c.start}s–${Math.round((c.start + c.duration) * 10) / 10}s] id:${c.id} "${c.name}"\n     says: "${c.transcript}"`).join('\n')}`;

    return {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: promptText },
            { role: 'assistant', content: JSON.stringify(storyMap) }
        ]
    };
}

// ── 3. Project Intelligence Sample Generator ─────────────────────────────────
function generateProjectIntelligenceSample(id) {
    const projectType = randChoice(PROJECT_TYPES);
    const assetCount = randInt(4, 10);
    const platform = randChoice(FORMATS);

    const assetRoles = [];
    const coverageGaps = [];
    const binItems = [];

    for (let i = 0; i < assetCount; i++) {
        const aId = `asset_${id}_${i}`;
        const role = i === 0 ? 'a_roll' : (i === 1 ? 'intro' : randChoice(ROLE_VOCAB));
        const isBroll = role === 'b_roll' || role === 'cutaway';
        binItems.push({
            id: aId,
            name: `${role}_footage_${i + 1}.mp4`,
            scene_type: isBroll ? 'b_roll' : 'talking_head',
            camera_angle: isBroll ? 'close_up' : 'medium',
            audio_type: isBroll ? 'ambient' : 'speech',
            duration: randRange(5, 45, 1)
        });
        assetRoles.push({
            assetId: aId,
            role,
            serves: role === 'b_roll' ? 'illustrates talking point' : null,
            confidence: randRange(0.85, 0.99, 2)
        });
    }

    if (!assetRoles.some(r => r.role === 'b_roll')) {
        coverageGaps.push({
            gap: 'No contextual B-roll cutaways found in media bin',
            severity: 'medium',
            suggestion: 'Add relevant stock footage or product closeups to cover dialogue jumps'
        });
    }

    const projectMap = {
        project_type: projectType,
        through_line: `Complete walkthrough and practical advice for ${projectType.replace('_', ' ')}`,
        target_audience: 'Creators and editors seeking high-retention video production',
        asset_roles: assetRoles,
        coverage_gaps: coverageGaps
    };

    const systemPrompt = `You are a post-production project supervisor. Analyze the footage and assets in this media bin.
Classify what project type this is, identify the central narrative through-line, map each asset to its functional editorial role, and detect any coverage gaps.

Return strictly valid JSON matching the project_map schema.`;

    const userText = `Platform: ${platform}
Total Assets: ${binItems.length}

Media Bin Inventory:
${binItems.map(a => `- id:${a.id} "${a.name}" (${a.duration}s, scene:${a.scene_type}, framing:${a.camera_angle}, audio:${a.audio_type})`).join('\n')}`;

    return {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
            { role: 'assistant', content: JSON.stringify(projectMap) }
        ]
    };
}

// ── Main Generation Loop ─────────────────────────────────────────────────────
function main() {
    const TOTAL_SAMPLES = 2500;
    const VAL_RATIO = 0.1; // 10% validation

    console.log(`🚀 Generating ${TOTAL_SAMPLES} synthetic instruction pairs for Vibed Editorial Brain...`);

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const trainStream = fs.createWriteStream(TRAIN_PATH, { flags: 'w', encoding: 'utf8' });
    const valStream   = fs.createWriteStream(VAL_PATH,   { flags: 'w', encoding: 'utf8' });

    let trainCount = 0;
    let valCount = 0;

    for (let i = 0; i < TOTAL_SAMPLES; i++) {
        // Balance across all 3 tasks: 50% Editorial Brain, 30% Story Intel, 20% Project Intel
        const roll = Math.random();
        let sample;
        if (roll < 0.50) {
            sample = generateEditorialBrainSample(i);
        } else if (roll < 0.80) {
            sample = generateStoryIntelligenceSample(i);
        } else {
            sample = generateProjectIntelligenceSample(i);
        }

        const isVal = Math.random() < VAL_RATIO;
        const line = JSON.stringify(sample) + '\n';

        if (isVal) {
            valStream.write(line);
            valCount++;
        } else {
            trainStream.write(line);
            trainCount++;
        }
    }

    trainStream.end();
    valStream.end();

    console.log(`✅ Generation complete!`);
    console.log(`   Train set: ${trainCount} examples → ${TRAIN_PATH}`);
    console.log(`   Val set:   ${valCount} examples → ${VAL_PATH}`);
}

main();
