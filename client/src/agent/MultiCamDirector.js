/**
 * client/src/agent/MultiCamDirector.js
 *
 * Multi-Camera Interview Alignment & Speaker-Driven Auto-Cutting Director.
 *
 * Features:
 * 1. Synchronizes multiple camera angles shot at the same time using acoustic
 *    waveform cross-correlation.
 * 2. Places Camera A (Host) and Camera B (Guest) on parallel synchronized tracks.
 * 3. Cuts automatically between camera angles based on speaker diarization turns
 *    (Host angle when Host speaks, Guest angle when Guest speaks, Two-shot/Wide on transitions).
 * 4. Enforces professional editorial pacing (minimum shot duration, transition smoothing).
 */

import { computeCrossCorrelation } from '../utils/audioCrossCorrelation.js';

/** Minimum duration in seconds an angle must stay on screen before cutting (prevents strobe cuts) */
const MIN_SHOT_DURATION_S = 1.8;
/** Natural pause threshold that triggers a wide angle or two-shot reaction */
const PAUSE_TRANSITION_THRESHOLD_S = 1.4;

/**
 * Groups diarized words into clean conversational turns per speaker.
 *
 * @param {Array<{word:string, start:number, end:number, speaker?:string}>} words
 * @param {string[]} speakers
 * @returns {Array<{speaker:string, start:number, end:number, text:string}>}
 */
export function extractSpeakerTurns(words = [], speakers = []) {
    if (!words || words.length === 0) return [];

    const turns = [];
    let currentTurn = null;

    for (const w of words) {
        const spk = w.speaker || (speakers[0] || 'SPEAKER_00');
        const start = Number(w.start) || 0;
        const end = Number(w.end) || start + 0.3;
        const text = w.word || w.text || '';

        if (!currentTurn) {
            currentTurn = { speaker: spk, start, end, text };
        } else if (currentTurn.speaker === spk && start - currentTurn.end < 0.6) {
            currentTurn.end = Math.max(currentTurn.end, end);
            currentTurn.text += ' ' + text;
        } else {
            turns.push(currentTurn);
            currentTurn = { speaker: spk, start, end, text };
        }
    }

    if (currentTurn) turns.push(currentTurn);
    return turns;
}

/**
 * Generates an intelligent multi-camera edit decision list (EDL).
 * Selects Camera A, Camera B, or Wide/Split based on who is speaking.
 *
 * @param {object} params
 * @param {object} params.angleA - Primary angle (e.g. Host or Camera 1)
 * @param {object} params.angleB - Secondary angle (e.g. Guest or Camera 2)
 * @param {object} [params.wideAngle] - Optional Wide 2-shot angle
 * @param {Array} params.words - Diarized word list with timestamps
 * @param {string[]} params.speakers - Speaker IDs e.g. ['SPEAKER_00', 'SPEAKER_01']
 * @param {number} [params.totalDuration] - Total timeline duration
 * @returns {Array<{ start: number, end: number, duration: number, activeAngle: string, speaker: string, reason: string }>}
 */
export function planMultiCamCuts({
    angleA,
    angleB,
    wideAngle = null,
    words = [],
    speakers = ['SPEAKER_00', 'SPEAKER_01'],
    totalDuration = 60,
}) {
    const hostSpeaker = speakers[0] || 'SPEAKER_00';
    const guestSpeaker = speakers[1] || 'SPEAKER_01';

    const rawTurns = extractSpeakerTurns(words, speakers);
    if (rawTurns.length === 0) {
        // Fallback: alternate between angles every 4 seconds if no diarization words exist
        const cuts = [];
        let t = 0;
        let useA = true;
        while (t < totalDuration) {
            const nextT = Math.min(totalDuration, t + 4);
            cuts.push({
                start: Number(t.toFixed(2)),
                end: Number(nextT.toFixed(2)),
                duration: Number((nextT - t).toFixed(2)),
                activeAngle: useA ? (angleA?.id || 'camA') : (angleB?.id || 'camB'),
                speaker: useA ? hostSpeaker : guestSpeaker,
                reason: 'Rhythmic pacing cut',
            });
            t = nextT;
            useA = !useA;
        }
        return cuts;
    }

    const smoothedCuts = [];
    let curTime = 0;

    for (let i = 0; i < rawTurns.length; i++) {
        const turn = rawTurns[i];

        // Check for gap / pause before this turn
        if (turn.start - curTime > PAUSE_TRANSITION_THRESHOLD_S) {
            // Cut to wide shot or hold preceding angle on pause
            smoothedCuts.push({
                start: Number(curTime.toFixed(2)),
                end: Number(turn.start.toFixed(2)),
                duration: Number((turn.start - curTime).toFixed(2)),
                activeAngle: wideAngle ? wideAngle.id : (angleA?.id || 'camA'),
                speaker: 'pause',
                reason: 'Topic transition or breathing pause',
            });
            curTime = turn.start;
        }

        const isHost = turn.speaker === hostSpeaker;
        const activeId = isHost ? (angleA?.id || 'camA') : (angleB?.id || 'camB');

        const cutStart = curTime;
        let cutEnd = Math.max(turn.end, cutStart + MIN_SHOT_DURATION_S);

        // Check if next turn is from the same speaker, merge if close
        while (i + 1 < rawTurns.length && rawTurns[i + 1].speaker === turn.speaker && rawTurns[i + 1].start - cutEnd < 1.0) {
            i++;
            cutEnd = Math.max(cutEnd, rawTurns[i].end);
        }

        smoothedCuts.push({
            start: Number(cutStart.toFixed(2)),
            end: Number(cutEnd.toFixed(2)),
            duration: Number((cutEnd - cutStart).toFixed(2)),
            activeAngle: activeId,
            speaker: turn.speaker,
            reason: isHost ? 'Host speaking' : 'Guest speaking',
        });

        curTime = cutEnd;
    }

    // Fill trailing timeline time
    if (curTime < totalDuration) {
        smoothedCuts.push({
            start: Number(curTime.toFixed(2)),
            end: Number(totalDuration.toFixed(2)),
            duration: Number((totalDuration - curTime).toFixed(2)),
            activeAngle: angleA?.id || 'camA',
            speaker: 'outro',
            reason: 'Closing remarks',
        });
    }

    return smoothedCuts;
}

