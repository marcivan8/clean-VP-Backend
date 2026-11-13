// Node loader hooks for RENDERING client components in a test, not just
// importing plain modules (see clientLoaderHooks.mjs for the non-JSX case).
//
// Adds two things on top of those hooks: esbuild transforms .jsx on the way in,
// and CSS imports become no-ops. Together that is enough to render a panel with
// react-dom/server and find out whether it throws — which is the one class of
// defect a source-level assertion cannot reach. R166 mounted EffectsPanel and
// two such defects were already there (a call to a registry method that has
// never existed, and definition objects destructured as [type, def] pairs).
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { transformSync } from '../../client/node_modules/esbuild/lib/main.js';

const STUB = new URL('./stub-supabase.mjs', import.meta.url).href;
const EMPTY = 'export default {};';

export async function resolve(spec, ctx, next) {
    if (/supabaseClient(\.js)?$/.test(spec)) return { url: STUB, shortCircuit: true };
    if (/\.css$/.test(spec)) return { url: 'data:text/javascript,' + encodeURIComponent(EMPTY), shortCircuit: true };
    try { return await next(spec, ctx); }
    catch (e) {
        if ((spec.startsWith('.') || spec.startsWith('/')) && ctx.parentURL) {
            for (const ext of ['.jsx', '.js', '/index.jsx', '/index.js']) {
                const u = new URL(spec + ext, ctx.parentURL);
                if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
            }
        }
        throw e;
    }
}

export async function load(url, ctx, next) {
    if (url.endsWith('.jsx')) {
        const path = fileURLToPath(url);
        let src = readFileSync(path, 'utf8').replace(/import\.meta\.env/g, '({})');
        const out = transformSync(src, { loader: 'jsx', format: 'esm', sourcefile: path, jsx: 'automatic' });
        return { format: 'module', shortCircuit: true, source: out.code };
    }
    const r = await next(url, ctx);
    if (url.includes('/client/src/') && r.source) {
        let src = r.source.toString();
        if (src.includes('import.meta.env')) src = src.replace(/import\.meta\.env/g, '({})');
        return { ...r, source: src };
    }
    return r;
}
