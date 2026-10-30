#!/usr/bin/env node
// Regression for subtle Roka progress UI on desktop and mobile.
'use strict';

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const mobile = read('../client/src/components/MobileAIBar.jsx');
const desktop = read('../client/src/components/Assistant/ReasoningPanel.jsx');
const indicator = read('../client/src/components/Assistant/RokaWorkingIndicator.jsx');
const css = read('../client/src/index.css');

const checks = [
    ['indicator renders three animated 3D dots',
        /\[0, 1, 2\]\.map/.test(indicator) && /roka-working-dot/.test(indicator) && /perspective: 40px/.test(css)],
    ['indicator announces a localized status accessibly',
        /role=\{label \? 'status' : undefined\}/.test(indicator) && /aria-label=\{label \|\| undefined\}/.test(indicator)],
    ['animation respects reduced-motion preference',
        /prefers-reduced-motion:\s*reduce/.test(css) && /\.roka-working-dot\s*\{\s*animation:\s*none/.test(css)],
    ['mobile chat suppresses raw step logs',
        /new Set\(\[[^\]]*'step'/.test(mobile) === false && /visibleLogs = logs\.filter\(l => LOG_TYPES\.has\(l\.type\)/.test(mobile)],
    ['desktop feed suppresses raw step logs',
        /feedItems\.filter\(item => !\(item\._kind === 'log' && item\.type === 'step'\)\)/.test(desktop)],
    ['desktop working state uses compact status and preserves cancel',
        /<RokaWorkingIndicator label=\{t\('assistant\.rokaWorkingNoEllipsis'\)\}/.test(desktop)
        && /onClick=\{cancelRun\}/.test(desktop)
        && !/t\('assistant\.stepsHint'\)/.test(desktop)],
    ['mobile working state uses the same indicator',
        /<RokaWorkingIndicator label=\{t\('assistant\.rokaWorkingNoEllipsis'\)\}/.test(mobile)],
];

let failures = 0;
for (const [label, pass] of checks) {
    console.log(`${pass ? '✓' : '✗'} ${label}`);
    if (!pass) failures++;
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll Roka progress UI checks passed');
process.exit(failures ? 1 : 0);
