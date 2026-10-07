/**
 * client/src/agent/EditRecap.js
 *
 * R92 round B: a recap of what the AI did to the project, why, and what it
 * changed. Pure (no store, no network).
 *
 * Before R92 the ledger kept only the operation name and the chat message,
 * and "what did you do?" answered from an in-memory list whose every entry
 * read "Planning: <op>" (no reasons, lost on reload). Now each finished edit
 * records:
 *   - what: the operation and its result message;
 *   - why:  the plan's reasons (or the operation's description);
 *   - impact: measured before/after facts (length, cuts, captions, layers,
 *     sounds, framing), plus what that means for the viewer.
 * The ledger is saved with the project, so the recap survives a reload, and
 * the Brain receives the same entries as context.
 */

const LABELS = {
    silence_removal: 'Removed silences', remove_filler_words: 'Removed filler words', remove_repetition: 'Removed repeated takes',
    long_form_edit: 'Cleaned up the video', compound_clean_dynamic: 'Cleaned up and added zoom rhythm', enhance_audio: 'Enhanced the voice',
    denoise_audio: 'Reduced background noise', normalize_audio: 'Levelled the audio', auto_captions: 'Added captions',
    rhythm_zoom: 'Added a zoom rhythm', animate_automatically: 'Animated the key moments', compose_motion: 'Wrote custom motion',
    apply_style_recipe: 'Applied a style recipe', add_transition: 'Added transitions', add_template: 'Added an animated graphic',
    add_sfx: 'Added sound effects', remove_background: 'Changed the background', set_aspect_ratio: 'Changed the frame',
    extract_short: 'Kept the strongest moment as a short', repurpose_shorts: 'Picked shorts for each platform',
    auto_edit: 'Ran the Auto edit', color_grade: 'Colour graded the video', apply_lut: 'Applied a colour look',
    sync_cutaways: 'Placed cutaways and number pops', zoom_speaker: 'Framed the speaker', track_speaker: 'Tracked the speaker',
};

const STYLE_NAMES = { vlog: 'Vlog', talking_head: 'Talking head', interview: 'Interview', podcast: 'Podcast', reel: 'Reel' };

/** What a viewer gets from each kind of change. */
const VIEWER_EFFECT = {
    shorter: 'tighter pacing, fewer reasons to scroll away',
    captions: 'it works with the sound off, which is how most people first watch',
    voice: 'clearer, even sound at standard loudness',
    motion: 'more visual energy on the moments that matter',
    sound: 'transitions and pops feel punchier',
    frame: 'fills a phone screen',
    shorts: 'more chances to be discovered on each platform',
    background: 'the person stands out from the background',
};

const round1 = n => Math.round((Number(n) || 0) * 10) / 10;

