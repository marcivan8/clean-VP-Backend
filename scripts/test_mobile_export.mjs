// Mobile export sheet must not pre-pick a platform preset: a preset fixes the
// frame size on the server (PLATFORM_PRESETS), overriding the project's own
// aspect ratio. It used to default to "YouTube" (1920×1080) from the editor's
// initial '16:9', so phone videos exported landscape whatever their format.
// node scripts/test_mobile_export.mjs
import assert from 'assert/strict';
import { readFileSync } from 'fs';

const sheet = readFileSync(new URL('../client/src/components/MobileExportSheet.jsx', import.meta.url), 'utf8');
const init = sheet.match(/const \[settings, setSettings\] = useState\(([\s\S]*?)\);\n/);
assert.ok(init, 'settings state found');
assert.match(init[1], /platform:\s*null/, 'no platform by default');
assert.doesNotMatch(init[1], /youtube|tiktok/, 'no preset derived from the aspect ratio at mount');
console.log('✓ mobile export defaults to the project format (no platform preset)');

const proc = readFileSync(new URL('../jobs/exportProcessor.js', import.meta.url), 'utf8');
assert.match(proc, /const resolvedDims = platform \|\| getResolutionDimensions\(settings\.aspectRatio, settings\.resolution\);/,
    'server: no platform → frame from the project aspect ratio');
const ide = readFileSync(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8');
assert.match(ide, /aspectRatio: projectAspectRatio \|\| '16:9'/, 'client sends the project aspect ratio');
console.log('✓ server sizes the frame from the project aspect ratio when no platform is picked');
console.log('\nALL MOBILE-EXPORT CHECKS PASSED');
