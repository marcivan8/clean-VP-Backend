const fs = require('fs');

function applyUseShallow(filePath, oldDestructure, newPropertiesStr) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes("import { useShallow } from 'zustand/react/shallow';")) {
        content = "import { useShallow } from 'zustand/react/shallow';\n" + content;
    }
    
    // Replace the destructuring
    content = content.replace(
        oldDestructure,
        `const { ${newPropertiesStr} } = useTimelineStore(useShallow(state => ({\n    ${newPropertiesStr.split(',').map(s => s.trim()).filter(Boolean).map(s => `${s}: state.${s}`).join(',\n    ')}\n})));`
    );
    
    fs.writeFileSync(filePath, content);
}

// 1. IDELayout.jsx
let idePath = 'client/src/layouts/IDELayout.jsx';
let ideContent = fs.readFileSync(idePath, 'utf8');
if (!ideContent.includes("import { useShallow }")) {
    ideContent = "import { useShallow } from 'zustand/react/shallow';\n" + ideContent;
}

// Replace the specific destructuring
let ideMatch = /const \{\s*isPlaying, setUploadedFile, updateClip, uploadedFile,\s*aspectRatio, assets, addAssets, addClip, zoomLevel, tracks, activeClipId,\s*setActiveClip, past, future, duration, currentTime\s*\} = useTimelineStore\(\);/m;

if (ideMatch.test(ideContent)) {
    const propsList = 'isPlaying, setUploadedFile, updateClip, uploadedFile, aspectRatio, assets, addAssets, addClip, zoomLevel, tracks, activeClipId, setActiveClip, past, future, duration';
    
    ideContent = ideContent.replace(ideMatch, `const { ${propsList} } = useTimelineStore(useShallow(state => ({\n    ${propsList.split(',').map(s => s.trim()).filter(Boolean).map(s => `${s}: state.${s}`).join(',\n    ')}\n})));`);
    
    // Also replace usages of currentTime in IDELayout
    ideContent = ideContent.replace(/currentTime=\{currentTime\}/g, `currentTime={useTimelineStore.getState().currentTime}`);
    ideContent = ideContent.replace(/playhead=\{currentTime\}/g, `playhead={useTimelineStore.getState().currentTime}`);
    ideContent = ideContent.replace(/pasteClip\(currentTime\)/g, `pasteClip(useTimelineStore.getState().currentTime)`);
    
    fs.writeFileSync(idePath, ideContent);
}

// 2. Timeline.jsx
applyUseShallow(
    'client/src/components/Timeline/Timeline.jsx',
    /const \{ tracks, duration, zoomLevel, seek, setZoomLevel, addTrack \} = useTimelineStore\(\);/,
    'tracks, duration, zoomLevel, seek, setZoomLevel, addTrack'
);

// 3. TextPanel.jsx
let textPath = 'client/src/components/TextPanel.jsx';
let textContent = fs.readFileSync(textPath, 'utf8');
if (!textContent.includes("import { useShallow }")) {
    textContent = "import { useShallow } from 'zustand/react/shallow';\n" + textContent;
}

let textMatch = /const \{ activeClipId, tracks, updateClip, addClip, addTextTrack, currentTime, setActiveClip \} = useTimelineStore\(\);/;
if (textMatch.test(textContent)) {
    const propsList = 'activeClipId, tracks, updateClip, addClip, addTextTrack, setActiveClip';
    
    textContent = textContent.replace(textMatch, `const { ${propsList} } = useTimelineStore(useShallow(state => ({\n    ${propsList.split(',').map(s => s.trim()).filter(Boolean).map(s => `${s}: state.${s}`).join(',\n    ')}\n})));`);
    
    // Replace currentTime with getState().currentTime
    textContent = textContent.replace(/currentTime/g, `useTimelineStore.getState().currentTime`);
    // Fix the destructure which we just broke by replacing currentTime inside it! Oh wait, the replace already removed currentTime from the destructure! But let's be careful.
    fs.writeFileSync(textPath, textContent);
}

console.log("Done");
