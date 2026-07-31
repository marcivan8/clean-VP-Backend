/**
 * verify-fonts.js
 *
 * Verifies that all caption fonts declared in FONT_SPECS exist on disk
 * under client/public/fonts/, are non-empty (>10KB), and have valid
 * TrueType / OpenType font file headers.
 *
 * Used as a hard Docker build gate (RUN node scripts/verify-fonts.js)
 * to catch missing or corrupt font files at build time.
 */

const fs = require('fs');
const path = require('path');

// Read FONT_SPECS from the exact same registry exportProcessor.js uses
const { FONT_SPECS } = require('../jobs/exportProcessor');

if (!FONT_SPECS || typeof FONT_SPECS !== 'object') {
    console.error('❌ Failed to load FONT_SPECS from jobs/exportProcessor.js');
    process.exit(1);
}

const FONTS_DIR = path.resolve(__dirname, '../client/public/fonts');
let missingCount = 0;
let validCount = 0;

console.log(`🔍 Verifying ${Object.keys(FONT_SPECS).length} caption fonts in ${FONTS_DIR}...`);

for (const [family, spec] of Object.entries(FONT_SPECS)) {
    const filePath = path.join(FONTS_DIR, spec.file);

    if (!fs.existsSync(filePath)) {
        console.error(`  ❌ [${family}] Missing file: ${spec.file}`);
        missingCount++;
        continue;
    }

    const stat = fs.statSync(filePath);
    if (stat.size < 10_000) {
        console.error(`  ❌ [${family}] File too small (${stat.size} bytes — expected >10KB): ${spec.file}`);
        missingCount++;
        continue;
    }

    // Check magic header to ensure it's a real font binary (not an HTML 404 page or woff2)
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);

    // TrueType: 0x00010000 or 'true' (0x74727565)
    // OpenType: 'OTTO' (0x4f54544f)
    const isTrueType = buf.readUInt32BE(0) === 0x00010000 || buf.toString('utf8') === 'true';
    const isOpenType = buf.toString('utf8') === 'OTTO';

    if (!isTrueType && !isOpenType) {
        console.error(`  ❌ [${family}] Invalid font header (${buf.toString('hex')}): ${spec.file}`);
        missingCount++;
        continue;
    }

    validCount++;
}

if (missingCount > 0) {
    console.error(`\n💥 Font verification failed: ${missingCount} font(s) missing or corrupt.`);
    process.exit(1);
}

console.log(`\n✅ Font verification passed: All ${validCount} caption fonts are present and valid.`);
process.exit(0);
