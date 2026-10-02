// Turn an .srt into word-level {word,start,end} (each cue's time spread over
// its words by length) — how retake fixtures become a transcript.
const fs = require('fs');
function toSec(t) { const [h, m, s] = t.replace(',', '.').split(':'); return (+h) * 3600 + (+m) * 60 + (+s); }
function srtToWords(file) {
    const words = [];
    for (const block of fs.readFileSync(file, 'utf8').split(/\n\s*\n/)) {
        const lines = block.trim().split('\n');
        const time = lines.find(l => l.includes('-->'));
        if (!time) continue;
        const [a, b] = time.split('-->').map(x => toSec(x.trim()));
        const text = lines.slice(lines.indexOf(time) + 1).join(' ').trim();
        const toks = text.split(/\s+/).filter(Boolean);
        const total = toks.reduce((n, t) => n + t.length, 0) || 1;
        let t = a;
        for (const tok of toks) {
            const d = (b - a) * tok.length / total;
            words.push({ word: tok, start: +t.toFixed(3), end: +(t + d).toFixed(3) });
            t += d;
        }
    }
    return words;
}
module.exports = { srtToWords };
