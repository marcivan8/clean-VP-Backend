// scripts/test_design_studio_r170.mjs — R170: design projects in the account
// (and never over a video project), real variations, a full-brief assistant.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const V = await import('../client/src/design-studio/designVariations.js');
const O = await import('../client/src/design-studio/designOperations.js');

console.log('\n§1 a design is its own project, and can never overwrite a video project');
const dp = code(read('../client/src/lib/designProjects.js'));
ok(/\.eq\('id', projectId\)\.eq\('timeline_state->>kind', DESIGN_KIND\)/.test(dp), 'saveDesign only matches rows that are already designs (the database is the guard)');
ok(/data\.length === 0\)[\s\S]{0,120}return false/.test(dp), 'a save that matched no row is reported as not saved (R38)');
ok(/notDesign: true/.test(dp), 'opening a video project in the studio is refused');
const page = code(read('../client/src/pages/DesignStudioPage.jsx'));
ok(!/metadata:\s*\{\s*design_studio/.test(page) && !/updateProject\(/.test(page), 'the studio no longer writes { metadata } over a project timeline');
ok(!/useTimelineStore\.getState\(\)\.projectId/.test(page), 'the studio never borrows the video editor\'s project id');
ok(/if \(!projectId\) \{ done\(\{ status: 'new' \}\)/.test(page) && /function NewDesignDialog/.test(page) && /createDesignProject\(clean,/.test(page), 'opened without a design, it asks for a name and creates one');
ok(/!isCloudId\(projectId\)[\s\S]{0,600}createDesignProject\(name, local/.test(page), 'an old browser-only design is moved to the account');
ok(!/22 G IN/.test(page), 'a new design starts blank, not on the old demo');
ok(/project\.timeline_state\?\.kind === 'design'[\s\S]{0,120}navigate\(`\/design\?projectId=/.test(read('../client/src/pages/EditorPage.jsx')), 'the video editor sends a design to the studio instead of loading it');
const dash = read('../client/src/pages/DashboardPage.jsx');
ok(!/name: 'Kettle Drum Launch/.test(dash) && /localOnly: true/.test(dash), 'the dashboard no longer seeds a made-up design');
ok(/kind:timeline_state->>kind/.test(read('../client/src/lib/projectsApi.js')), 'the project list knows which projects are designs');

console.log('\n§2 Variations restyle the design in progress');
const layers = [
    { id: 'bg', type: 'bg', fill: '#000000' },
    { id: 'head', type: 'text', text: 'BIG IDEA', x: 64, y: 300, w: 600, h: 140, fontSize: 80, fontFamily: 'Inter', fill: '#ffffff' },
    { id: 'sub', type: 'text', text: 'small line', x: 64, y: 460, w: 500, h: 40, fontSize: 28, fill: '#cccccc' },
    { id: 'badge', type: 'badge', text: 'NEW', x: 1100, y: 48, w: 120, h: 40, fill: '#ff0000' },
];
const frozen = JSON.stringify(layers);
const vars = V.buildLocalVariations(layers, { format: { w: 1280, h: 720 }, round: 0 });
ok(vars.length === 4 && vars.every(v => v.layers.length === layers.length), 'four variations, each the same layers');
ok(vars.every(v => JSON.stringify(v.layers) !== frozen), 'every variation actually differs from the design');
ok(vars.every(v => v.layers.map(l => l.id).join() === 'bg,head,sub,badge'), 'the user\'s layers and content are kept');
ok(JSON.stringify(layers) === frozen, 'the design itself is never mutated');
const mirrored = vars.find(v => v.style === 'Layout');
ok(mirrored.layers.find(l => l.id === 'badge').x === 1280 - 1100 - 120, 'the mirrored layout really mirrors positions');
const vars2 = V.buildLocalVariations(layers, { format: { w: 1280, h: 720 }, round: 1 });
ok(JSON.stringify(vars2.map(v => v.layers)) !== JSON.stringify(vars.map(v => v.layers)), 'a new round gives different variations');
ok(V.buildLocalVariations([], {}).length === 0, 'an empty canvas has no variations');
const ai = V.applyVariationPatches(layers, [
    { title: 'Bold', patches: { head: { fill: '#FBBF24', fontFamily: 'Anton', fontSize: 9999 }, ghost: { fill: '#fff' } } },
    { title: 'Unsafe', patches: { head: { fill: 'url(javascript:alert(1))' } } },
    { title: 'Nothing', patches: { head: { fill: '#ffffff' } } },
]);
ok(ai.length === 1 && ai[0].layers.find(l => l.id === 'head').fontSize === 400, 'AI patches are clamped, invented layers ignored');
ok(!JSON.stringify(ai).includes('javascript'), 'an unsafe fill never reaches the canvas');
ok(!ai.some(v => v.title === 'Nothing'), 'a direction that changes nothing is dropped');
ok(/regenerateVariations[\s\S]{0,400}\/api\/ai\/design-variations/.test(page) && !/handleApplyAiTweak\(e, briefText\)/.test(page), 'Regenerate asks the AI for directions (it re-ran the brief through the parser)');
ok(/<VariationPreview layers=\{dir\.layers\}/.test(page), 'each card is a real preview of its layers');

console.log('\n§3 the assistant builds whole designs, safely');
ok(O.isBuildRequest('Create a bold YouTube thumbnail with a big headline') && O.isBuildRequest('crée une miniature pour ma vidéo de voyage'), 'a full brief is a build');
ok(!O.isBuildRequest('make the headline bigger') && !O.isBuildRequest('set corner radius to 24px'), 'a single edit is not');
const components = [{ id: 'cmp_btn', name: 'Button', w: 200, h: 48, layers: [{ id: 'bg', type: 'rect', x: 0, y: 0, w: 200, h: 48, fill: '#00E5FF' }, { id: 'label', type: 'text', x: 0, y: 14, w: 200, h: 20, text: 'GO', fontSize: 14 }] }];
const media = [{ id: 'm1', name: 'Me', url: 'data:image/png;base64,AAA' }];
const r = O.applyDesignOperations(layers, [
    { op: 'set_background', fill: 'linear-gradient(160deg, #0B1220 0%, #1E293B 100%)' },
    { op: 'add_layer', layer: { type: 'text', name: 'Title', text: 'HELLO', x: 64, y: 200, w: 700, h: 160, fontSize: 90, fill: '#fff' } },
    { op: 'add_layer', layer: { type: 'image', mediaId: 'm1', x: 700, y: 60, w: 400, h: 600 } },
    { op: 'add_layer', layer: { type: 'image', mediaId: 'nope' } },
    { op: 'add_layer', layer: { type: 'iframe' } },
    { op: 'add_component', componentId: 'cmp_btn', x: 64, y: 500, scale: 2, text: { label: 'WATCH NOW' } },
    { op: 'add_component', componentId: 'missing' },
], { components, media, format: { w: 1280, h: 720 }, mode: 'build' });
ok(r.layers.filter(l => l.type === 'bg').length === 1 && r.layers.find(l => l.type === 'bg').fill.startsWith('linear-gradient'), 'build: background set, old content replaced');
ok(!r.layers.some(l => l.id === 'head'), 'build replaces the previous composition');
ok(r.layers.some(l => l.type === 'image' && l.src === media[0].url), 'an image is used only from the user\'s media');
const btn = r.layers.filter(l => l.groupId?.startsWith('cmp_btn'));
ok(btn.length === 2 && btn.find(l => l.type === 'text').text === 'WATCH NOW' && btn[0].w === 400, 'a library component is inserted, scaled, with its text rewritten');
ok(r.applied === 4 && r.skipped.length === 3, 'what could not be applied is counted, not silently dropped');
const e = O.applyDesignOperations(layers, [{ op: 'update_layer', layerId: 'head', patch: { fill: 'expression(evil)' } }, { op: 'update_layer', layerId: 'ghost', patch: { fill: '#fff' } }], { mode: 'edit' });
ok(e.applied === 0 && e.layers.find(l => l.id === 'head').fill === '#ffffff', 'unsafe or orphan updates change nothing');
const many = O.applyDesignOperations([], Array.from({ length: 90 }, () => ({ op: 'add_layer', layer: { type: 'rect', w: 10, h: 10 } })), {});
ok(many.layers.length === 60, 'at most 60 operations are applied per answer');
const dir = code(read('../client/src/design-studio/components/DesignStudioAiDirector.jsx'));
ok(/const build = isBuildRequest\(textToRun\);\s*if \(!build\)/.test(dir), 'a full brief skips the local parser');
ok(/applyDesignOperations\(layers, data\.operations/.test(dir) && /result\.applied === 0/.test(dir), 'the AI\'s answer goes through the gate, and "nothing changed" is said');
ok(/catalog: buildComponentCatalog\(components\)/.test(dir) && /media: media\.map\(m => \(\{ id: m\.id, name: m\.name \}\)\)/.test(dir) && /format: \{ w: format\?\.w/.test(dir), 'the AI gets the library, the media ids and the real format size');

console.log('\n§4 server');
const routes = read('../routes/aiRoutes.js');
ok(/router\.post\('\/design-variations',\s*authenticateUser, designStudioGate, aiGate, designVariationsHandler\)/.test(routes), 'variations: signed in, Pro, counted as an AI operation');
const ctl = read('../controllers/aiAgentController.js');
ok(/maxTokens: mode === 'build' \? 3500 : 1800/.test(ctl) && !/max_tokens: 800/.test(ctl), 'the copilot can answer with a whole design (800 tokens was 4 or 5 layers)');
ok(/uploads are data: URLs/.test(ctl) && /"mediaId": "<id from Media>"/.test(ctl), 'images are referred to by id, never by inlined data');

console.log('\n§5 the component library is visible');
const panel = read('../client/src/design-studio/components/LayersAndAssetsPanel.jsx');
ok(/\{tab\.short \|\| tab\.label\}/.test(panel), 'the left rail labels its tabs (Components was an unlabelled 4th icon)');
ok(/useState\(\(\) => \(layers\.every\(l => l\.type === 'bg'\) \? 'components' : 'layers'\)\)/.test(page), 'an empty design opens on the library');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
