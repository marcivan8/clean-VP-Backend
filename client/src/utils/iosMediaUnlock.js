/**
 * iosMediaUnlock — makes the Revideo preview play on iPhone / iPad Safari.
 *
 * Revideo (@revideo/2d Video/Audio) creates detached <video>/<audio>
 * elements without `playsinline` and calls play() from its render loop.
 * iOS Safari:
 *   - does not load media data (readyState stays < 2) until an element is
 *     played, so every preview frame is drawn from an empty video (black),
 *   - rejects an unmuted play() that does not come from a user gesture,
 *   - keeps Web Audio contexts suspended until a gesture.
 * So the preview stayed black and Play did nothing.
 *
 * Fix, iOS only:
 *   1. every new Revideo video gets `playsinline` and is "primed": a muted
 *      play()/pause() (allowed without a gesture) so its first frame loads;
 *   2. on each tap (capture phase, before React's handlers such as Play),
 *      every not-yet-unlocked media element is played muted inside the
 *      gesture, which loads it and lets later programmatic play() calls
 *      through; suspended audio contexts are resumed.
 * Desktop and Android are untouched (install returns early).
 */

export function isIOSDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
    if (!nav) return false;
    const ua = nav.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS 13+ reports itself as a Mac.
    return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
}

export function prepareInline(el) {
    if (!el || el.__vibedInline) return;
    el.playsInline = true;
    el.setAttribute?.('playsinline', '');
    el.setAttribute?.('webkit-playsinline', '');
    el.__vibedInline = true;
}

/**
 * Play muted, then (unless the editor is playing by then) pause again and
 * restore the mute state. Resolves true when the element accepted play().
 */
export function primeMedia(el, isPlaying = () => false) {
    if (!el || typeof el.play !== 'function') return Promise.resolve(false);
    if (!el.paused) return Promise.resolve(true);
    const wasMuted = !!el.muted;
    el.muted = true;
    let p;
    try { p = el.play(); } catch { el.muted = wasMuted; return Promise.resolve(false); }
    return Promise.resolve(p).then(() => {
        if (!isPlaying()) el.pause();
        el.muted = wasMuted;
        return true;
    }, () => {
        el.muted = wasMuted;
        return false;
    });
}

/** Unlock every media element in the given pools (call inside a user gesture). */
export function unlockPools(pools, amplificationPool, isPlaying = () => false) {
    const jobs = [];
    for (const pool of pools) {
        for (const el of Object.values(pool || {})) {
            if (!el || el.__vibedUnlocked) continue;
            prepareInline(el);
            jobs.push(primeMedia(el, isPlaying).then((ok) => { if (ok) el.__vibedUnlocked = true; }));
        }
    }
    for (const entry of Object.values(amplificationPool || {})) {
        const ctx = entry?.audioContext;
        if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            jobs.push(Promise.resolve(ctx.resume()).catch(() => {}));
        }
    }
    return Promise.all(jobs);
}

/**
 * @param {{ Video: any, Audio: any, Media: any, isPlaying: () => boolean, onPrimed?: () => void, target?: EventTarget, force?: boolean }} opts
 *   onPrimed: called when media became loadable while paused, so the caller
 *   can redraw the paused frame (Revideo only redraws on change).
 * @returns {() => void} uninstall
 */
export function installIosMediaUnlock({ Video, Audio, Media, isPlaying = () => false, onPrimed, target, force = false } = {}) {
    if (!force && !isIOSDevice()) return () => {};
    if (!Video?.prototype) return () => {};

    const proto = Video.prototype;
    let restoreVideo = null;
    if (!proto.__vibedIosPatched) {
        const original = proto.video;
        proto.video = function patchedVideo(...args) {
            const el = original.apply(this, args);
            if (el && !el.__vibedInline) {
                prepareInline(el);
                if (!isPlaying()) {
                    primeMedia(el, isPlaying).then((ok) => { if (ok && !isPlaying()) onPrimed?.(); });
                }
            }
            return el;
        };
        proto.__vibedIosPatched = true;
        restoreVideo = () => { proto.video = original; delete proto.__vibedIosPatched; };
    }

    const onGesture = () => {
        unlockPools([Video.pool, Audio?.pool], Media?.amplificationPool, isPlaying)
            .then(() => { if (!isPlaying()) onPrimed?.(); });
    };
    const t = target || (typeof document !== 'undefined' ? document : null);
    t?.addEventListener?.('touchend', onGesture, { capture: true, passive: true });
    t?.addEventListener?.('click', onGesture, { capture: true, passive: true });

    return () => {
        t?.removeEventListener?.('touchend', onGesture, { capture: true });
        t?.removeEventListener?.('click', onGesture, { capture: true });
        restoreVideo?.();
    };
}
