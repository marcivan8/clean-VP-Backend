// scripts/test_docker_client_context.mjs — the frontend Docker stage copies
// only client/ into /app/client, so any client import that reaches OUTSIDE
// client/ must be (1) sent in the build context (.dockerignore) and (2)
// copied to the same relative place (Dockerfile). The deploy broke once on
// exactly this: client/src/index.css imports "../../Vibed Design System/
// styles.css", the folder was ignored and never copied, and the build failed
// with ENOENT while every local build passed.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

// Every client source file and the import specifiers that leave client/.
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(css|js|jsx|ts|tsx)$/.test(e.name)) files.push(p);
    }
})(path.join(ROOT, 'client/src'));
const clientDir = path.join(ROOT, 'client');
const outside = new Map(); // repo-relative target → importing file
for (const f of files) {
    // Comments are skipped: JSDoc type hints like {import('../../../server/x')}
    // are not imports and never reach the bundler.
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(/(?:from\s+|@import\s+|import\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(f), m[1]);
        if (!target.startsWith(clientDir + path.sep)) outside.set(path.relative(ROOT, target), path.relative(ROOT, f));
    }
}
const tops = [...new Set([...outside.keys()].map(t => t.split(path.sep)[0]))];
console.log(`\nclient imports from outside client/: ${tops.join(', ') || 'none'}`);

const dockerfile = read('Dockerfile');
// The frontend stage: from its FROM line up to the next stage's FROM.
const stageStart = dockerfile.search(/^FROM .* AS frontend-build/m);
const nextStage = dockerfile.slice(stageStart + 1).search(/^FROM /m);
const frontStage = nextStage < 0 ? dockerfile.slice(stageStart) : dockerfile.slice(stageStart, stageStart + 1 + nextStage);
const ignore = read('.dockerignore').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
for (const top of tops) {
    ok(frontStage.includes(`"${top}/"`) || frontStage.includes(`COPY ${top}/`), `the frontend stage copies "${top}/" next to /app/client`);
    ok(frontStage.includes(`/app/${top}/`), `to /app/${top}/, where ../../ from /app/client/src points`);
    for (const [target, from] of outside) {
        if (!target.startsWith(top + path.sep)) continue;
        ok(fs.existsSync(path.join(ROOT, target)), `${target} exists (imported by ${from})`);
        // Same rule Docker applies: the LAST matching pattern wins.
        const parts = target.split(path.sep);
        let included = true;
        for (const raw of ignore) {
            const neg = raw.startsWith('!');
            const pat = (neg ? raw.slice(1) : raw).replace(/\/$/, '');
            const re = new RegExp('^' + pat.split('/').map(seg => seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('/') + '(/|$)');
            for (let i = 1; i <= parts.length; i++) {
                if (re.test(parts.slice(0, i).join('/'))) { included = neg; break; }
            }
        }
        ok(included, `${target} is sent in the build context (.dockerignore)`);
    }
}
ok(!ignore.includes('Vibed Design System/'), 'the design system folder is no longer ignored wholesale');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('DOCKER CLIENT CONTEXT OK');
