/**
 * FontInstaller.ts
 *
 * Ensures fonts are available to Chrome inside the Lambda execution environment,
 * then returns @font-face CSS using base64 data URLs.
 *
 * Base64 data URLs are used instead of file:// URLs because the Revideo scene
 * runs in a Chromium page served from localhost — file:// references are blocked
 * by Chrome's cross-origin policy in that context. Embedding fonts as base64
 * avoids all cross-origin and file-access restrictions entirely.
 *
 * Resolution order per font:
 *   1. /opt/fonts/{file}       — Lambda Layer (fastest, always present if layer is attached)
 *   2. /tmp/vibed-fonts/{file} — warm-start disk cache (persists across invocations)
 *   3. jsDelivr CDN download   — cold start fallback; result cached in /tmp for warm starts
 *
 * Never throws — a font that can't be resolved is skipped with a warning, and
 * Chrome falls back to its built-in sans-serif. The render still succeeds, just
 * with the wrong typeface.
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as https from 'https';
import { FONT_BY_NAME } from './fontRegistry';

// Lambda filesystem paths
const LAYER_FONT_DIR = '/opt/fonts';       // Lambda Layer — read-only, always mounted
const TMP_FONT_DIR   = '/tmp/vibed-fonts'; // Writable; survives across warm invocations

// Same CDN as exportProcessor.js — reliable, no auth, no rate limits
const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/npm/@fontsource';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** Returns true if path exists and is a plausible font file (> 5KB). */
function fileOk(filePath: string): boolean {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).size > 5_000;
    } catch {
        return false;
    }
}

/**
 * Downloads a URL to a local file, following up to one redirect.
 * Rejects on HTTP error or network failure.
 */
function downloadFile(url: string, dest: string, redirectsLeft = 2): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const cleanup = (err: Error) => {
            file.close();
            try { fs.unlinkSync(dest); } catch { /* ignore */ }
            reject(err);
        };

        https.get(url, (res) => {
            // Follow redirects
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
                file.close();
                try { fs.unlinkSync(dest); } catch { /* ignore */ }
                downloadFile(res.headers.location, dest, redirectsLeft - 1).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                cleanup(new Error(`HTTP ${res.statusCode} fetching ${url}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
            file.on('error', cleanup);
        }).on('error', cleanup);
    });
}

// ── FontInstaller ─────────────────────────────────────────────────────────────

export class FontInstaller {
    constructor() {
        // Ensure writable font cache exists (idempotent across warm starts)
        ensureDir(TMP_FONT_DIR);
        // Chrome needs writable HOME for its profile/cache dirs in Lambda
        process.env.HOME = '/tmp';
    }

    /**
     * Resolves a font file to a local disk path, downloading if necessary.
     * Returns null if the font cannot be obtained.
     */
    private async resolveFontPath(
        spec: { file: string; slug: string; weight: number; subset: string }
    ): Promise<string | null> {
        // 1. Lambda Layer (zero cost, always present when layer is attached)
        const layerPath = path.join(LAYER_FONT_DIR, spec.file);
        if (fileOk(layerPath)) {
            return layerPath;
        }

        // 2. /tmp warm-start cache
        const tmpPath = path.join(TMP_FONT_DIR, spec.file);
        if (fileOk(tmpPath)) {
            return tmpPath;
        }

        // 3. Download from jsDelivr and cache in /tmp
        const url = `${JSDELIVR_BASE}/${spec.slug}@4/files/${spec.slug}-${spec.subset}-${spec.weight}-normal.ttf`;
        console.log(`[FontInstaller] Downloading ${spec.file} from ${url}`);
        try {
            await downloadFile(url, tmpPath);
            if (fileOk(tmpPath)) {
                console.log(`[FontInstaller] ✅ Downloaded ${spec.file} (${Math.round(fs.statSync(tmpPath).size / 1024)}KB)`);
                return tmpPath;
            }
            console.warn(`[FontInstaller] ⚠️  Download succeeded but file is too small: ${tmpPath}`);
        } catch (err: any) {
            console.warn(`[FontInstaller] ⚠️  Failed to download ${spec.file}: ${err.message}`);
        }
        return null;
    }

    /**
     * Ensures all requested font families are available and returns @font-face CSS
     * with base64 data URLs ready for injection into the Revideo scene.
     *
     * Using base64 embeds the font data directly in the CSS — Chrome loads it
     * without any network request or file:// access, avoiding cross-origin issues.
     *
     * Never throws. Unknown or unavailable fonts are skipped with a console warning.
     */
    async ensureFonts(fontNames: string[]): Promise<string> {
        if (fontNames.length === 0) return '';

        const unique = [...new Set(fontNames)];
        console.log(`[FontInstaller] Resolving fonts: ${unique.join(', ')}`);

        const declarations: string[] = [];

        await Promise.all(unique.map(async (fontName) => {
            const entry = FONT_BY_NAME[fontName.toLowerCase()];
            if (!entry) {
                console.warn(`[FontInstaller] Unknown font "${fontName}" — Chrome will fall back to system sans-serif`);
                return;
            }

            let fontPath: string | null = null;
            try {
                fontPath = await this.resolveFontPath(entry);
            } catch (err: any) {
                console.warn(`[FontInstaller] Error resolving "${entry.name}": ${err.message}`);
            }

            if (!fontPath) {
                console.warn(`[FontInstaller] Could not obtain "${entry.name}" — skipping`);
                return;
            }

            // Read font file and encode as base64 data URL.
            // This is the key step: no file:// or network URL required in the CSS.
            try {
                const fontBuffer = fs.readFileSync(fontPath);
                const base64     = fontBuffer.toString('base64');
                declarations.push(
                    `@font-face {` +
                    ` font-family: '${entry.name}';` +
                    ` src: url('data:font/truetype;base64,${base64}') format('truetype');` +
                    ` font-weight: ${entry.weight};` +
                    ` font-style: normal;` +
                    ` font-display: block;` +
                    `}`
                );
                console.log(`[FontInstaller] ✅ ${entry.name} → base64 (${Math.round(fontBuffer.byteLength / 1024)}KB)`);
            } catch (err: any) {
                console.warn(`[FontInstaller] Could not read ${fontPath}: ${err.message}`);
            }
        }));

        return declarations.join('\n');
    }

    /**
     * Scans tracks and an optional captionStyle for font family names.
     * Called before ensureFonts() to collect only what this render needs.
     */
    extractUsedFonts(
        tracks: any[],
        captionStyle?: { fontFamily?: string } | null
    ): string[] {
        const fonts = new Set<string>();

        for (const track of tracks) {
            for (const clip of (track.clips ?? [])) {
                if ((clip.type === 'caption' || clip.type === 'text') && clip.fontFamily) {
                    fonts.add(clip.fontFamily as string);
                }
            }
        }

        if (captionStyle?.fontFamily) {
            fonts.add(captionStyle.fontFamily);
        }

        return [...fonts];
    }
}
