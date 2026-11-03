import { fitTextToBox } from '../motion/TextMeasurement.js';
import { resolveFrame } from '../motion/SceneLayout.js';
import { stylePackToClipFields } from '../motion/CaptionModel.js';
import { repairGeneratedTitleLayout } from './shortPolish.js';

const isCaptionClip = clip => Array.isArray(clip?.words) && clip.words.length > 0
    || String(clip?.clipId || clip?.id || '').startsWith('caption-')
    || String(clip?.id || '').startsWith('short-caption-')
    || clip?.style === 'subtitle';

const mostRecentFinish = reports => {
    for (const report of [...(reports || [])].reverse()) {
        const finish = (report.steps || []).find(step => step.key === 'finish' && step.details);
        if (finish) return { report, finish: finish.details };
    }
    return null;
};

/**
 * Repair supported export issues on an export-only copy, then report checks
 * verifiable from project data. Reference-specific checks are included when
 * the project has an Auto edit report. The timeline itself is never mutated.
 */
export function prepareAutoExport({ tracks = [], assets = [], captions = [], aspectRatio = '9:16', autoEditReports = [] } = {}) {
    const latest = mostRecentFinish(autoEditReports);
    const copiedTracks = (tracks || []).map(track => ({
        ...track,
        clips: (track.clips || []).map(clip => ({ ...clip, ...(clip.captionStyle ? { captionStyle: { ...clip.captionStyle } } : {}) })),
    }));
    const finish = latest?.finish || {};
    const expected = finish.style || {};
    const expectedPack = expected.captionPack || null;
    const packFields = expectedPack ? stylePackToClipFields(expectedPack) : null;
    const frame = resolveFrame(aspectRatio);
    let captionStyleRepairs = 0;
    let captionCount = 0;
    let matchingCaptionStyles = 0;
    let captionWordCount = 0;
    const captionIssues = [];

    for (const track of copiedTracks) {
        if (track.type !== 'text') continue;
        for (const clip of track.clips || []) {
            if (!isCaptionClip(clip)) continue;
            captionCount += 1;
            const actualPack = clip.captionStyle?.packId || null;
            if (packFields && actualPack !== expectedPack) {
                clip.fontFamily = packFields.fontFamily;
                clip.fontWeight = packFields.fontWeight;
                clip.fontSize = packFields.fontSize;
                clip.color = expected.captionTextColor || packFields.color;
                clip.stroke = packFields.stroke;
                clip.textShadow = packFields.textShadow;
                if (packFields.backgroundColor) clip.backgroundColor = packFields.backgroundColor;
                if (Number.isFinite(Number(packFields.backgroundPadding))) clip.backgroundPadding = packFields.backgroundPadding;
                clip.captionStyle = { ...(clip.captionStyle || {}), ...packFields.captionStyle };
                if (expected.accent && clip.captionStyle.wordHighlight) {
                    clip.captionStyle.wordHighlight = { ...clip.captionStyle.wordHighlight, color: expected.accent };
                }
                captionStyleRepairs += 1;
            }
            if (!expectedPack || clip.captionStyle?.packId === expectedPack) matchingCaptionStyles += 1;

            const text = String(clip.content || clip.name || '').trim();
            const initialSize = Number(clip.fontSize) || Number(packFields?.fontSize) || 40;
            if (text) {
                const fit = fitTextToBox(text, { maxWidth: frame.w * 0.76, maxHeight: frame.h * 0.12 }, {
                    initialFontSize: initialSize,
                    minFontSize: Math.min(28, initialSize),
                    fontFamily: clip.fontFamily || packFields?.fontFamily || 'Inter',
                    fontWeight: clip.fontWeight || packFields?.fontWeight || 'normal',
                    lineHeight: 1.12,
                    allowWrap: true,
                });
                if (fit.width > frame.w * 0.76 + 1 || fit.height > frame.h * 0.12 + 1) {
                    captionIssues.push({ clipId: clip.id, code: 'caption-overflow' });
                } else {
                    if (fit.fontSize < initialSize) clip.fontSize = fit.fontSize;
                    if (!Array.isArray(clip.words) || clip.words.length === 0) clip.content = fit.lines.join('\n');
                }
            }
            captionWordCount += Array.isArray(clip.words) && clip.words.length
                ? clip.words.length : text.split(/\s+/).filter(Boolean).length;
        }
    }

    const platformProfile = (finish.platform && finish.platform.toLowerCase().includes('reel'))
        ? { safeZone: { top: 0.12, bottom: 0.16 } }
        : finish.platform && finish.platform.toLowerCase().includes('short')
            ? { safeZone: { top: 0.12, bottom: 0.12 } }
            : { safeZone: { top: 0.1, bottom: 0.1 } };
    const titleQa = repairGeneratedTitleLayout(copiedTracks, aspectRatio, platformProfile.safeZone);

    const usedAssetIds = new Set(copiedTracks.filter(track => track.type === 'video')
        .flatMap(track => track.clips || []).map(clip => clip.assetId).filter(Boolean));
    const videoAssets = (assets || []).filter(asset => usedAssetIds.has(asset.id) && asset.type === 'video');
    const orientationResolved = videoAssets.filter(asset =>
        ['verified-upright', 'corrected-rotation', 'proxy-shape-used'].includes(asset.orientation?.status)
    ).length;
    const orientationUnknown = Math.max(0, videoAssets.length - orientationResolved);
    const transcriptWords = (captions || []).filter(word => Number(word?.start) < Number(finish.duration || Infinity)).length;
    const coverage = transcriptWords > 0 ? Math.min(1, captionWordCount / transcriptWords) : null;
    const graphicsCount = copiedTracks.filter(track => track.type === 'overlay' || track.name === 'Moments')
        .reduce((count, track) => count + (track.clips || []).filter(clip => String(clip.id || '').startsWith('short-')).length, 0);
    const sourceClips = copiedTracks.filter(track => track.type === 'video').flatMap(track => track.clips || []);
    const cameraMoves = sourceClips.reduce((count, clip) => count + (clip.animations || []).filter(animation => animation?.source === 'composed').length, 0);
    const warnings = [];
    if (orientationUnknown > 0) warnings.push({ code: 'orientation-unverified', message: `${orientationUnknown} source video(s) do not have authoritative upright dimensions yet.` });
    if (expectedPack && captionCount === 0) warnings.push({ code: 'reference-captions-missing', message: `The reference calls for ${expectedPack} captions, but no caption clips are on the timeline.` });
    if (coverage != null && coverage < 0.9) warnings.push({ code: 'transcript-coverage-low', message: `Caption coverage is ${Math.round(coverage * 100)}%.` });
    if (captionIssues.length) warnings.push({ code: 'caption-overflow', message: `${captionIssues.length} caption clip(s) still exceed the readable text box.` });
    if (titleQa.issues.length) warnings.push({ code: 'title-overflow', message: `${titleQa.issues.length} title(s) still exceed the safe text box.` });
    if (Number(finish.duration) > 45 && graphicsCount < 2 && cameraMoves < 2) {
        warnings.push({ code: 'visual-rhythm-low', message: 'This long Reel has few generated graphic or camera emphasis beats.' });
    }

    return {
        tracks: copiedTracks,
        report: {
            checked: true,
            source: latest ? 'auto' : 'timeline',
            status: warnings.length ? 'review' : 'passed',
            sceneSource: finish.sceneSource || null,
            reference: {
                expectedCaptionPack: expectedPack,
                matchedAfterRepair: expectedPack ? captionCount > 0 && matchingCaptionStyles === captionCount : null,
                captionRepairs: captionStyleRepairs,
            },
            orientation: { checked: videoAssets.length > 0, videoCount: videoAssets.length, resolved: orientationResolved, unverified: orientationUnknown },
            titles: { checked: true, repaired: titleQa.repairs.length, issues: titleQa.issues.length },
            captions: { checked: true, clips: captionCount, transcriptWords, captionWords: captionWordCount, coverage, repairs: captionStyleRepairs, issues: captionIssues.length },
            visualRhythm: { duration: Number(finish.duration) || 0, graphics: graphicsCount, cameraMoves },
            capabilities: finish.capabilities || null,
            warnings,
        },
    };
}

