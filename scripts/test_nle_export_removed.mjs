// Pins the removal of the unused NLE project-export feature across the UI,
// chat parser, backend route, and product copy.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [modal, home, intentParser, fallbackParser, jobManager, index, packageJson, packageLock] = await Promise.all([
    read('client/src/components/ExportModal.jsx'),
    read('client/src/pages/HomePage.jsx'),
    read('client/src/agent/IntentParser.js'),
    read('client/src/agent/FallbackParser.js'),
    read('client/src/agent/EditJobManager.js'),
    read('index.js'),
    read('package.json'),
    read('package-lock.json'),
]);

assert.doesNotMatch(modal, /nle|NLE|nleExportService/i, 'the export modal should not offer NLE export');
assert.doesNotMatch(home, /id="exports"|href="#exports"|const Exports\s*=/, 'the landing page should not advertise or link to NLE export');
assert.doesNotMatch(intentParser + fallbackParser + jobManager, /nle_export|NLEExportService/i, 'chat should not route NLE export commands');
assert.doesNotMatch(index, /routes\/nleExport|\/api\/export/, 'the backend should not mount the NLE export API');
assert.doesNotMatch(packageJson + packageLock, /@chatoctopus\/timeline/, 'the NLE-only timeline package should be removed');

for (const removedPath of [
    'client/src/services/nleExportService.js',
    'routes/nleExport.js',
]) {
    await assert.rejects(access(new URL(`../${removedPath}`, import.meta.url)), `${removedPath} should be deleted`);
}

for (const locale of ['en', 'fr']) {
    const editorLocale = JSON.parse(await read(`client/src/locales/${locale}/editor.json`));
    const landingLocale = JSON.parse(await read(`client/src/locales/${locale}/landing.json`));
    assert.equal(editorLocale.exportModal.tabNle, undefined, `${locale} export modal should not contain an NLE tab`);
    assert.equal(landingLocale.exports, undefined, `${locale} landing page should not contain the NLE export section`);
}

console.log('NLE export removal checks passed.');
