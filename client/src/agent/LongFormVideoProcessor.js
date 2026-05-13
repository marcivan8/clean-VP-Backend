/**
 * LongFormVideoProcessor.js
 * =========================
 * Orchestrates AI-assisted editing of long-form video (> 5 min).
 *
 * Problems with naive long-form editing:
 *  1. Single API calls time out on 30-60 min videos.
 *  2. The transcript is too large for one NLP call.
 *  3. The timeline store gets populated with hundreds of clips and slows down.
 *  4. Progress reporting is absent, so the UI looks frozen.
 *
 * This processor solves all four by:
 *  - Splitting work into chapters/chunks processed sequentially
 *  - Streaming progress back to the caller
 *  - Using the circuit-breaker spacyClient (works even when spaCy is down)
 *  - Building a compact "edit decision list" (EDL) before mutating the store
 */

import { authFetch } from '../utils/authFetch.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { mediaExecutionEngine } from './MediaExecutionEngine.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const CHUNK_SECONDS     = 300;   // 5-minute chunks for transcript analysis
const MAX_CLIPS_PER_EDL = 200;   // safety cap — avoids store meltdown
const API_TIMEOUT_MS    = 90_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} EditChunk
 * @property {number} start  - seconds
 * @property {number} end    - seconds
 * @property {object[]} sentences
 * @property {number} avgHighlight
 */

