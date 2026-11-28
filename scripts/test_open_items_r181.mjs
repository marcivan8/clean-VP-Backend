// scripts/test_open_items_r181.mjs — R181: the Shorts-panel button for the
// posting goal, post copy before an account is connected, and runs on phones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

console.log('\n§1 the Shorts panel button');
{
    const panel = read('client/src/components/ShortsPanel.jsx');
    ok(/onClick=\{\(\) => handleFind\(true\)\}/.test(panel) && /shortsPanel\.findAndSchedule/.test(panel), 'a second button starts the find-and-schedule goal');
    ok(/kind: schedule \? GOAL_KINDS\.SHORTS_TO_POSTS : GOAL_KINDS\.SHORTS_FROM_LONG_VIDEO/.test(panel), 'it starts the same posting run a typed request starts');
    ok(/if \(schedule && !canPublish\)[\s\S]{0,200}feature: 'social'[\s\S]{0,200}upgradeRequired: 'pro'/.test(panel), 'below Pro it shows the social upgrade prompt instead');
    const store = read('client/src/store/useAgentRunStore.js');
    ok(/start: async \(\{ goal = null, kind = GOAL_KINDS\.SHORTS_FROM_LONG_VIDEO/.test(store) && /createGoal\(kind, \{ count, platforms, finish \}\)/.test(store), 'the run store takes the goal kind');
}

console.log('\n§2 copy before connecting');
{
    const pub = read('client/src/components/SocialPublisher.jsx');
    ok(!/\{connected && <form/.test(pub) && /<form onSubmit=\{schedule\}/.test(pub), 'the title, caption and Generate copy are shown before an account is connected');
    ok(/\{connected && <><div className="flex gap-1\.5">/.test(pub) && /publishNow/.test(pub), 'Schedule and Publish now still need the connection');
    ok(/navigator\.clipboard\.writeText\(text\)/.test(pub) && /socialPublisher\.copy/.test(pub), 'a Copy button puts the text on the clipboard for a manual post');
    ok(/socialPublisher\.connectToSchedule/.test(pub), 'it says the connection is only needed to schedule');
}

console.log('\n§3 runs on a phone');
{
    const wf = read('client/src/agent/WorkflowController.js');
    ok(/window\.innerWidth < 768 && useMobileFlowStore\.getState\(\)\.active\) return null/.test(wf), 'a typed goal on a phone runs as a goal, except inside the guided creation flow');
    ok(/ai\.requestPanel\('shorts'\)/.test(wf), 'starting a run asks the editor to show the Shorts panel');
    const { default: useAIStore } = await import('../client/src/store/useAIStore.js');
    useAIStore.getState().requestPanel('shorts');
    const first = useAIStore.getState().panelRequest;
    await new Promise(r => setTimeout(r, 2));
    useAIStore.getState().requestPanel('shorts');
    ok(useAIStore.getState().activeTab === 'shorts' && first.tab === 'shorts' && useAIStore.getState().panelRequest !== first, 'requestPanel sets the tab, and a repeated request still counts');
    const ide = read('client/src/layouts/IDELayout.jsx');
    ok(/const panelRequest = useAIStore\(s => s\.panelRequest\);[\s\S]{0,300}if \(isMobile\) setMobileSheet\('media'\);/.test(ide), 'on a phone the bottom sheet opens on that tab');
    ok(/'shorts', 'iterations'/.test(ide) && /<AgentRunCard \/>/.test(read('client/src/components/ShortsPanel.jsx')), 'the sheet\'s Shorts tab is the panel that holds the run card');
}

console.log('\n§4 copy');
for (const l of ['en', 'fr']) {
    const e = JSON.parse(read(`client/src/locales/${l}/editor.json`));
    ok(e.shortsPanel.findAndSchedule && e.shortsPanel.scheduleLocked && e.socialPublisher.copy && e.socialPublisher.connectToSchedule, `${l}: the new text exists`);
}

console.log(`\n${'─'.repeat(60)}\nOpen items R181: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
