// Retake detection (services/retakeDetector.js) on Marc's real French
// recording (scripts/fixtures/retakes_fr.srt): 6 groups of retakes, some
// reworded, some cut off, one false start.
// node scripts/test_retake_detector.js
const assert = require('assert/strict');
const path = require('path');
const { srtToWords } = require('./lib/srtWords');
const R = require('../services/retakeDetector');

const words = srtToWords(path.join(__dirname, 'fixtures/retakes_fr.srt'));
const duration = 129;

// Ground truth: what a human editor removes (keep the best take of each line).
const EXPECTED_CUTS = require('./fixtures/retakes_fr.expected.json').cuts;

// What a good AI reply looks like (quotes deliberately sloppy: no
// punctuation, different case, an accent dropped) — alignment must cope.
const AI_REPLY = { groups: [
    { summary: 'Tony Robbins quote intro', keep: 5, reason: 'last take is complete', attempts: [
        { start: 4.6, text: 'Tony Robbins a dit un jour que' },
        { start: 6.9, text: 'tony robbins a dit' },
        { start: 9.2, text: 'Tony Robbins qui est un' },
        { start: 13.1, text: 'Tony Robbins qui est une personnalite tres connue aujourd\'hui dans le monde du' },
        { start: 19.6, text: 'Tony Robbins qui est une personnalité très connue dans le domaine du' },
        { start: 25.1, text: 'Tony Robbins, qui est une personne qui a été bien connue dans le domaine du développement personnel' } ] },
    { summary: 'le pourquoi', keep: 1, reason: 'second is complete', attempts: [
        { start: 52.9, text: 'Le pourquoi pour moi, c\'était de créer quelque chose' },
        { start: 57.5, text: 'Le pourquoi pour moi c\'était de créer quelque chose qui a de la valeur' } ] },
    { summary: 'ensemble-là', keep: 1, reason: 'identical, keep last', attempts: [
        { start: 82.2, text: 'Et de cet ensemble-là, elle est Vibed.' },
        { start: 90.4, text: 'Et de cet ensemble-là, elle est Vibed.' } ] },
    { summary: 'tout le monde a Vibed', keep: 1, reason: 'fuller', attempts: [
        { start: 104.4, text: 'Et voilà, aujourd\'hui, tout le monde a Vibed disponible.' },
        { start: 108.1, text: 'Et aujourd\'hui, tout le monde a Vibed et l\'utilise d\'ailleurs' } ] },
    { summary: 'focalise', keep: 1, reason: 'false start', attempts: [
        { start: 117.4, text: 'Alors focalise' },
        { start: 118.9, text: 'Alors aujourd\'hui, focalise-toi sur le pourquoi et le quoi.' } ] },
    { summary: 'le comment', keep: 1, reason: 'last', attempts: [
        { start: 122.8, text: 'Et le comment se chargera du reste.' },
        { start: 125.0, text: 'Et le comment viendra tout seul.' } ] },
] };

function covers(cuts, exp, tol = 0.35) {
    return cuts.some(c => Math.abs(c.start - exp.from) <= tol && Math.abs(c.end - exp.to) <= tol);
}

(async () => {
    // 1. Prompt: transcript lines + restart hints the AI can use.
    const prompt = R.buildPrompt(words, { language: 'fr' });
    assert.match(prompt, /\[4\.6s\] Tony Robbins a dit un jour que\.\.\./);
    assert.match(prompt, /keep the LAST one/);
    const hints = R.findRestarts(words);
    for (const t of [4.6, 6.9, 9.2, 13.1, 19.6, 52.9, 82.2, 122.8]) {
        assert.ok(hints.some(h => Math.abs(h.at - t) < 0.5), `restart hint near ${t}s`);
    }
    assert.ok(!hints.some(h => Math.abs(h.at - 47.7) < 0.5), 'no hint for "…le pourquoi." (ends a sentence)');
    console.log(`✓ prompt has the transcript in lines + ${hints.length} restart hints (incl. all openings)`);

    // 2. With a good AI reply: every expected cut, word-accurate, kept takes intact.
    const r = await R.detectRetakes(words, { duration, complete: async () => JSON.stringify(AI_REPLY) });
    assert.equal(r.method, 'ai');
    for (const exp of EXPECTED_CUTS) assert.ok(covers(r.cuts, exp), `cut ${exp.from}–${exp.to}: ${exp.what}\n got ${JSON.stringify(r.cuts)}`);
    assert.equal(r.cuts.length, EXPECTED_CUTS.length);
    assert.equal(r.groups[0].takes, 6); assert.equal(r.groups[0].keptTake, 6);
    assert.match(r.groups[0].kept.text, /^Tony Robbins, qui est une personne/);
    const kept = [25.06, 57.54, 90.38, 108.09, 118.93, 125.02];
    for (const k of kept) assert.ok(r.activeSegments.some(s => s.start <= k + 0.05 && s.end > k + 0.5), `kept take at ${k}s stays`);
    const removed = r.cuts.reduce((s, c) => s + c.end - c.start, 0);
    console.log(`✓ AI reply → ${r.cuts.length}/6 retake groups cut on word boundaries (${removed.toFixed(1)}s removed), best takes kept`);

    // 3. Guards: unknown quotes, kept take missing, absurd cuts → ignored.
    const bad = await R.detectRetakes(words, { duration, complete: async () => ({ groups: [
        { attempts: [{ start: 10, text: 'words that were never said' }, { start: 12, text: 'nor these' }], keep: 1 },
        { attempts: [{ start: 4.6, text: 'Tony Robbins a dit un jour que' }], keep: 3 },
        { attempts: [{ start: 4.6, text: 'Tony Robbins a dit un jour que' }, { start: 125.0, text: 'Et le comment viendra tout seul.' }], keep: 1 },
    ] }) });
    assert.equal(bad.cuts.length, 0, 'nothing cut from bad replies');
    assert.equal(bad.rejected.length, 3);
    console.log('✓ guards: unmatched quotes, missing kept take, 2-minute span → no cut');

    // 4. AI reply that is not JSON → exact-repeat fallback only (never guesses rewordings).
    const fb = await R.detectRetakes(words, { duration, complete: async () => 'sorry, no' });
    assert.match(fb.method, /^fallback-exact/);
    assert.ok(covers(fb.cuts, EXPECTED_CUTS[2]), 'exact repeat "Et de cet ensemble-là, elle est Vibed." still caught');
    assert.ok(!fb.cuts.some(c => c.start > 40 && c.end < 52), 'no false cut around "…le pourquoi."');
    console.log(`✓ no AI → exact repeats only (${fb.cuts.length} cut(s)), no false alarms`);

    // 5. Alignment on its own.
    const toks = words.map(w => R.norm(w.word));
    const a = R.alignQuote(words, toks, 'ALORS FOCALISE', 117.5);
    assert.equal(words[a.from].word, 'Alors'); assert.equal(words[a.to].word, 'focalise...');
    assert.equal(R.alignQuote(words, toks, 'Alors focalise', 30), null, 'far from its timestamp → not matched');
    console.log('✓ quote alignment: case/punctuation/accents tolerant, time-bounded');

    console.log('\nALL RETAKE-DETECTOR CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
