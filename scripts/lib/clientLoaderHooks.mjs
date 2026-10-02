// Node loader hooks so regression scripts can import client agent modules:
// resolves Vite-style extensionless imports, stubs lib/supabaseClient, and
// replaces import.meta.env (Vite-only) with an empty object.
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
const STUB = new URL('./stub-supabase.mjs', import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (/supabaseClient(\.js)?$/.test(spec)) return { url: STUB, shortCircuit: true };
  try { return await next(spec, ctx); }
  catch (e) {
    if ((spec.startsWith('.') || spec.startsWith('/')) && ctx.parentURL) {
      for (const ext of ['.js', '.jsx', '/index.js']) {
        const u = new URL(spec + ext, ctx.parentURL);
        if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
      }
    }
    throw e;
  }
}
export async function load(url, ctx, next) {
  const r = await next(url, ctx);
  if (url.includes('/client/src/') && r.source) {
    let src = r.source.toString();
    if (src.includes('import.meta.env')) src = src.replace(/import\.meta\.env/g, '({})');
    return { ...r, source: src };
  }
  return r;
}
