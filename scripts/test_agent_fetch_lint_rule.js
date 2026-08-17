#!/usr/bin/env node
/**
 * Regression: TD3 — client/src/agent/ has shipped an un-authenticated raw
 * fetch() three separate times (EditPlanner.js, IntentParser.js,
 * AgentOrchestrator.js all carry a "FIX: was fetch(...) without auth — 401 in
 * production" comment). The convention "always use authFetch()" was
 * documentation-only, enforced by nothing. client/eslint.config.js now adds a
 * `no-restricted-syntax` rule, scoped to `src/agent/**`, that fails the lint
 * build on any bare fetch()/window.fetch()/globalThis.fetch() call.
 *
 * This exercises the REAL rule through ESLint's own Node API (client's local
 * `eslint` package, loading client/eslint.config.js exactly as `npx eslint`
 * would) rather than regex-matching the config source — a config typo that
 * silently no-ops the rule would pass a source-regex check but must fail this.
 *
 * Run: node scripts/test_agent_fetch_lint_rule.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');

async function main() {
    let ESLint;
    try {
        ({ ESLint } = require(path.join(CLIENT_DIR, 'node_modules', 'eslint')));
    } catch (err) {
        console.log(`  ✗ could not load client's eslint package — ${err.message}`);
        console.log(`\n${'─'.repeat(60)}\n0 passed, 1 failed (setup)`);
        process.exit(1);
    }

    const eslint = new ESLint({ cwd: CLIENT_DIR });

    section('1 · Bare fetch() inside src/agent/ is rejected');
    {
        const code = [
            "export async function bad() {",
            "    const res = await fetch('/api/ai/generate-plan', { method: 'POST' });",
            "    return res.json();",
            "}",
        ].join('\n');
        const results = await eslint.lintText(code, { filePath: path.join(CLIENT_DIR, 'src/agent/__lint_check_bad.js') });
        const messages = results[0]?.messages || [];
        check('produces a no-restricted-syntax error',
            messages.some(m => m.ruleId === 'no-restricted-syntax'),
            `messages: ${JSON.stringify(messages.map(m => m.ruleId))}`);
        check('the error message points to authFetch()',
            messages.some(m => /authFetch/.test(m.message)));
    }

    section('2 · window.fetch()/globalThis.fetch() inside src/agent/ is rejected too');
    {
        const code = [
            "export async function bad() {",
            "    const res = await window.fetch('/api/ai/generate-plan');",
            "    return res.json();",
            "}",
        ].join('\n');
        const results = await eslint.lintText(code, { filePath: path.join(CLIENT_DIR, 'src/agent/__lint_check_window.js') });
        const messages = results[0]?.messages || [];
        check('window.fetch() is also flagged',
            messages.some(m => m.ruleId === 'no-restricted-syntax'));
    }

    section('3 · authFetch() itself is NOT flagged (the rule targets fetch, not its wrapper)');
    {
        const code = [
            "import { authFetch } from '../utils/authFetch.js';",
            "export async function good() {",
            "    const res = await authFetch('/api/ai/generate-plan', { method: 'POST' });",
            "    return res.json();",
            "}",
        ].join('\n');
        const results = await eslint.lintText(code, { filePath: path.join(CLIENT_DIR, 'src/agent/__lint_check_good.js') });
        const messages = results[0]?.messages || [];
        check('no no-restricted-syntax error for authFetch()',
            !messages.some(m => m.ruleId === 'no-restricted-syntax'),
            `messages: ${JSON.stringify(messages.map(m => m.ruleId))}`);
    }

    section('4 · The rule is SCOPED to src/agent/ — the same raw fetch() elsewhere is untouched');
    {
        const code = [
            "export async function outside() {",
            "    return fetch('/api/whatever');",
            "}",
        ].join('\n');
        const results = await eslint.lintText(code, { filePath: path.join(CLIENT_DIR, 'src/__lint_check_outside.js') });
        const messages = results[0]?.messages || [];
        check('a raw fetch() outside src/agent/ does not trigger this rule',
            !messages.some(m => m.ruleId === 'no-restricted-syntax'),
            `messages: ${JSON.stringify(messages.map(m => m.ruleId))}`);
    }

    section('5 · Every file currently in src/agent/ actually passes the rule (no violations shipped)');
    {
        const agentDir = path.join(CLIENT_DIR, 'src/agent');
        const files = fs.readdirSync(agentDir).filter(f => /\.(js|jsx)$/.test(f));
        check('at least one file was found to check', files.length > 0);
        const results = await eslint.lintFiles([path.join(agentDir, '**/*.{js,jsx}')]);
        const violations = results.flatMap(r =>
            r.messages.filter(m => m.ruleId === 'no-restricted-syntax').map(m => `${path.relative(CLIENT_DIR, r.filePath)}:${m.line}`)
        );
        check('no shipped file in src/agent/ contains a raw fetch()',
            violations.length === 0,
            violations.length ? `violations: ${violations.join(', ')}` : undefined);
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Test script crashed:', err);
    process.exit(1);
});
