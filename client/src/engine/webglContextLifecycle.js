/**
 * Stop the WebGL playback path after the browser loses its canvas context.
 * The player can then switch this asset to its plain <video> fallback.
 */
export function handleWebGLContextLost(engine, event) {
    event?.preventDefault?.();
    if (engine._webglContextLost || engine.isDestroyed) return;

    engine._webglResumeState = engine.state;
    engine._webglResumeTime = engine.clock?.getCurrentTime?.() ?? 0;
    engine._webglContextLost = true;
    engine.stopLoop();
    engine.clock?.pause?.();
    engine.setState('ERROR');

    if (engine._webglContextErrorReported) return;
    engine._webglContextErrorReported = true;
    engine.onError({
        type: 'webgl_context_lost',
        message: 'GPU preview stopped because the browser lost its graphics context.',
        recoverable: true,
    });
}

export async function handleWebGLContextRestored(engine) {
    if (!engine._webglContextLost || engine.isDestroyed) return false;

    try {
        await engine.restoreWebGLContext();
        if (engine.isDestroyed) return false;
        engine._webglContextLost = false;
        engine._webglContextErrorReported = false;
        const resumeState = engine._webglResumeState;
        if (resumeState === 'PLAYING') {
            await engine.clock.play(engine._webglResumeTime);
            engine.setState('PLAYING');
            engine.startLoop();
        } else {
            engine.setState(resumeState || 'READY');
        }
        engine.onRecovered?.({ preservePlaybackError: resumeState === 'ERROR' });
        return true;
    } catch (error) {
        engine.onError({
            type: 'webgl_context_restore_failed',
            message: error?.message || 'The graphics context returned, but the preview could not be rebuilt.',
            recoverable: false,
        });
        return false;
    }
}
