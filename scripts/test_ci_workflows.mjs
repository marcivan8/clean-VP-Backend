// scripts/test_ci_workflows.mjs
//
// R154. CI must not depend on a GitHub release download to install.
//
// ffmpeg-static's postinstall fetches the binary AND its README and LICENSE
// from a GitHub release on every install, and its error handler forgives only
// a 404:
//
//   if (err.statusCode === 404) console.warn(msg)
//   else exitOnError(err)            // process.exit(1)
//
// On 2026-11-05 the binary downloaded fine and a 504 on linux-x64.LICENSE, a
// text file nothing runs, failed `npm ci` and the whole job. The deploy
// workflow installs the same way, so the same blip could have failed a deploy.
//
// install.js exits 0 as soon as it sees a binary in place and FFMPEG_BIN is
// what it reads, so pointing that at the runner's own ffmpeg removes the
// download entirely. Verified locally: with FFMPEG_BIN set and the proxy
// pointed at a dead port it still exits 0, and without it the same run fails.

import assert from 'assert/strict';
import { readFileSync } from 'fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\nci workflows\n');

const WORKFLOWS = [
    // file, the install step that pulls ffmpeg-static
    ['../.github/workflows/ci.yml', '- name: Install dependencies'],
    ['../.github/workflows/deploy.yml', '- name: Install server dependencies'],
];

for (const [file, installStep] of WORKFLOWS) {
    const name = file.split('/').pop();
    const yaml = read(file);

    check(`${name} points ffmpeg-static at the runner's ffmpeg`, () => {
        assert.match(yaml, /FFMPEG_BIN=\$\(command -v ffmpeg\)/,
            'FFMPEG_BIN is what install.js checks before deciding to download');
        assert.match(yaml, /GITHUB_ENV/, 'and it has to reach the later steps in the job');
    });

    check(`${name} sets it BEFORE the install that would download`, () => {
        const envAt = yaml.indexOf('FFMPEG_BIN=$(command -v ffmpeg)');
        // In ci.yml the server job is the second one, so take the LAST
        // matching install step: the client job does not use ffmpeg-static.
        const installAt = yaml.lastIndexOf(installStep);
        assert.ok(envAt > 0, 'the step exists');
        assert.ok(installAt > 0, `${installStep} exists`);
        assert.ok(envAt < installAt,
            'setting it after npm ci would be too late: the postinstall has already run');
    });

    check(`${name} makes sure ffmpeg is actually there`, () => {
        // An unset FFMPEG_BIN silently restores the download, so the step must
        // not depend on the runner image happening to ship ffmpeg.
        assert.match(yaml, /apt-get install -y --no-install-recommends ffmpeg/,
            'it installs ffmpeg when the image does not have it');
        assert.match(yaml, /command -v ffmpeg >\/dev\/null/, 'and only then');
    });

    check(`${name} is still valid YAML shape`, () => {
        assert.ok(!/\t/.test(yaml), 'a tab anywhere makes the whole workflow unparseable');
        assert.match(yaml, /^name: /m);
        assert.match(yaml, /^jobs:$/m);
    });
}

check('the client job is left alone, it does not use ffmpeg-static', () => {
    const clientPkg = JSON.parse(read('../client/package.json'));
    const deps = { ...clientPkg.dependencies, ...clientPkg.devDependencies };
    assert.ok(!('ffmpeg-static' in deps), 'if this ever changes, its job needs the step too');
});

console.log(`\n${n} checks passed\n`);
