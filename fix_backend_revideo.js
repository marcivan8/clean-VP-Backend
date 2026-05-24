const fs = require('fs');

// 1. Update revideoRenderRoutes.js to accept tracks
let renderRoutes = fs.readFileSync('routes/revideoRenderRoutes.js', 'utf8');
renderRoutes = renderRoutes.replace(/const \{ clips = \[\], duration = 10, fps = 30 \} = req\.body;/, 
    `const { tracks = [], duration = 10, fps = 30 } = req.body.timeline || req.body;`);
renderRoutes = renderRoutes.replace(/variables: \{ clips, duration, aspectRatio, fps \}/, 
    `variables: { tracks, duration, aspectRatio, fps }`);
renderRoutes = renderRoutes.replace(/clips\.length/, `tracks.reduce((acc, t) => acc + t.clips.length, 0)`);
fs.writeFileSync('routes/revideoRenderRoutes.js', renderRoutes);

// 2. Read frontend project.tsx
const frontendProject = fs.readFileSync('client/src/revideo/project.tsx', 'utf8');

// We want to extract the generator body of `timelineScene`
const generatorMatch = frontendProject.match(/const timelineScene = makeScene2D\('timeline', function\* \(view\) \{([\s\S]*?)^\}\);/m);

if (generatorMatch) {
    let body = generatorMatch[1];
    
    // In the backend, we need to fix relative URLs!
    // We can add a helper function at the top of the body
    const fixUrlHelper = `
    const fixUrl = (url: string) => {
        if (!url) return url;
        if (url.startsWith('/api') || url.startsWith('/uploads')) {
            return 'http://127.0.0.1:3000' + url;
        }
        return url;
    };
    `;
    
    // Replace clip.url with fixUrl(clip.url)
    body = body.replace(/src=\{clip\.url\}/g, 'src={fixUrl(clip.url)}');
    
    // We also need to construct the new backend timeline.tsx
    const backendTimeline = `import { makeScene2D, Video, Audio, Img, Txt, Node, Rect, brightness, contrast, saturate, hue } from '@revideo/2d';
import { waitFor, useScene, all, any, createRef } from '@revideo/core';

/**
 * Evaluate a keyframe array at a given local clip time.
 * Supports: linear, easeIn, easeOut, easeInOut, bounce, elastic.
 */
function evaluateKF(keyframes: any[], time: number, defaultValue: number): number {
    if (!keyframes || keyframes.length === 0) return defaultValue;
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (time <= sorted[0].time) return sorted[0].value;
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

    let from = sorted[0], to = sorted[1];
    for (let i = 0; i < sorted.length - 1; i++) {
        if (time >= sorted[i].time && time < sorted[i + 1].time) { from = sorted[i]; to = sorted[i + 1]; break; }
    }
    const t0 = (time - from.time) / Math.max(to.time - from.time, 0.0001);
    const easingMap: Record<string, (t: number) => number> = {
        linear: t => t,
        easeIn: t => t * t,
        easeOut: t => t * (2 - t),
        easeInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
        'ease-in': t => t * t,
        'ease-out': t => t * (2 - t),
        'ease-in-out': t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
        bounce: t => { const n1 = 7.5625, d1 = 2.75; if (t < 1/d1) return n1*t*t; if (t < 2/d1) return n1*(t-=1.5/d1)*t+0.75; if (t < 2.5/d1) return n1*(t-=2.25/d1)*t+0.9375; return n1*(t-=2.625/d1)*t+0.984375; },
        elastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10*t) * Math.sin((t-0.1)*5*Math.PI) + 1,
    };
    const easing = easingMap[to.easing || 'linear'] || easingMap.linear;
    return from.value + (to.value - from.value) * easing(t0);
}

function clipLocalTime(playbackTime: number, clipStart: number): number {
    return Math.max(0, playbackTime - clipStart);
}

export default makeScene2D('timeline', function* (view) {
    ${fixUrlHelper}
    ${body}
});
`;

    fs.writeFileSync('revideo/src/scenes/timeline.tsx', backendTimeline);
    
    // We also need to update IDELayout to use /api/revideo/render
    let ide = fs.readFileSync('client/src/layouts/IDELayout.jsx', 'utf8');
    ide = ide.replace(/fetch\('\/api\/render'/g, "fetch('/api/revideo/render'");
    fs.writeFileSync('client/src/layouts/IDELayout.jsx', ide);
    
    console.log("SUCCESS");
} else {
    console.log("FAILED TO EXTRACT BODY");
}
