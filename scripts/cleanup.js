const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
const PROXIES_DIR = path.join(UPLOADS_DIR, 'proxies');
const EXPORTS_DIR = path.join(UPLOADS_DIR, 'exports');

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function cleanDirectory(directory) {
    if (!fs.existsSync(directory)) return;

    const items = fs.readdirSync(directory);

    for (const item of items) {
        const itemPath = path.join(directory, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
            cleanDirectory(itemPath);
            // Remove empty directories (except the base dirs)
            if (fs.readdirSync(itemPath).length === 0) {
                fs.rmdirSync(itemPath);
                console.log(`[Cleanup] Removed empty directory: ${itemPath}`);
            }
        } else {
            const age = Date.now() - stats.mtimeMs;
            if (age > MAX_AGE_MS) {
                fs.unlinkSync(itemPath);
                console.log(`[Cleanup] Deleted old file: ${itemPath}`);
            }
        }
    }
}

function runCleanup() {
    console.log(`[Cleanup] Starting cleanup job at ${new Date().toISOString()}`);
    cleanDirectory(TEMP_DIR);
    cleanDirectory(PROXIES_DIR);
    cleanDirectory(EXPORTS_DIR);
    console.log(`[Cleanup] Finished cleanup job`);
}

// Run if called directly
if (require.main === module) {
    runCleanup();
}

module.exports = runCleanup;
