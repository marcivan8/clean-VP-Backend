#!/usr/bin/env node
/**
 * A suggestion `tab` must open a tab that IDELayout renders from its tab bar.
 * 'Add a color grade' used tab: 'effects', which reached a render branch for an
 * EffectsPanel that IDELayout never imported: one click crashed the editor.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const engine = read('client/src/agent/SuggestionEngine.js');
const ide = read('client/src/layouts/IDELayout.jsx');

let failures = 0;
const check = (name, ok, hint = '') => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !hint ? '' : `\n      ${hint}`}`);
    if (!ok) failures++;
};

const tabBar = ide.match(/\{\[('media'[^\]]*)\]\.map\(tab =>/);
check('IDELayout tab bar array is found', !!tabBar);
const tabs = tabBar ? [...tabBar[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]) : [];

const ruleTabs = [...engine.matchAll(/\btab:\s*'([a-z_]+)'/g)].map(m => m[1]);
check('SuggestionEngine declares at least one tab', ruleTabs.length > 0);
for (const tab of new Set(ruleTabs)) {
    check(`suggestion tab '${tab}' is in the tab bar`, tabs.includes(tab),
        `tab bar: ${tabs.join(', ')}`);
    check(`suggestion tab '${tab}' has a render branch`,
        new RegExp(`activeTab === '${tab}'`).test(ide));
}

check("the color grade suggestion opens the 'color' tab",
    /label: 'Add a color grade',\s*prompt: null,\s*tab: 'color'/.test(engine));
check('IDELayout does not render an unimported EffectsPanel',
    !/<EffectsPanel\b/.test(ide) || /import\s+(\{[^}]*\bEffectsPanel\b[^}]*\}|EffectsPanel)\s+from/.test(ide));

if (failures) {
    console.error(`\n✗ ${failures} check(s) failed`);
    process.exit(1);
}
console.log('\n✓ suggestion tabs all open a real tab');
