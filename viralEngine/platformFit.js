/**
 * Platform Fit Engine — Viral Pilot Phase 7
 *
 * Calculates fit scores and actionable optimisation tips for all major platforms.
 * Platforms: TikTok, Reels, Shorts, YouTube, Pinterest, LinkedIn
 *
 * @param {Object} data - Aggregated analysis data.
 * @returns {Object}    - Scores and optimisations per platform.
 */
function calculatePlatformFit(data) {
    const { duration, pacing, emotion, hook, structure } = data;

    // ── TikTok ─────────────────────────────────────────────────────────
    let tiktokScore = 55;
    const tiktokOpts = [];
    if (duration >= 15 && duration <= 60) tiktokScore += 20;
    else {
        tiktokOpts.push(duration < 15
            ? 'TikTok: Pad to at least 15 seconds to be eligible for FYP.'
            : 'TikTok: Trim to under 60 seconds for maximum reach.'
        );
    }
    if (pacing?.score > 70)  tiktokScore += 10; else tiktokOpts.push('TikTok: Increase cut frequency — aim for a cut every 2–3 seconds.');
    if (emotion?.score > 70) tiktokScore += 10; else tiktokOpts.push('TikTok: Amplify emotional moments — happiness and surprise drive shares.');
    if (hook?.score > 80)    tiktokScore += 10; else tiktokOpts.push('TikTok: The first 1.5 seconds MUST have a visual or verbal hook — add text overlay or a bold statement.');
    if (hook?.hasFace)       tiktokScore += 5;  else tiktokOpts.push('TikTok: Show a face in the first second — face detection increases reach.');

    // ── Instagram Reels ────────────────────────────────────────────────
    let reelsScore = 55;
    const reelsOpts = [];
    if (duration <= 90) reelsScore += 15; else reelsOpts.push('Reels: Shorten to under 90 seconds for best distribution.');
    if (emotion?.dominantEmotion === 'happy' || emotion?.dominantEmotion === 'surprised') reelsScore += 10;
    else reelsOpts.push('Reels: Uplifting or surprising content performs best on Reels.');
    if (pacing?.score > 65) reelsScore += 10; else reelsOpts.push('Reels: Tighten pacing — 3–4 second shots work well for aesthetics.');
    if (hook?.score > 70)   reelsScore += 10; else reelsOpts.push('Reels: Add a trending audio track and show the best visual moment first.');

    // ── YouTube Shorts ─────────────────────────────────────────────────
    let shortsScore = 55;
    const shortsOpts = [];
    if (duration <= 60) shortsScore += 20; else shortsOpts.push('Shorts: Must be under 60 seconds to appear in the Shorts feed.');
    if (hook?.score > 75)    shortsScore += 15; else shortsOpts.push('Shorts: Open with a question or a surprising statement to trigger repeat views.');
    if (pacing?.score > 65)  shortsScore += 10; else shortsOpts.push('Shorts: Fast edits and high visual variety increase completion rates.');
    if (emotion?.score > 65) shortsScore += 5;

    // ── YouTube Long-Form ──────────────────────────────────────────────
    let youtubeScore = 45;
    const youtubeOpts = [];
    if (duration > 120) youtubeScore += 30; else youtubeOpts.push('YouTube: Long-form content (> 2 min) earns more watch-time and ad revenue.');
    if (pacing?.score > 40 && pacing?.score < 80) youtubeScore += 10;
    else if (pacing?.score >= 80) youtubeOpts.push('YouTube: Slightly slower pacing helps retention for long-form — ensure viewers can follow.');
    if (structure?.hasCTA) youtubeScore += 10; else youtubeOpts.push('YouTube: Add a clear CTA at the end (subscribe, like, comment) to boost signals.');
    if (hook?.score > 65)   youtubeScore += 5;  else youtubeOpts.push('YouTube: Add a chapter intro or B-roll montage in the first 30 seconds.');

    // ── Pinterest ──────────────────────────────────────────────────────
    let pinterestScore = 45;
    const pinterestOpts = [];
    if (duration >= 4 && duration <= 15) pinterestScore += 25;
    else pinterestOpts.push('Pinterest: Ideal video length is 4–15 seconds for Idea Pins.');
    if (emotion?.dominantEmotion === 'happy') pinterestScore += 15;
    else pinterestOpts.push('Pinterest: Aspirational, joyful content performs best — show a beautiful result or transformation.');
    pinterestOpts.push('Pinterest: Add text overlays with keywords (no sound autoplay on mobile).');

    // ── LinkedIn ───────────────────────────────────────────────────────
    let linkedinScore = 40;
    const linkedinOpts = [];
    if (duration >= 30 && duration <= 180) linkedinScore += 20;
    else linkedinOpts.push('LinkedIn: Keep videos between 30 seconds and 3 minutes for best engagement.');
    if (structure?.hasCTA)  linkedinScore += 10; else linkedinOpts.push('LinkedIn: End with a direct CTA — "Drop a comment", "Share with your team", etc.');
    if (hook?.hasSpeech)    linkedinScore += 10; else linkedinOpts.push('LinkedIn: Start with a strong verbal statement — most LinkedIn users watch with sound.');
    linkedinOpts.push('LinkedIn: Add captions — 80% of video is watched without sound on desktop.');

    // ── Best platform ──────────────────────────────────────────────────
    const scores = {
        tiktok:    Math.min(100, tiktokScore),
        reels:     Math.min(100, reelsScore),
        shorts:    Math.min(100, shortsScore),
        youtube:   Math.min(100, youtubeScore),
        pinterest: Math.min(100, pinterestScore),
        linkedin:  Math.min(100, linkedinScore)
    };

    const bestPlatform = Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0];

    return {
        ...scores,
        bestPlatform,
        optimizations: {
            tiktok:    tiktokOpts,
            reels:     reelsOpts,
            shorts:    shortsOpts,
            youtube:   youtubeOpts,
            pinterest: pinterestOpts,
            linkedin:  linkedinOpts
        }
    };
}

module.exports = { calculatePlatformFit };
