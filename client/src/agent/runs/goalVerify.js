/**
 * client/src/agent/runs/goalVerify.js — the verify step: check the finished
 * shorts against the goal's success criteria (R176b, layer 2). Pure.
 *
 * Judged on the FINISHED timelines, not on what was asked of the pipeline:
 * a short is "under 60 s" when its built timeline is, "captioned" when it has
 * caption clips with text, "on brand" when the brand accent is on something
 * in it. Only criteria the request set are checked; the rest are not judged.
 */

const LENGTH_TOLERANCE_S = 0.5;

function isCaptionTrack(track) {
    return track?.type === 'text' && track.id !== 'track-short-title' && !/title|cta/i.test(String(track.id || ''));
}

/** Facts about one finished short. Exported for the test. */
export function shortFacts(built, brand) {
    const tracks = Array.isArray(built?.tracks) ? built.tracks : [];
    const captionClips = tracks.filter(isCaptionTrack).flatMap(t => t.clips || [])
        .filter(c => String(c?.content ?? c?.text ?? '').trim() || (Array.isArray(c?.words) && c.words.length));
    let branded = null;
    const accent = String(brand?.accent || '').toLowerCase();
    if (accent) {
        let json = '';
        try { json = JSON.stringify(tracks).toLowerCase(); } catch { json = ''; }
        branded = json.includes(accent);
    }
    return { duration: Number(built?.duration) || 0, captions: captionClips.length, branded };
}

/**
 * @param {object} criteria  goal.criteria after the plan was approved
 * @param {Array<{shortId:string, platform:string, facts:{duration:number, captions:number, branded:boolean|null}}>} results
 * @param {{ hasBrandKit?: boolean, finishedCount?: number }} [ctx]
 * @returns {{ met: boolean, checks: Array<{id:string, ok:boolean, detail:string}> }}
 */
export function verifyShorts(criteria = {}, results = [], ctx = {}) {
    const checks = [];
    // Shorts finished before a reload count toward the total too.
    const n = Math.max(results.length, Number(ctx.finishedCount) || 0);
    const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });

    if (criteria.count != null) {
        add('count', n >= criteria.count, n >= criteria.count
            ? `${n} short${n === 1 ? '' : 's'} finished, as asked`
            : `${n} of the ${criteria.count} asked for were finished`);
    } else {
        add('count', n > 0, `${n} short${n === 1 ? '' : 's'} finished`);
    }

    if (criteria.maxSeconds) {
        const over = results.filter(r => r.facts.duration > criteria.maxSeconds + LENGTH_TOLERANCE_S);
        add('length', over.length === 0, over.length === 0
            ? `every short is under ${criteria.maxSeconds} s (longest ${Math.round(Math.max(0, ...results.map(r => r.facts.duration)))} s)`
            : `${over.length} short${over.length === 1 ? ' is' : 's are'} over ${criteria.maxSeconds} s (${over.map(r => `${Math.round(r.facts.duration)} s`).join(', ')})`);
    }

    if (criteria.captions === true) {
        const bare = results.filter(r => !(r.facts.captions > 0));
        add('captions', bare.length === 0, bare.length === 0
            ? 'every short has captions'
            : `${bare.length} short${bare.length === 1 ? ' has' : 's have'} no captions (the video may have no transcript yet)`);
    } else if (criteria.captions === false) {
        const captioned = results.filter(r => r.facts.captions > 0);
        add('captions', captioned.length === 0, captioned.length === 0 ? 'no captions, as asked' : `${captioned.length} short(s) still carry captions`);
    }

    if (criteria.brand) {
        if (!ctx.hasBrandKit) {
            add('brand', false, 'no brand kit is set for this project, so there were no brand colours to apply');
        } else {
            const off = results.filter(r => r.facts.branded !== true);
            add('brand', off.length === 0, off.length === 0 ? 'the brand colours are on every short' : `${off.length} short(s) do not show the brand colours`);
        }
    }

    if (criteria.platforms && criteria.platforms.length) {
        const wrong = results.filter(r => !criteria.platforms.includes(r.platform));
        add('platforms', wrong.length === 0, wrong.length === 0
            ? `made for ${criteria.platforms.join(', ')}`
            : `${wrong.length} short(s) are set for another platform`);
    }

    return { met: checks.every(c => c.ok), checks };
}

export default { verifyShorts, shortFacts };