/**
 * @typedef {Object} EditDecision
 * @property {number} start
 * @property {number} end
 * @property {number} score
 * @property {string} reason
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

/** Merge contiguous / overlapping decisions into fewer, longer clips. */
function mergeDecisions(decisions, gapToleranceSec = 2) {
  if (decisions.length === 0) return [];
  const sorted = [...decisions].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur  = sorted[i];
    if (cur.start - last.end <= gapToleranceSec) {
      last.end   = Math.max(last.end, cur.end);
      last.score = Math.max(last.score, cur.score);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Convert a flat transcript (with word-level timestamps) into 5-min chunks. */
function chunkTranscript(words, chunkSec = CHUNK_SECONDS) {
  const chunks = [];
  let buf = [];
  let chunkStart = 0;

  for (const w of words) {
    if (w.start >= chunkStart + chunkSec && buf.length > 0) {
      chunks.push({ start: chunkStart, end: w.start, words: buf });
      chunkStart = w.start;
      buf = [];
    }
    buf.push(w);
  }
  if (buf.length > 0) {
    chunks.push({ start: chunkStart, end: buf[buf.length - 1].end, words: buf });
  }
  return chunks;
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class LongFormVideoProcessor {
  /**
   * @param {object} options
   * @param {function} options.onProgress   - (pct: number, msg: string) => void
   * @param {function} options.onChunkDone  - (chunk: EditChunk) => void
   * @param {AbortSignal} options.signal
   */
  constructor(options = {}) {
    this.onProgress  = options.onProgress  || (() => {});
    this.onChunkDone = options.onChunkDone || (() => {});
    this.signal      = options.signal      || null;
  }

  _aborted() { return this.signal?.aborted ?? false; }

  _progress(pct, msg) {
    this.onProgress(clamp(pct, 0, 100), msg);
    console.log(`[LongFormVideoProcessor] ${pct.toFixed(0)}% — ${msg}`);
  }

  // ── Step 1: Fetch & validate transcript ─────────────────────────────────────

  async fetchTranscript(videoId) {
    this._progress(5, 'Fetching transcript…');
    const controller = new AbortController();
    if (this.signal) this.signal.addEventListener('abort', () => controller.abort());
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await authFetch(`/api/transcripts/${videoId}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Transcript fetch failed: ${res.status}`);
      return await res.json();   // { words: [{word, start, end, confidence}], text: string }
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Cancelled');
      throw err;
    }
  }

  // ── Step 2: Analyze transcript chunks via spacyClient (or fallback) ─────────

  async analyzeChunks(transcript) {
    const { words } = transcript;
    const chunks = chunkTranscript(words);
    const total  = chunks.length;
    this._progress(10, `Analyzing transcript in ${total} chunk(s)…`);

    const analyzed = [];

    for (let i = 0; i < chunks.length; i++) {
      if (this._aborted()) throw new Error('Cancelled');

      const chunk   = chunks[i];
      const text    = chunk.words.map(w => w.word).join(' ');
      const pct     = 10 + ((i + 1) / total) * 35;

      this._progress(pct, `Analyzing chunk ${i + 1}/${total} (${Math.floor(chunk.start / 60)}m–${Math.floor(chunk.end / 60)}m)…`);

      // Call backend which proxies to spacyClient (with circuit-breaker + fallback)
      let sentences;
      try {
        const res = await authFetch('/api/nlp/analyze-transcript', {
          method: 'POST',
          body: JSON.stringify({
            transcript: text,
            video_duration_seconds: chunk.end - chunk.start,
          }),
          signal: this.signal,
        });
        if (!res.ok) throw new Error(`NLP error: ${res.status}`);
        const data = await res.json();
        sentences = data.sentences;
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Cancelled');
        // Network-level failure — use empty sentences so we can still proceed
        console.warn(`[LongFormVideoProcessor] NLP chunk ${i} failed, skipping:`, err.message);
        sentences = [];
      }

      // Map sentence highlight scores back to absolute timestamps.
      // We distribute sentence positions linearly across the chunk duration.
      const chunkDuration = chunk.end - chunk.start;
      const mapped = sentences.map((s, si) => {
        const relPos  = sentences.length > 1 ? si / (sentences.length - 1) : 0;
        const absTime = chunk.start + relPos * chunkDuration;
        return { ...s, absoluteTime: absTime };
      });

      const avgHighlight = mapped.length
        ? mapped.reduce((sum, s) => sum + s.highlight_score, 0) / mapped.length
        : 0;

      const analyzedChunk = {
        start: chunk.start,
        end:   chunk.end,
        sentences: mapped,
        avgHighlight,
      };

      analyzed.push(analyzedChunk);
      this.onChunkDone(analyzedChunk);
    }

    return analyzed;
  }

  // ── Step 3: Build edit decision list ─────────────────────────────────────────

  buildEDL(analyzedChunks, options = {}) {
    this._progress(50, 'Building edit decision list…');

    const {
      highlightThreshold = 0.35,
      minClipSec         = 3,
      maxClipSec         = 30,
      maxTotalSec        = null,   // null = no cap
    } = options;

    const decisions = [];

    for (const chunk of analyzedChunks) {
      for (const s of chunk.sentences) {
        if (s.highlight_score < highlightThreshold) continue;

        // Give each high-scoring sentence a clip window around it
        const halfWindow = clamp(s.highlight_score * maxClipSec / 2, minClipSec / 2, maxClipSec / 2);
        const start = Math.max(0, s.absoluteTime - halfWindow);
        const end   = s.absoluteTime + halfWindow;

        decisions.push({
          start,
          end,
          score:  s.highlight_score,
          reason: s.is_cta ? 'cta' : s.is_question ? 'question' : 'emotion',
        });
      }
    }

    let merged = mergeDecisions(decisions);

    // Enforce max total duration if requested
    if (maxTotalSec) {
      let total = 0;
      merged = merged.filter(d => {
        const dur = d.end - d.start;
        if (total + dur > maxTotalSec) return false;
        total += dur;
        return true;
      });
    }

    // Safety cap — keep the highest-scoring clips
    if (merged.length > MAX_CLIPS_PER_EDL) {
      merged = merged
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_CLIPS_PER_EDL)
        .sort((a, b) => a.start - b.start);
    }

    return merged;
  }

  // ── Step 4: Apply EDL to timeline store ───────────────────────────────────────

  applyEDL(edl) {
    this._progress(75, `Applying ${edl.length} clip(s) to timeline…`);

    const store      = useTimelineStore.getState();
    const videoTrack = store.tracks?.find(t => t.type === 'video');

    if (!videoTrack || videoTrack.clips.length === 0) {
      throw new Error('No video track or source clip found in timeline');
    }

    const baseClip = videoTrack.clips[0];

    // Remove existing clips
    for (const clip of [...videoTrack.clips]) {
      store.removeClip(videoTrack.id, clip.id);
    }

    // Insert EDL clips in chronological order
    let cursor = 0;
    for (let i = 0; i < edl.length; i++) {
      const d        = edl[i];
      const duration = d.end - d.start;

      store.addClip(videoTrack.id, {
        ...baseClip,
        id:       `clip_lf_${Date.now()}_${i}`,
        start:    cursor,
        duration,
        offset:   d.start,
        name:     `${baseClip.name || 'Clip'} (${Math.floor(d.start / 60)}m${String(Math.floor(d.start % 60)).padStart(2, '0')}s)`,
      });

      cursor += duration;
    }

    this._progress(90, 'Timeline updated');
    return edl.length;
  }

  // ── Main entry point ──────────────────────────────────────────────────────────

  /**
   * process(videoId, options)
   * Full pipeline: fetch → analyze → EDL → apply.
   *
   * @param {string} videoId
   * @param {object} options  - highlightThreshold, minClipSec, maxClipSec, maxTotalSec
   * @returns {Promise<{ clipsCreated: number, edl: EditDecision[] }>}
   */
  async process(videoId, options = {}) {
    try {
      const transcript = await this.fetchTranscript(videoId);
      if (this._aborted()) throw new Error('Cancelled');

      const analyzedChunks = await this.analyzeChunks(transcript);
      if (this._aborted()) throw new Error('Cancelled');

      const edl = this.buildEDL(analyzedChunks, options);

      if (edl.length === 0) {
        this._progress(100, 'No highlight moments found — try lowering the threshold');
        return { clipsCreated: 0, edl: [] };
      }

      const clipsCreated = this.applyEDL(edl);
      this._progress(100, `Done — created ${clipsCreated} clip(s) from ${Math.floor(transcript.words?.length ?? 0)} words`);

      return { clipsCreated, edl };

    } catch (err) {
      if (err.message === 'Cancelled') {
        console.log('[LongFormVideoProcessor] Processing cancelled');
        return { clipsCreated: 0, edl: [], cancelled: true };
      }
      throw err;
    }
  }

  /**
   * processWithCommands(commands, options)
   * Alternative entry point: run a pre-built MediaExecutionEngine command list
   * for long-form videos, with progress piped back through onProgress.
   */
  async processWithCommands(commands, options = {}) {
    this._progress(0, 'Queuing execution commands…');

    return new Promise((resolve, reject) => {
      const jobId = mediaExecutionEngine.enqueue(commands, {
        timeout: options.timeout || 600_000,   // 10-min cap for long videos
        onProgress: ({ progress }) => this._progress(progress, 'Processing…'),
        onStateChange: ({ toState }) => {
          if (toState === 'DONE')      resolve({ success: true,  jobId });
          if (toState === 'FAILED')    reject(new Error('Execution job failed'));
          if (toState === 'CANCELLED') resolve({ success: false, jobId, cancelled: true });
        },
        onError: ({ error }) => reject(new Error(error)),
      });

      if (this.signal) {
        this.signal.addEventListener('abort', () => {
          mediaExecutionEngine.cancel(jobId);
        });
      }
    });
  }
}

export default LongFormVideoProcessor;