/** Confirm that expected reference treatment reached the actual export plans. */
export function verifyAutoExportCompilation(report, { compositionPlan = null, captionProgram = null, tracks = [] } = {}) {
    if (!report) return null;
    const entries = captionProgram?.entries || [];
    const titleClipIds = (tracks || []).filter(track => track.type === 'text' && /short-title|short-cta/.test(String(track.id || '')))
        .flatMap(track => (track.clips || []).map(clip => clip.id));
    const graphicClipCount = (tracks || []).filter(track => track.type === 'overlay')
        .flatMap(track => track.clips || []).filter(clip => String(clip.id || '').startsWith('short-')).length;
    const out = {
        ...report,
        titles: { ...report.titles, clips: titleClipIds.length, inRenderPlan: titleClipIds.filter(id => entries.some(entry => entry.clipId === id)).length },
        rendered: { overlays: compositionPlan?.overlays?.length || 0, captionEntries: entries.length },
    };
    if (titleClipIds.length && out.titles.inRenderPlan < titleClipIds.length) {
        out.warnings = [...(out.warnings || []), { code: 'title-not-in-render-plan', message: 'One or more generated titles are missing from the compiled caption render plan.' }];
    }
    if (graphicClipCount > 0 && !(compositionPlan?.overlays?.length)) {
        out.warnings = [...(out.warnings || []), { code: 'graphics-not-in-render-plan', message: 'Generated graphic layers are missing from the compiled compositor plan.' }];
    }
    if (report.reference.expectedCaptionPack === 'editorial-boxed') {
        const boxedInProgram = entries.some(entry => !!entry.style?.backgroundColor);
        out.reference = { ...out.reference, boxedCaptionInRenderPlan: boxedInProgram };
        if (!boxedInProgram) out.warnings = [...(out.warnings || []), { code: 'reference-treatment-not-in-render-plan', message: 'The boxed caption treatment is missing from the compiled export caption plan.' }];
    }
    out.status = out.warnings?.length ? 'review' : 'passed';
    return out;
}

export default { prepareAutoExport, verifyAutoExportCompilation };
