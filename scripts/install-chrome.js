const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
    // Resolve puppeteer-core inside @revideo/renderer
    const revideoPath = require.resolve('@revideo/renderer');
    const revisionsPath = require.resolve('puppeteer-core/internal/revisions.js', { paths: [revideoPath] });
    
    // Get the exact Chrome version
    const { PUPPETEER_REVISIONS } = require(revisionsPath);
    const chromeVersion = PUPPETEER_REVISIONS.chrome || PUPPETEER_REVISIONS['chrome-headless-shell'];
    
    if (!chromeVersion) {
        throw new Error('Could not determine Chrome version from puppeteer-core');
    }

    console.log(`[Install-Chrome] @revideo/renderer expects Chrome v${chromeVersion}`);

    const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(require('os').homedir(), '.cache', 'puppeteer');
    const chromePath = path.join(cacheDir, 'chrome', `linux-${chromeVersion}`);

    if (fs.existsSync(chromePath) || fs.existsSync(path.join(cacheDir, 'chrome', `mac-${chromeVersion}`))) {
        console.log(`[Install-Chrome] Chrome ${chromeVersion} is already installed at ${cacheDir}. Skipping.`);
        process.exit(0);
    }

    // Install the exact Chrome version using the global/npx @puppeteer/browsers
    console.log(`[Install-Chrome] Installing Chrome ${chromeVersion} to ${cacheDir}...`);
    execSync(`npx @puppeteer/browsers install chrome@${chromeVersion} --path ${cacheDir}`, { stdio: 'inherit' });
    
    console.log('[Install-Chrome] Success!');

} catch (err) {
    console.error('[Install-Chrome] Failed:', err);
    process.exit(1);
}
