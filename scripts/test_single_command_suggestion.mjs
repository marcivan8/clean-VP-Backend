#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import useAIStore from '../client/src/store/useAIStore.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

useAIStore.getState().clearSession();
useAIStore.getState().addSuggestion({ id: 'brain-old', type: 'brain_advisory' });
useAIStore.getState().addSuggestion({ id: 'regular', type: 'captions' });
useAIStore.getState().addSuggestion({ id: 'brain-new', type: 'brain_advisory' });
const stored = useAIStore.getState().suggestions;
assert.equal(stored.filter(item => item.type === 'brain_advisory').length, 1);
assert.equal(stored.find(item => item.type === 'brain_advisory').id, 'brain-new');
assert.ok(stored.some(item => item.id === 'regular'), 'other suggestion types remain unaffected');

const brainPanel = read('client/src/components/BrainPanel.jsx');
assert.match(brainPanel, /directorProposals\.find\(proposal => proposal\.applicable\)/);
assert.match(brainPanel, /suggestions\[0\] \|\| null/);
assert.match(brainPanel, /visibleProposals\.map/);
assert.doesNotMatch(brainPanel, /suggestions\.map\(/);

const reasoningPanel = read('client/src/components/Assistant/ReasoningPanel.jsx');
assert.match(reasoningPanel, /suggestion\.data\?\.suggestions \|\| \[\]\)\.slice\(0, 1\)/);

console.log('Single command suggestion checks passed');
