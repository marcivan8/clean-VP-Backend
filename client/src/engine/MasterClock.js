/**
 * MasterClock.js
 * The Conductor of the Playback Engine.
 * 
 * Responsibilities:
 * 1. Maintain high-precision time using AudioContext hardware clock.
 * 2. Handle Play, Pause, Seek states.
 * 3. Calculate "current time" ensuring no drift vs system audio.
 * 4. Handle Playback Rate (Speed).
 */

class MasterClock {
    constructor() {
        // Initialize AudioContext lazily or immediately? 
        // Modern browsers suspend it until interaction.
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContextClass();

        // STRICT mode: We only use AudioContext time.
        // anchorTime: The AudioContext time when playback started (or would have started) at timeline 0.
        // formula: timelineTime = (audioContext.currentTime - anchorTime) * playbackRate
        this.anchorTime = 0;
        this._isPlaying = false;
        this.playbackRate = 1.0;

        // Debugging
        this.id = Math.random().toString(36).substr(2, 5);
        console.log(`[MasterClock:${this.id}] Initialized (Strict Audio-Drive)`);

        // Pause point tracking (for when we sort of 'hold' a time while paused)
        this.lastPausePosition = 0;
    }

    /**
     * Start/Resume the clock.
     * @param {number} startTime - Optional explicit start time (if undefined, resumes from pause)
     */
    async play(startTime) {
        if (this._isPlaying) return;

        // Resume context if suspended (browser policy)
        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }

        const startPos = (startTime !== undefined) ? startTime : this.lastPausePosition;

        // Calculate the anchor point
        // We want: startPos = (now - anchor) * rate
        // So: anchor = now - (startPos / rate)
        this.anchorTime = this.audioCtx.currentTime - (startPos / this.playbackRate);

        this._isPlaying = true;
        console.log(`[MasterClock:${this.id}] Playing from ${startPos.toFixed(3)}s (Anchor: ${this.anchorTime.toFixed(3)})`);
    }

    /**
     * Pause the clock.
     */
    pause() {
        if (!this._isPlaying) return;

        // Capture where we stopped
        this.lastPausePosition = this.getCurrentTime();
        this._isPlaying = false;
        console.log(`[MasterClock:${this.id}] Paused at ${this.lastPausePosition.toFixed(3)}s`);
    }

    /**
     * Seek to a specific time.
     * @param {number} time - Time in seconds
     */
    seek(time) {
        this.lastPausePosition = Math.max(0, time);

        // If playing, we must reset the anchor immediately so the next tick is correct and keeps playing from new point
        if (this._isPlaying) {
            // anchor = now - (newPos / rate)
            this.anchorTime = this.audioCtx.currentTime - (this.lastPausePosition / this.playbackRate);
        }
        console.log(`[MasterClock:${this.id}] Seek to ${time.toFixed(3)}s`);
    }

    /**
     * Set playback speed.
     * @param {number} rate - Multiplier (e.g. 1.0, 1.5, 2.0)
     */
    setPlaybackRate(rate) {
        if (rate <= 0) return;

        // To change speed seamlessly without jumping:
        // 1. Get current time
        const now = this.getCurrentTime();

        // 2. Set new rate
        this.playbackRate = rate;

        // 3. Reset anchor so "now" remains "now"
        // anchor = audioNow - (virtualTime / newRate)
        if (this._isPlaying) {
            this.anchorTime = this.audioCtx.currentTime - (now / this.playbackRate);
        }
    }

    /**
     * Get the current high-precision time.
     * @returns {number} Current time in seconds
     */
    getCurrentTime() {
        if (!this._isPlaying) return this.lastPausePosition;

        // Main formula: T = (HardwareTime - Anchor) * Speed
        let t = (this.audioCtx.currentTime - this.anchorTime) * this.playbackRate;
        return Math.max(0, t); // Clamp to 0
    }

    get isPlaying() {
        return this._isPlaying;
    }

    get state() {
        return this.audioCtx.state;
    }

    destroy() {
        this.audioCtx.close();
    }
}

export default MasterClock;