/**
 * Orchestrates multi-camera alignment and speaker cutting directly into timeline tracks.
 *
 * @param {object} store - useTimelineStore instance
 * @param {object} options
 * @param {string} options.camAId - Clip ID of Camera A
 * @param {string} options.camBId - Clip ID of Camera B
 * @param {string} [options.wideId] - Optional Clip ID of Wide Camera
 * @param {Array} options.diarizedWords - Diarized words
 * @param {string[]} options.speakers - Speaker labels
 */
export async function executeMultiCamAutoCut(store, {
    camAId,
    camBId,
    wideId = null,
    diarizedWords = [],
    speakers = ['SPEAKER_00', 'SPEAKER_01'],
}) {
    const { tracks, updateClip, addTrack, addClip, _saveHistory } = store;
    if (_saveHistory) _saveHistory();

    const allClips = [];
    (tracks || []).forEach(t => (t.clips || []).forEach(c => allClips.push({ ...c, trackId: t.id })));

    let clipA = camAId ? allClips.find(c => c.id === camAId) : null;
    let clipB = camBId ? allClips.find(c => c.id === camBId) : null;
    let clipWide = wideId ? allClips.find(c => c.id === wideId) : null;

    if (!clipA || !clipB) {
        const videoClips = allClips.filter(c => c.type === 'video');
        if (videoClips.length >= 2) {
            clipA = clipA || videoClips[0];
            clipB = clipB || videoClips[1];
            if (!clipWide && videoClips.length >= 3) {
                clipWide = videoClips[2];
            }
        }
    }

    if (!clipA || !clipB) {
        throw new Error('Both Camera A and Camera B clips are required for multi-cam editing.');
    }

    // 1. Sync start offsets via cross-correlation
    const { alignAudioClips } = await import('../utils/audioCrossCorrelation.js');
    try {
        const syncResult = await alignAudioClips(clipA, clipB);
        if (Math.abs(syncResult.offsetSeconds) > 0.002) {
            const trackB = (tracks || []).find(t => (t.clips || []).some(c => c.id === clipB.id));
            if (trackB && updateClip) {
                updateClip(trackB.id, clipB.id, { start: Math.max(0, (clipA.start || 0) + syncResult.offsetSeconds) });
            }
        }
    } catch (e) {
        console.warn('[MultiCamDirector] Waveform alignment skipped, using existing clip placement:', e.message);
    }

    // 2. Generate speaker cuts
    const words = (diarizedWords && diarizedWords.length > 0)
        ? diarizedWords
        : (store.captions || []);

    const detectedSpeakers = (speakers && speakers.length > 0)
        ? speakers
        : (store.speakers?.length ? store.speakers : ['SPEAKER_00', 'SPEAKER_01']);

    const totalDur = Math.max(
        (clipA.start || 0) + (clipA.duration || 60),
        (clipB.start || 0) + (clipB.duration || 60)
    );

    const cuts = planMultiCamCuts({
        angleA: clipA,
        angleB: clipB,
        wideAngle: clipWide,
        words,
        speakers: detectedSpeakers,
        totalDuration: totalDur,
    });

    // 3. Place cuts into a dedicated program track on timeline
    let programTrackId = (tracks || []).find(t => t.name === 'Multicam Program')?.id;
    if (!programTrackId && typeof addTrack === 'function') {
        programTrackId = addTrack('video', { skipHistory: true });
        if (store.renameTrack) store.renameTrack(programTrackId, 'Multicam Program');
    }

    let placedCuts = 0;
    if (programTrackId && typeof addClip === 'function') {
        for (const cut of cuts) {
            const isA = cut.activeAngle === clipA.id || cut.speaker === detectedSpeakers[0];
            const isWide = clipWide && (cut.activeAngle === clipWide.id || cut.speaker === 'pause');
            const sourceClip = isWide ? clipWide : (isA ? clipA : clipB);

            const cutOffset = (sourceClip.offset || 0) + Math.max(0, cut.start - (sourceClip.start || 0));
            const payload = {
                id: `multicam-cut-${Math.random().toString(36).substr(2, 9)}`,
                name: `${sourceClip.name || (isWide ? 'Wide' : (isA ? 'Host (Cam A)' : 'Guest (Cam B)'))} [${cut.reason}]`,
                type: 'video',
                start: cut.start,
                duration: cut.duration,
                offset: Number(cutOffset.toFixed(3)),
                sourceUrl: sourceClip.sourceUrl || sourceClip.url,
                url: sourceClip.url || sourceClip.sourceUrl,
                assetId: sourceClip.assetId,
                speed: sourceClip.speed || 1,
            };
            addClip(programTrackId, payload);
            placedCuts++;
        }
    }

    return {
        success: true,
        cutsCount: cuts.length,
        placedCuts,
        cuts,
        message: `Generated ${cuts.length} multi-camera cuts alternating between Camera A (Host) and Camera B (Guest).`,
    };
}
