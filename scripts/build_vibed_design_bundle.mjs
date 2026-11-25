import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from '../client/node_modules/esbuild/lib/main.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const designRoot = path.join(projectRoot, 'Vibed Design System');
const manifest = JSON.parse(await readFile(path.join(designRoot, '_ds_manifest.json'), 'utf8'));
const studioSources = [
  'ui_kits/studio/studio-parts.jsx',
  'ui_kits/studio/studio-screens.jsx',
  'ui_kits/studio/studio-app.jsx',
];
const sourcePaths = [
  ...manifest.components.map((component) => component.sourcePath),
  ...studioSources,
];
const sourceHashes = {};

async function updateManifestTokens() {
  const tokenGroups = [
    ['tokens/colors.css', 'color'],
    ['tokens/typography.css', 'font'],
    ['tokens/spacing.css', 'spacing'],
    ['tokens/effects.css', 'other'],
  ];
  const tokens = [];
  const baseValues = {};
  const themeValues = {};

  for (const [relativePath, defaultKind] of tokenGroups) {
    const css = await readFile(path.join(designRoot, relativePath), 'utf8');
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/s)?.[1] || '';
    const warmBlock = css.match(/(?:\.theme-warm\s*,\s*\[data-theme="warm"\]|\.theme-warm)\s*\{([^}]*)\}/s)?.[1] || '';
    const declarationPattern = /(--[\w-]+)\s*:\s*([^;]+);(?:\s*\/\*\s*@kind\s+([^*]+?)\s*\*\/)?/g;
    for (const match of rootBlock.matchAll(declarationPattern)) {
      const [, name, rawValue, annotation] = match;
      baseValues[name] = rawValue.trim();
      let kind = defaultKind;
      if (relativePath.endsWith('spacing.css') && name.startsWith('--radius-')) kind = 'radius';
      if (relativePath.endsWith('typography.css') && name.startsWith('--fs-')) kind = 'font';
      const token = { name, value: rawValue.trim(), kind, definedIn: relativePath };
      if (annotation) token.annotation = annotation.trim();
      tokens.push(token);
    }
    for (const [, name, rawValue] of warmBlock.matchAll(declarationPattern)) themeValues[name] = rawValue.trim();
  }

  const fontCss = await readFile(path.join(designRoot, 'tokens/fonts.css'), 'utf8');
  const fonts = [...fontCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, block]) => {
    const field = (name) => block.match(new RegExp(`${name}\\s*:\\s*["']?([^;"']+)["']?\\s*;`))?.[1]?.trim();
    const urls = [...block.matchAll(/url\(["']?\.\.\/([^"')]+)["']?\)/g)].map(([, file]) => file);
    return {
      family: field('font-family'),
      weight: field('font-weight'),
      style: field('font-style'),
      cssPath: 'tokens/fonts.css',
      files: urls,
    };
  }).filter((font) => font.family && font.files.length);

  manifest.tokens = tokens;
  manifest.fonts = fonts;
  manifest.brandFonts = [
    { family: 'Plus Jakarta Sans', status: 'ok', tokens: ['--f-display'], path: 'tokens/fonts.css' },
    { family: 'Geist', status: 'ok', tokens: ['--f-sans'], path: 'tokens/fonts.css' },
    { family: 'Instrument Serif', status: 'ok', tokens: ['--f-serif'], path: 'tokens/fonts.css' },
    { family: 'JetBrains Mono', status: 'ok', tokens: ['--f-mono'], path: 'tokens/fonts.css' },
  ];
  manifest.themes = [
    { selector: ':root', label: 'Dark' },
    { selector: '.theme-warm, [data-theme="warm"]', label: 'Warm' },
  ];
  manifest.tokenModes = [
    { name: 'Dark', selector: ':root', values: baseValues },
    { name: 'Warm', selector: '.theme-warm, [data-theme="warm"]', values: { ...baseValues, ...themeValues } },
  ];
}

async function compile(sourcePath) {
  const source = await readFile(path.join(designRoot, sourcePath), 'utf8');
  sourceHashes[sourcePath] = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const jsxSource = source
    .replace(/^import\s+React\s+from\s+["']react["'];\s*/m, '')
    .replace(/^export\s+(?=(?:function|const|class)\s)/gm, '');
  const result = await transform(jsxSource, {
    loader: 'jsx',
    target: 'es2020',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    legalComments: 'none',
    sourcefile: sourcePath,
  });
  return result.code.trim();
}

const compiled = [];
for (const component of manifest.components) {
  const code = await compile(component.sourcePath);
  compiled.push(`// ${component.sourcePath}\ntry { (() => {\n${code}\nObject.assign(__ds_scope, { ${component.name} });\n})(); } catch (e) { __ds_ns.__errors.push({ path: ${JSON.stringify(component.sourcePath)}, error: String((e && e.message) || e) }); }`);
}

for (const sourcePath of studioSources) {
  const code = await compile(sourcePath);
  compiled.push(`// ${sourcePath}\ntry { (() => {\n${code}\n})(); } catch (e) { __ds_ns.__errors.push({ path: ${JSON.stringify(sourcePath)}, error: String((e && e.message) || e) }); }`);
}

const header = {
  format: 3,
  namespace: manifest.namespace,
  components: manifest.components,
  sourceHashes,
  inlinedExternals: [],
  unexposedExports: [],
};
const exports = manifest.components
  .map(({ name }) => `__ds_ns.${name} = __ds_scope.${name};`)
  .join('\n\n');
const bundle = `/* @ds-bundle: ${JSON.stringify(header)} */\n\n(() => {\n\nconst __ds_ns = (window.${manifest.namespace} = window.${manifest.namespace} || {});\n\nconst __ds_scope = {};\n\n(__ds_ns.__errors = __ds_ns.__errors || []);\n\n${compiled.join('\n\n')}\n\n${exports}\n\n})();\n`;

await writeFile(path.join(designRoot, '_ds_bundle.js'), bundle);
await updateManifestTokens();
await writeFile(path.join(designRoot, '_ds_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${sourcePaths.length} design-system sources in _ds_bundle.js`);
