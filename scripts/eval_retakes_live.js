// LIVE benchmark of retake detection with the real AI model (costs one call).
// Not part of test:regression. Needs the same env as the server (OpenAI /
// AIProvider keys), e.g. run from the repo root with your .env loaded:
//   node -r dotenv/config scripts/eval_retakes_live.js [fixture.srt] [expected.json]
// Prints what was found, then recall (expected cuts found) and false cuts.
const path = require('path');
const { srtToWords } = require('./lib/srtWords');
const { detectRetakes } = require('../services/retakeDetector');
const { getAIClient, resolveModel } = require('../services/AIProvider');

const srt = process.argv[2] || path.join(__dirname, 'fixtures/retakes_fr.srt');
const expectedFile = process.argv[3] || path.join(__dirname, 'fixtures/retakes_fr.expected.json');

(async () => {
    const ai = getAIClient();
    if (!ai) { console.error('No AI client configured (check your .env).'); process.exit(1); }
    const expected = require(path.resolve(expectedFile));
    const words = srtToWords(srt);
    const t0 = Date.now();
    const r = await detectRetakes(words, {
        duration: expected.duration,
        complete: async (prompt) => (await ai.chat.completions.create({
            model: resolveModel('gpt-4o', 'chat'),
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 3000,
        })).choices[0].message.content,
    });
    console.log(`method: ${r.method}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    for (const g of r.groups) {
        console.log(`• ${g.takes} takes, keep #${g.keptTake}: "${g.kept.text.slice(0, 80)}"`);
        for (const c of g.removed) console.log(`    cut ${c.start.toFixed(2)}–${c.end.toFixed(2)}  "${c.text.slice(0, 70)}"`);
    }
    if (r.rejected.length) console.log('\nrejected:', JSON.stringify(r.rejected));

    const overlap = (c, e) => Math.max(0, Math.min(c.end, e.to) - Math.max(c.start, e.from)) / (e.to - e.from);
    let found = 0;
    console.log('\nexpected:');
    for (const e of expected.cuts) {
        const best = Math.max(0, ...r.cuts.map(c => overlap(c, e)));
        if (best >= 0.8) found++;
        console.log(`  ${best >= 0.8 ? '✓' : '✗'} ${e.from}–${e.to} (${Math.round(best * 100)}% covered) ${e.what}`);
    }
    const falseCuts = r.cuts.filter(c => !expected.cuts.some(e => Math.min(c.end, e.to) - Math.max(c.start, e.from) > 0.2));
    console.log(`\nrecall ${found}/${expected.cuts.length}, false cuts ${falseCuts.length}` +
        (falseCuts.length ? ': ' + falseCuts.map(c => `${c.start.toFixed(1)}–${c.end.toFixed(1)}`).join(', ') : ''));
})().catch((e) => { console.error(e); process.exit(1); });