/** Countable facts about a timeline, for before/after comparison. */
export function timelineFacts(state = {}) {
    const tracks = Array.isArray(state.tracks) ? state.tracks : [];
    const end = tracks.reduce((m, t) => Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
    const of = type => tracks.filter(t => t.type === type).flatMap(t => t.clips || []);
    const video = of('video');
    const text = of('text');
    const overlay = of('overlay');
    const audio = tracks.filter(t => t.type === 'audio' || t.type === 'music').flatMap(t => t.clips || []);
    return {
        duration: round1(end),
        videoClips: video.length,
        captionClips: text.filter(c => Array.isArray(c.words) || String(c.clipId || c.id || '').startsWith('caption-') || c.style === 'subtitle').length,
        textClips: text.length,
        overlayClips: overlay.length,
        sfxClips: audio.filter(c => c.isSFX).length,
        transitions: video.filter(c => c.transition?.type).length,
        animatedLayers: [...text, ...overlay].filter(c => Array.isArray(c.animations) && c.animations.length > 0).length,
        mattedClips: video.filter(c => c.layerTarget === 'background').length,
        aspectRatio: state.aspectRatio || null,
        shorts: Array.isArray(state.shorts) ? state.shorts.length : 0,
    };
}

/** Measured change between two timelineFacts. */
export function editImpact(before, after) {
    if (!before || !after) return null;
    const d = (k) => (Number(after[k]) || 0) - (Number(before[k]) || 0);
    return {
        durationBefore: before.duration,
        durationAfter: after.duration,
        secondsRemoved: round1(Math.max(0, before.duration - after.duration)),
        cutsAdded: Math.max(0, d('videoClips')),
        captionsAdded: d('captionClips'),
        overlaysAdded: d('overlayClips'),
        sfxAdded: d('sfxClips'),
        transitionsAdded: d('transitions'),
        animatedAdded: d('animatedLayers'),
        mattedAdded: d('mattedClips'),
        shortsAdded: d('shorts'),
        aspectChanged: before.aspectRatio !== after.aspectRatio ? { from: before.aspectRatio, to: after.aspectRatio } : null,
    };
}

function fmtTime(s) {
    const n = Math.max(0, Math.round(Number(s) || 0));
    return n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : `${n} s`;
}

/** One sentence of measured impact, plus what it means for the viewer. */
export function impactText(impact) {
    if (!impact) return null;
    const parts = [];
    const effects = new Set();
    if (impact.secondsRemoved >= 0.5) {
        const pct = impact.durationBefore > 0 ? Math.round((impact.secondsRemoved / impact.durationBefore) * 100) : 0;
        parts.push(`${round1(impact.secondsRemoved)} s shorter (${fmtTime(impact.durationBefore)} to ${fmtTime(impact.durationAfter)}, -${pct}%)`);
        effects.add('shorter');
    }
    if (impact.cutsAdded > 0) parts.push(`${impact.cutsAdded} new cut(s)`);
    if (impact.captionsAdded > 0) { parts.push(`${impact.captionsAdded} caption line(s)`); effects.add('captions'); }
    if (impact.transitionsAdded > 0) parts.push(`${impact.transitionsAdded} transition(s)`);
    if (impact.overlaysAdded > 0) { parts.push(`${impact.overlaysAdded} graphic(s)`); effects.add('motion'); }
    if (impact.animatedAdded > 0) { parts.push(`${impact.animatedAdded} animated layer(s)`); effects.add('motion'); }
    if (impact.sfxAdded > 0) { parts.push(`${impact.sfxAdded} sound effect(s)`); effects.add('sound'); }
    if (impact.mattedAdded > 0) { parts.push(`background changed on ${impact.mattedAdded} clip(s)`); effects.add('background'); }
    if (impact.shortsAdded > 0) { parts.push(`${impact.shortsAdded} short(s) ready to export`); effects.add('shorts'); }
    if (impact.aspectChanged) { parts.push(`frame ${impact.aspectChanged.from || '?'} to ${impact.aspectChanged.to || '?'}`); if (impact.aspectChanged.to === '9:16') effects.add('frame'); }
    if (parts.length === 0) return null;
    const why = [...effects].map(e => VIEWER_EFFECT[e]).filter(Boolean);
    return `${parts.join(', ')}${why.length ? `. For the viewer: ${why.join('; ')}` : ''}.`;
}

/** Build a ledger entry for a finished edit. */
export function ledgerEntry({ op, message = null, reasons = [], description = null, before = null, after = null, style = null } = {}) {
    if (!op) return null;
    const impact = editImpact(before, after);
    const why = (Array.isArray(reasons) ? reasons : []).filter(Boolean).map(String);
    const uniqueWhy = [...new Set(why)].slice(0, 4);
    return {
        op,
        at: Date.now(),
        summary: message ? String(message).slice(0, 400) : null,
        why: uniqueWhy.length ? uniqueWhy.join('; ') : (description || null),
        impact,
        impactText: impactText(impact),
        style: style || null,
    };
}

/** "What did you do?" — the whole ledger, in order, with why and impact. */
export function buildRecap(ledger, { style = null, facts = null } = {}) {
    const entries = (Array.isArray(ledger) ? ledger : []).filter(e => e && e.op && e.op !== 'chat');
    if (entries.length === 0) return 'Nothing has been edited in this project yet. Ask for a clean up, captions or an Auto edit and I will keep a record here.';
    const head = style && STYLE_NAMES[style] ? `Here is what I did, editing as a ${STYLE_NAMES[style]}:` : 'Here is what I did:';
    const lines = entries.slice(-20).map((e, i) => {
        const label = LABELS[e.op] || String(e.op).replace(/_/g, ' ');
        const why = e.why ? ` Why: ${String(e.why).replace(/\.$/, '')}.` : '';
        const impact = e.impactText ? ` Impact: ${e.impactText}` : (e.summary ? ` Result: ${String(e.summary).slice(0, 160)}` : '');
        return `${i + 1}. ${label}.${why}${impact}`;
    });
    const first = entries.find(e => e.impact && Number.isFinite(Number(e.impact.durationBefore)));
    let overall = '';
    if (first && facts && Number.isFinite(Number(facts.duration))) {
        const from = Number(first.impact.durationBefore);
        const to = Number(facts.duration);
        if (from > 0 && Math.abs(from - to) >= 0.5) {
            const pct = Math.round(((from - to) / from) * 100);
            overall = `\nOverall: ${fmtTime(from)} to ${fmtTime(to)} (${pct >= 0 ? '-' : '+'}${Math.abs(pct)}%)`;
        } else overall = `\nOverall: ${fmtTime(to)} long`;
        const extras = [];
        if (facts.captionClips) extras.push(`${facts.captionClips} caption lines`);
        if (facts.sfxClips) extras.push(`${facts.sfxClips} sound effects`);
        if (facts.animatedLayers) extras.push(`${facts.animatedLayers} animated layers`);
        if (facts.shorts) extras.push(`${facts.shorts} shorts ready`);
        if (extras.length) overall += `, ${extras.join(', ')}`;
        overall += '.';
    }
    const more = entries.length > 20 ? `\n(${entries.length - 20} earlier edits not shown.)` : '';
    return `${head}\n${lines.join('\n')}${overall}${more}`;
}

/** Compact entries for the Brain's prompt. */
export function ledgerForBrain(ledger, limit = 8) {
    return (Array.isArray(ledger) ? ledger : []).filter(e => e && e.op).slice(-limit)
        .map(e => ({ op: e.op, why: e.why ? String(e.why).slice(0, 160) : null, impact: e.impactText ? String(e.impactText).slice(0, 200) : null }));
}

export default { timelineFacts, editImpact, impactText, ledgerEntry, buildRecap, ledgerForBrain };
