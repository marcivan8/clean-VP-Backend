/**
 * client/src/motion/RichTextEngine.js
 *
 * Advanced Typography & Multi-Run Text Engine for VIBED.
 *
 * Pure Canvas 2D engine — ZERO DOM, React, or browser dependencies.
 * Runs identically in the browser preview (Canvas 2D) and the export
 * worker (@napi-rs/canvas / Skia).
 *
 * Features:
 *   1. Mixed-font, mixed-weight, mixed-color text runs in a single layer.
 *   2. Fine typographic control: letterSpacing (tracking), lineHeight (leading),
 *      text alignment (left/center/right), vertical alignment (top/middle/bottom).
 *   3. Responsive layouts: auto-wrap and shrink-to-fit within bounding boxes.
 *   4. Word- and character-level motion (typewriter, slideUp, pop, fade)
 *      calculated per glyph without splitting text into fragile timeline clips.
 *   5. Stroke, shadow, glow, and clipping window reveals.
 */

import { measureSingleLineWidth } from './TextMeasurement.js';
import { resolveEasing, clamp } from './Easing.js';
import { activeWordIndex, revealedWordCount } from './CaptionModel.js';
import { drawSvgPath } from './VectorGraphics.js';

function pathPolyline(pathData, curveSteps = 20) {
    const subpaths = [];
    let current = null;
    const moveTo = (x, y) => { current = [[x, y]]; subpaths.push(current); };
    const lineTo = (x, y) => {
        if (!current) moveTo(x, y);
        else current.push([x, y]);
    };
    const sampler = {
        beginPath() {}, moveTo, lineTo,
        bezierCurveTo(x1, y1, x2, y2, x3, y3) {
            const start = current?.at(-1) || [0, 0];
            for (let index = 1; index <= curveSteps; index++) {
                const t = index / curveSteps, mt = 1 - t;
                lineTo(mt ** 3 * start[0] + 3 * mt ** 2 * t * x1 + 3 * mt * t ** 2 * x2 + t ** 3 * x3,
                    mt ** 3 * start[1] + 3 * mt ** 2 * t * y1 + 3 * mt * t ** 2 * y2 + t ** 3 * y3);
            }
        },
        quadraticCurveTo(x1, y1, x2, y2) {
            const start = current?.at(-1) || [0, 0];
            for (let index = 1; index <= curveSteps; index++) {
                const t = index / curveSteps, mt = 1 - t;
                lineTo(mt * mt * start[0] + 2 * mt * t * x1 + t * t * x2,
                    mt * mt * start[1] + 2 * mt * t * y1 + t * t * y2);
            }
        },
        ellipse(cx, cy, rx, ry, rotation, start, end, anticlockwise = false) {
            let delta = end - start;
            if (anticlockwise && delta > 0) delta -= Math.PI * 2;
            if (!anticlockwise && delta < 0) delta += Math.PI * 2;
            const count = Math.max(curveSteps, Math.ceil(Math.abs(delta) * Math.max(rx, ry) / 5));
            for (let index = 1; index <= count; index++) {
                const angle = start + delta * index / count;
                const ex = rx * Math.cos(angle), ey = ry * Math.sin(angle);
                lineTo(cx + Math.cos(rotation) * ex - Math.sin(rotation) * ey,
                    cy + Math.sin(rotation) * ex + Math.cos(rotation) * ey);
            }
        },
        closePath() {
            if (current?.length) lineTo(current[0][0], current[0][1]);
        },
    };
    drawSvgPath(sampler, pathData);
    return subpaths.find(points => points.length > 1) || [];
}

function measurePolyline(points) {
    const distances = [0];
    for (let index = 1; index < points.length; index++) {
        distances.push(distances[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
    }
    return { distances, length: distances.at(-1) || 0 };
}

function pointOnPolyline(points, distances, distance) {
    const total = distances.at(-1) || 0;
    const at = clamp(distance, 0, total);
    let index = 1;
    while (index < distances.length - 1 && distances[index] < at) index++;
    const span = distances[index] - distances[index - 1];
    const ratio = span > 0 ? (at - distances[index - 1]) / span : 0;
    const a = points[index - 1], b = points[index];
    return { x: a[0] + (b[0] - a[0]) * ratio, y: a[1] + (b[1] - a[1]) * ratio,
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

function drawRichTextOnPath(ctx, layout, motionMap, unit, pathSpec) {
    const points = pathPolyline(pathSpec?.data || pathSpec?.path || '');
    const { distances, length } = measurePolyline(points);
    if (points.length < 2 || length < 1) return false;
    const glyphs = layout.glyphs || [];
    const naturalWidth = glyphs.reduce((sum, glyph) => sum + Math.max(0, Number(glyph.width) || 0), 0);
    if (!glyphs.length || naturalWidth < 1) return false;
    const scaleToFit = Math.min(1, length / naturalWidth);
    const occupied = naturalWidth * scaleToFit;
    const align = ['start', 'center', 'end'].includes(pathSpec.align) ? pathSpec.align : 'center';
    const start = align === 'start' ? 0 : align === 'end' ? length - occupied : (length - occupied) / 2;
    const side = pathSpec.side === 'right' ? -1 : 1;
    const offset = Number(pathSpec.offset) || 0;
    let cursor = 0;
    for (const glyph of glyphs) {
        const glyphWidth = Math.max(0, Number(glyph.width) || 0);
        const at = start + (cursor + glyphWidth / 2) * scaleToFit;
        cursor += glyphWidth;
        if (/^\s$/u.test(glyph.char)) continue;
        const motionKey = unit === 'word' ? glyph.wordIndex : glyph.charIndex;
        const motion = motionMap?.get(motionKey) || { scale: 1, opacity: 1, translateY: 0, translateX: 0 };
        if (motion.opacity <= 0) continue;
        const point = pointOnPolyline(points, distances, at);
        const normalX = -Math.sin(point.angle) * side, normalY = Math.cos(point.angle) * side;
        const tangentShift = Number(motion.translateX) || 0;
        const normalShift = offset + (Number(motion.translateY) || 0);
        const x = point.x + Math.cos(point.angle) * tangentShift + normalX * normalShift;
        const y = point.y + Math.sin(point.angle) * tangentShift + normalY * normalShift;
        ctx.save();
        ctx.globalAlpha *= motion.opacity;
        ctx.translate(x, y);
        ctx.rotate(point.angle);
        const animatedScale = Number.isFinite(Number(motion.scale)) ? Number(motion.scale) : 1;
        ctx.scale(animatedScale * scaleToFit, animatedScale * scaleToFit);
        ctx.font = `${glyph.run.fontStyle} ${glyph.run.fontWeight} ${glyph.run.fontSize}px "${glyph.run.fontFamily}", sans-serif`;
        if (glyph.run.shadow) {
            ctx.shadowColor = glyph.run.shadow.color || 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = Number(glyph.run.shadow.blur) || 8;
            ctx.shadowOffsetX = Number(glyph.run.shadow.offsetX) || 0;
            ctx.shadowOffsetY = Number(glyph.run.shadow.offsetY) || 2;
        }
        const baselineX = -glyphWidth / 2;
        if (glyph.run.stroke && glyph.run.strokeWidth > 0) {
            ctx.strokeStyle = glyph.run.stroke;
            ctx.lineWidth = glyph.run.strokeWidth;
            ctx.lineJoin = 'round';
            ctx.strokeText(glyph.char, baselineX, 0);
        }
        ctx.fillStyle = glyph.run.color || '#FFFFFF';
        ctx.fillText(glyph.char, baselineX, 0);
        ctx.restore();
    }
    return true;
}

/**
 * Normalize an input (string, object, or runs array) into a standard array of text runs.
 * @param {string|object|Array} input
 * @param {object} baseStyle Defaults for runs
 * @returns {Array<object>}
 */
export function normalizeRuns(input, baseStyle = {}) {
    const defaults = {
        fontFamily:    baseStyle.fontFamily || 'Inter',
        fontSize:      Number(baseStyle.fontSize) > 0 ? Number(baseStyle.fontSize) : 56,
        fontWeight:    baseStyle.fontWeight || '600',
        fontStyle:     baseStyle.fontStyle || 'normal',
        color:         baseStyle.color || '#FFFFFF',
        letterSpacing: Number(baseStyle.letterSpacing) || 0,
        stroke:        baseStyle.stroke || null,
        strokeWidth:   Number(baseStyle.strokeWidth) || 0,
        textTransform: baseStyle.textTransform || 'none',
        shadow:        baseStyle.shadow || null,
    };

    if (typeof input === 'string') {
        return [{ ...defaults, text: input }];
    }

    if (Array.isArray(input)) {
        return input.map(run => {
            if (typeof run === 'string') return { ...defaults, text: run };
            return {
                ...defaults,
                ...run,
                fontSize:      Number(run.fontSize) > 0 ? Number(run.fontSize) : defaults.fontSize,
                letterSpacing: Number(run.letterSpacing) || defaults.letterSpacing,
                strokeWidth:   Number(run.strokeWidth) || defaults.strokeWidth,
            };
        });
    }

    if (input && typeof input === 'object') {
        if (Array.isArray(input.runs)) return normalizeRuns(input.runs, { ...defaults, ...input });
        return [{ ...defaults, ...input, text: String(input.text || '') }];
    }

    return [{ ...defaults, text: '' }];
}

/**
 * Measure width of a single text segment with tracking.
 */
function measureSegmentWidth(text, run) {
    if (!text) return 0;
    const baseW = measureSingleLineWidth(text, {
        fontSize: run.fontSize,
        fontFamily: run.fontFamily,
        fontWeight: run.fontWeight,
    });
    const tracking = (text.length > 1 && run.letterSpacing) ? (text.length - 1) * run.letterSpacing : 0;
    return baseW + tracking;
}

/**
 * Break text runs into individual word items for line-wrapping.
 */
function tokenizeRuns(runs) {
    const items = [];
    for (const run of runs) {
        let text = String(run.text || '');
        if (run.textTransform === 'uppercase') text = text.toUpperCase();
        else if (run.textTransform === 'lowercase') text = text.toLowerCase();

        // Split preserving newlines and spaces
        const parts = text.split(/(\r\n|\n|\r|[ \t]+)/);
        for (const part of parts) {
            if (!part) continue;
            const isNewline = /^\r\n|\n|\r$/.test(part);
            const isSpace = /^[ \t]+$/.test(part);
            const width = isNewline ? 0 : measureSegmentWidth(part, run);
            items.push({
                text: part,
                isNewline,
                isSpace,
                width,
                run,
            });
        }
    }
    return items;
}

/**
 * Compute the complete multiline layout of rich text runs.
 *
 * @param {string|Array<object>} runsInput
 * @param {object} containerOpts
 *   {
 *     maxWidth: number,
 *     maxHeight: number,
 *     lineHeightMultiplier: number (default 1.25),
 *     align: 'left'|'center'|'right',
 *     valign: 'top'|'middle'|'bottom',
 *     shrinkToFit: boolean,
 *   }
 * @returns {object} Layout result with lines, glyphs/words, and bounding box
 */
export function layoutRichText(runsInput, containerOpts = {}) {
    let runs = normalizeRuns(runsInput, containerOpts);
    const {
        maxWidth = Infinity,
        maxHeight = Infinity,
        lineHeightMultiplier = 1.25,
        align = 'center',
        valign = 'middle',
        shrinkToFit = false,
    } = containerOpts;

    // Shrink-to-fit iteration if container bounds are constrained
    if (shrinkToFit && Number.isFinite(maxWidth) && Number.isFinite(maxHeight)) {
        for (let pass = 0; pass < 5; pass++) {
            const testLayout = computeLayoutLines(runs, maxWidth, lineHeightMultiplier, align);
            if (testLayout.totalHeight <= maxHeight && testLayout.totalWidth <= maxWidth) {
                return finalizeLayout(testLayout, containerOpts);
            }
            // Scale font sizes down
            const scaleDown = Math.min(maxWidth / (testLayout.totalWidth || 1), maxHeight / (testLayout.totalHeight || 1), 0.88);
            if (scaleDown >= 0.98) break;
            runs = runs.map(r => ({ ...r, fontSize: Math.max(12, Math.round(r.fontSize * scaleDown)) }));
        }
    }

    const rawLayout = computeLayoutLines(runs, maxWidth, lineHeightMultiplier, align);
    return finalizeLayout(rawLayout, containerOpts);
}

function computeLayoutLines(runs, maxWidth, lineHeightMultiplier, align) {
    const tokens = tokenizeRuns(runs);
    const lines = [];
    let currentLine = [];
    let currentLineWidth = 0;

    for (const token of tokens) {
        if (token.isNewline) {
            lines.push(currentLine);
            currentLine = [];
            currentLineWidth = 0;
            continue;
        }

        if (Number.isFinite(maxWidth) && currentLineWidth + token.width > maxWidth && currentLine.length > 0) {
            // Drop trailing spaces before wrapping
            while (currentLine.length && currentLine[currentLine.length - 1].isSpace) {
                currentLine.pop();
            }
            lines.push(currentLine);
            currentLine = token.isSpace ? [] : [token];
            currentLineWidth = token.isSpace ? 0 : token.width;
        } else {
            currentLine.push(token);
            currentLineWidth += token.width;
        }
    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    // Measure height and widths of formatted lines
    let totalHeight = 0;
    let maxLineWidth = 0;
    const formattedLines = [];

    for (const lineTokens of lines) {
        // Strip trailing spaces from line width
        while (lineTokens.length && lineTokens[lineTokens.length - 1].isSpace) {
            lineTokens.pop();
        }

        let lineWidth = 0;
        let maxFontSize = 36;
        for (const tok of lineTokens) {
            lineWidth += tok.width;
            if (tok.run.fontSize > maxFontSize) maxFontSize = tok.run.fontSize;
        }

        const lineHeight = Math.round(maxFontSize * lineHeightMultiplier);
        formattedLines.push({
            tokens: lineTokens,
            width: lineWidth,
            maxFontSize,
            lineHeight,
        });

        totalHeight += lineHeight;
        if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
    }

    return {
        lines: formattedLines,
        totalWidth: maxLineWidth,
        totalHeight,
    };
}

function finalizeLayout(rawLayout, containerOpts) {
    const {
        maxWidth = Infinity,
        maxHeight = Infinity,
        align = 'center',
        valign = 'middle',
    } = containerOpts;

    const glyphs = [];
    const words = [];
    let wordIndex = 0;
    let charIndex = 0;

    const boxW = Number.isFinite(maxWidth) ? Math.max(maxWidth, rawLayout.totalWidth) : rawLayout.totalWidth;
    const boxH = Number.isFinite(maxHeight) ? Math.max(maxHeight, rawLayout.totalHeight) : rawLayout.totalHeight;

    // Compute vertical starting offset
    let startY = 0;
    if (valign === 'middle') startY = (boxH - rawLayout.totalHeight) / 2;
    else if (valign === 'bottom') startY = boxH - rawLayout.totalHeight;

    let currentY = startY;

    for (let lineIdx = 0; lineIdx < rawLayout.lines.length; lineIdx++) {
        const line = rawLayout.lines[lineIdx];
        let currentX = 0;
        if (align === 'center') currentX = (boxW - line.width) / 2;
        else if (align === 'right') currentX = boxW - line.width;

        const baselineY = currentY + line.maxFontSize;

        for (const tok of line.tokens) {
            if (!tok.isSpace) {
                // Word entry
                words.push({
                    wordIndex,
                    text: tok.text,
                    x: currentX,
                    y: baselineY,
                    width: tok.width,
                    lineIndex: lineIdx,
                    run: tok.run,
                });
                wordIndex++;
            }

            // Character breakdown for fine per-char animations
            let charX = currentX;
            for (let c = 0; c < tok.text.length; c++) {
                const ch = tok.text[c];
                const charW = measureSingleLineWidth(ch, {
                    fontSize: tok.run.fontSize,
                    fontFamily: tok.run.fontFamily,
                    fontWeight: tok.run.fontWeight,
                }) + (tok.run.letterSpacing || 0);

                glyphs.push({
                    charIndex,
                    char: ch,
                    x: charX,
                    y: baselineY,
                    width: charW,
                    wordIndex: tok.isSpace ? -1 : (wordIndex - 1),
                    lineIndex: lineIdx,
                    run: tok.run,
                });
                charIndex++;
                charX += charW;
            }

            currentX += tok.width;
        }

        currentY += line.lineHeight;
    }

    return {
        lines: rawLayout.lines,
        words,
        glyphs,
        totalWidth: rawLayout.totalWidth,
        totalHeight: rawLayout.totalHeight,
        boxWidth: boxW,
        boxHeight: boxH,
    };
}

// ── Typography Animation Sampling ─────────────────────────────────────────────

/**
 * Sample animation parameters for each character/word at the given local time.
 *
 * Supported animation presets:
 *   - 'pop': scale from 0 to 1 with spring-like overshoot
 *   - 'slideUp': slide up from +40px below with opacity fade
 *   - 'fade': smooth alpha fade in
 *   - 'typewriter': sudden appearance in sequence
 *   - 'wave': subtle vertical oscillation
 *
 * @param {object} layout Result from layoutRichText
 * @param {object} animSpec
 *   {
 *     preset: 'pop'|'slideUp'|'fade'|'typewriter'|'wave',
 *     unit: 'word'|'char',
 *     stagger: number (seconds per unit, default 0.04),
 *     duration: number (seconds per unit animation, default 0.3),
 *     easing: string (e.g. 'easeOutBack', 'easeOutCubic'),
 *   }
 * @param {number} localTime Current time in seconds (0..sceneDuration)
 * @returns {Map<number, object>} Map of index -> { scale, opacity, translateY, translateX }
 */
export function sampleTypographyMotion(layout, animSpec = {}, localTime = 0, clipDuration = animSpec.clipDuration) {
    const results = new Map();
    if (!layout || !animSpec.preset) return results;

    const {
        preset = 'slideUp',
        unit = 'char',
        stagger = 0.035,
        duration = 0.28,
        easing = preset === 'pop' ? 'easeOutBack' : 'easeOutCubic',
    } = animSpec;

    const items = unit === 'word' ? layout.words : layout.glyphs;
    const easeFn = resolveEasing(easing);

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = unit === 'word' ? item.wordIndex : item.charIndex;
        if (key < 0) continue;

        const startTime = i * stagger;
        const progress = duration > 0 ? clamp((localTime - startTime) / duration, 0, 1) : 1;
        const eased = easeFn(progress);

        let transform = { scale: 1, opacity: 1, translateY: 0, translateX: 0 };

        switch (preset) {
            case 'typewriter':
                transform.opacity = localTime >= startTime ? 1 : 0;
                break;

            case 'pop':
                transform.opacity = clamp(progress * 2, 0, 1);
                transform.scale = eased;
                break;

            case 'slideUp':
                transform.opacity = eased;
                transform.translateY = (1 - eased) * 35;
                break;

            case 'fade':
                transform.opacity = eased;
                break;

            case 'wave': {
                const waveT = localTime * 4 - i * 0.4;
                transform.translateY = Math.sin(waveT) * 8;
                break;
            }

            default:
                break;
        }

        const exit = animSpec.exit;
        if (exit?.preset && Number(clipDuration) > 0) {
            const exitDuration = Math.max(0.05, Number(exit.duration) || 0.24);
            const exitStagger = Math.max(0, Number(exit.stagger ?? stagger) || 0);
            const exitIndex = exit.order === 'forward' ? i : items.length - 1 - i;
            const exitStart = Math.max(0, Number(clipDuration) - exitDuration - exitIndex * exitStagger);
            const exitProgress = clamp((localTime - exitStart) / exitDuration, 0, 1);
            if (exitProgress > 0) {
                const exitEase = resolveEasing(exit.easing || 'easeInCubic')(exitProgress);
                if (exit.preset === 'fade' || exit.preset === 'shrink' || exit.preset === 'drop') transform.opacity *= 1 - exitEase;
                if (exit.preset === 'shrink') transform.scale *= 1 - exitEase * 0.35;
                if (exit.preset === 'drop') transform.translateY += exitEase * (Number(exit.distance) || 28);
                if (exit.preset === 'wipe') transform.translateX += exitEase * (Number(exit.distance) || 32) * (exit.direction === 'left' ? -1 : 1);
            }
        }

        for (const beat of Array.isArray(animSpec.emphasis) ? animSpec.emphasis : []) {
            const beatDuration = Math.max(0.05, Number(beat.duration) || 0.32);
            const beatProgress = clamp((localTime - (Number(beat.start) || 0)) / beatDuration, 0, 1);
            if (beatProgress <= 0 || beatProgress >= 1) continue;
            const wave = Math.sin(beatProgress * Math.PI * 2);
            const strength = clamp(Number(beat.amount) || 1, 0, 2);
            if (beat.preset === 'pulse') transform.scale *= 1 + Math.max(0, wave) * 0.12 * strength;
            if (beat.preset === 'shake') transform.translateX += wave * 4 * strength;
            if (beat.preset === 'lift') transform.translateY -= Math.max(0, wave) * 5 * strength;
        }

        results.set(key, transform);
    }

    return results;
}

// ── Rendering Dispatcher ──────────────────────────────────────────────────────

/**
 * Render complete rich text layout onto a 2D canvas context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout Result from layoutRichText
 * @param {object} opts { motionMap, unit: 'word'|'char', offsetX, offsetY, clipWindow }
 */
export function drawRichText(ctx, layout, opts = {}) {
    if (!ctx || !layout) return;
    const {
        motionMap = null,
        unit = 'char',
        offsetX = 0,
        offsetY = 0,
        clipWindow = null, // { x, y, w, h } to clip reveal window
    } = opts;

    ctx.save();

    if (clipWindow) {
        ctx.beginPath();
        ctx.rect(clipWindow.x, clipWindow.y, clipWindow.w, clipWindow.h);
        ctx.clip();
    }

    if (unit === 'word') {
        // Render word by word
        for (const word of layout.words) {
            const motion = motionMap?.get(word.wordIndex) || { scale: 1, opacity: 1, translateY: 0, translateX: 0 };
            if (motion.opacity <= 0) continue;

            ctx.save();
            ctx.globalAlpha *= motion.opacity;

            const wx = word.x + offsetX + motion.translateX;
            const wy = word.y + offsetY + motion.translateY;

            if (motion.scale !== 1) {
                ctx.translate(wx + word.width / 2, wy - word.run.fontSize / 2);
                ctx.scale(motion.scale, motion.scale);
                ctx.translate(-(wx + word.width / 2), -(wy - word.run.fontSize / 2));
            }

            ctx.font = `${word.run.fontStyle} ${word.run.fontWeight} ${word.run.fontSize}px "${word.run.fontFamily}", sans-serif`;

            if (word.run.shadow) {
                ctx.shadowColor   = word.run.shadow.color || 'rgba(0,0,0,0.5)';
                ctx.shadowBlur    = Number(word.run.shadow.blur) || 8;
                ctx.shadowOffsetX = Number(word.run.shadow.offsetX) || 0;
                ctx.shadowOffsetY = Number(word.run.shadow.offsetY) || 2;
            }

            if (word.run.stroke && word.run.strokeWidth > 0) {
                ctx.strokeStyle = word.run.stroke;
                ctx.lineWidth   = word.run.strokeWidth;
                ctx.lineJoin    = 'round';
                ctx.strokeText(word.text, wx, wy);
            }

            ctx.fillStyle = word.run.color || '#FFFFFF';
            ctx.fillText(word.text, wx, wy);

            ctx.restore();
        }
    } else {
        // Render glyph by glyph for fine-grained character animations
        for (const glyph of layout.glyphs) {
            const motion = motionMap?.get(glyph.charIndex) || { scale: 1, opacity: 1, translateY: 0, translateX: 0 };
            if (motion.opacity <= 0) continue;

            ctx.save();
            ctx.globalAlpha *= motion.opacity;

            const gx = glyph.x + offsetX + motion.translateX;
            const gy = glyph.y + offsetY + motion.translateY;

            if (motion.scale !== 1) {
                ctx.translate(gx + glyph.width / 2, gy - glyph.run.fontSize / 2);
                ctx.scale(motion.scale, motion.scale);
                ctx.translate(-(gx + glyph.width / 2), -(gy - glyph.run.fontSize / 2));
            }

            ctx.font = `${glyph.run.fontStyle} ${glyph.run.fontWeight} ${glyph.run.fontSize}px "${glyph.run.fontFamily}", sans-serif`;

            if (glyph.run.shadow) {
                ctx.shadowColor   = glyph.run.shadow.color || 'rgba(0,0,0,0.5)';
                ctx.shadowBlur    = Number(glyph.run.shadow.blur) || 8;
                ctx.shadowOffsetX = Number(glyph.run.shadow.offsetX) || 0;
                ctx.shadowOffsetY = Number(glyph.run.shadow.offsetY) || 2;
            }

            if (glyph.run.stroke && glyph.run.strokeWidth > 0) {
                ctx.strokeStyle = glyph.run.stroke;
                ctx.lineWidth   = glyph.run.strokeWidth;
                ctx.lineJoin    = 'round';
                ctx.strokeText(glyph.char, gx, gy);
            }

            ctx.fillStyle = glyph.run.color || '#FFFFFF';
            ctx.fillText(glyph.char, gx, gy);

            ctx.restore();
        }
    }

    ctx.restore();
}

/** Render timed caption words inside an isolated graphic layer. This keeps
 * word timing and the common caption highlight treatments when a caption is
 * promoted from the text track so a parent composition can apply group effects.
 */
function drawRichCaptionFrame(ctx, graphic, localTime, opts) {
    const width = Math.max(1, Number(opts.width || graphic.w) || 1080);
    const height = Math.max(1, Number(opts.height || graphic.h) || 480);
    const style = graphic.style || {};
    const captionStyle = graphic.captionStyle || {};
    const highlight = captionStyle.wordHighlight || {};
    let text = String(graphic.text ?? '');
    if (captionStyle.uppercase) text = text.toUpperCase();
    const layout = layoutRichText(text, {
        fontFamily: style.fontFamily,
        fontSize: Number(style.fontSize) || 56,
        fontWeight: style.fontWeight || '600',
        color: style.color || '#FFFFFF',
        stroke: typeof style.stroke === 'string' ? style.stroke : style.stroke?.color || null,
        strokeWidth: Number(style.stroke?.width ?? style.strokeWidth) || 0,
        shadow: style.shadow || null,
        maxWidth: width,
        maxHeight: height,
        lineHeightMultiplier: Number(style.lineHeight) > 0 ? Number(style.lineHeight) : 1.2,
        align: style.textAlign || style.align || 'center',
        valign: style.valign || 'middle',
        shrinkToFit: true,
    });
    const words = Array.isArray(graphic.captionWords) ? graphic.captionWords : [];
    const time = Number.isFinite(Number(opts.globalTime)) ? Number(opts.globalTime) : Number(localTime) || 0;
    const activeIndex = activeWordIndex(words, time);
    const highlightMode = highlight.mode || 'none';
    const reveal = graphic.captionReveal === true || (words.length > 0 && highlightMode !== 'none');
    const visibleCount = reveal ? revealedWordCount(words, time, 1, layout.words.length) : layout.words.length;
    const baseColor = style.color || '#FFFFFF';
    const scale = clamp(Number(highlight.scale) || 1, 0.5, 2);
    ctx.save();
    const panelColor = style.backgroundColor || captionStyle.backgroundColor;
    if (panelColor) {
        const paddingEm = Math.max(0.06, Number(style.backgroundPadding ?? captionStyle.backgroundPadding) || 0.16);
        layout.lines.forEach((line, lineIndex) => {
            const visibleWords = layout.words.filter((word, index) => word.lineIndex === lineIndex && index < visibleCount);
            if (!visibleWords.length) return;
            const left = Math.min(...visibleWords.map(word => word.x));
            const right = Math.max(...visibleWords.map(word => word.x + word.width));
            const fontSize = Number(line.maxFontSize) || 56;
            const padX = fontSize * paddingEm;
            const padY = fontSize * 0.08;
            const box = { x: left - padX, y: visibleWords[0].y - fontSize - padY, w: right - left + padX * 2, h: fontSize + padY * 2 };
            ctx.save();
            ctx.fillStyle = panelColor;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(box.h * 0.04, box.w / 2));
            else ctx.rect(box.x, box.y, box.w, box.h);
            ctx.fill();
            ctx.restore();
        });
    }
    for (let index = 0; index < layout.words.length; index++) {
        if (index >= visibleCount) continue;
        const word = layout.words[index];
        const run = word.run;
        const isActive = index === activeIndex && highlightMode !== 'none';
        const x = word.x, baseline = word.y;
        ctx.save();
        let activeScale = scale;
        if (isActive && highlightMode === 'bounce-box') {
            const timedWord = words[activeIndex] || {};
            const duration = Math.max(0.08, Number(timedWord.end) - Number(timedWord.start) || 0.25);
            const progress = clamp((time - Number(timedWord.start || 0)) / Math.min(0.22, duration), 0, 1);
            activeScale *= 1 + Math.sin(progress * Math.PI) * (Number(highlight.bounce) || 0.12);
        }
        if (isActive && activeScale !== 1) {
            ctx.translate(x + word.width / 2, baseline - run.fontSize / 2);
            ctx.scale(activeScale, activeScale);
            ctx.translate(-(x + word.width / 2), -(baseline - run.fontSize / 2));
        }
        if (isActive && ['box', 'background', 'vox-marker', 'bounce-box'].includes(highlightMode)) {
            const padX = Math.max(4, run.fontSize * 0.12), padY = Math.max(2, run.fontSize * 0.06);
            const radius = Math.max(2, run.fontSize * 0.08);
            ctx.fillStyle = highlightMode === 'bounce-box' && highlight.altBackground && activeIndex % 2
                ? highlight.altBackground : (highlight.background || '#FFE500');
            ctx.beginPath();
            const marker = highlightMode === 'vox-marker';
            const boxX = x - padX, boxY = marker ? baseline - run.fontSize * 0.28 : baseline - run.fontSize + padY;
            const boxW = word.width + padX * 2, boxH = marker ? Math.max(5, run.fontSize * 0.22) : run.fontSize + padY * 2;
            if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, radius);
            else ctx.rect(boxX, boxY, boxW, boxH);
            ctx.fill();
        }
        ctx.font = `${run.fontStyle} ${run.fontWeight} ${run.fontSize}px "${run.fontFamily}", sans-serif`;
        if (isActive && highlightMode === 'neon-glow') {
            ctx.shadowColor = highlight.glowColor || highlight.color || '#00E5FF';
            ctx.shadowBlur = Math.max(8, Number(highlight.glow) || run.fontSize * 0.32);
        } else if (run.shadow) {
            ctx.shadowColor = run.shadow.color || 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = Number(run.shadow.blur) || 8;
            ctx.shadowOffsetX = Number(run.shadow.offsetX) || 0;
            ctx.shadowOffsetY = Number(run.shadow.offsetY) || 2;
        } else if (style.textShadow && style.textShadow !== 'none') {
            const shadow = String(style.textShadow).match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px(?:\s+(\d+(?:\.\d+)?)px)?\s*(.*)/);
            if (shadow) {
                ctx.shadowOffsetX = Number(shadow[1]) || 0;
                ctx.shadowOffsetY = Number(shadow[2]) || 0;
                ctx.shadowBlur = Number(shadow[3]) || 0;
                ctx.shadowColor = shadow[4]?.trim() || 'rgba(0,0,0,0.5)';
            }
        }
        const dimmed = isActive && highlightMode === 'opacity';
        ctx.globalAlpha *= dimmed ? clamp(Number(highlight.opacity) || 0.5, 0, 1) : 1;
        ctx.fillStyle = isActive && highlightMode === 'color' ? (highlight.color || '#FFE500')
            : isActive && ['box', 'background', 'bounce-box'].includes(highlightMode) ? (highlight.color || '#111111')
                : baseColor;
        if (run.stroke && run.strokeWidth > 0) {
            ctx.strokeStyle = run.stroke;
            ctx.lineWidth = run.strokeWidth;
            ctx.lineJoin = 'round';
            ctx.strokeText(word.text, x, baseline);
        }
        ctx.fillText(word.text, x, baseline);
        if (isActive && highlightMode === 'underline') {
            ctx.strokeStyle = highlight.color || baseColor;
            ctx.lineWidth = Math.max(2, run.fontSize * 0.06);
            ctx.beginPath(); ctx.moveTo(x, baseline + 3); ctx.lineTo(x + word.width, baseline + 3); ctx.stroke();
        }
        if (isActive && highlightMode === 'terminal-cursor') {
            ctx.fillStyle = highlight.cursorColor || highlight.color || baseColor;
            ctx.fillText(String(highlight.cursor || '▌'), x + word.width + Math.max(2, run.fontSize * 0.04), baseline);
        }
        ctx.restore();
    }
    ctx.restore();
    return layout;
}

/**
 * Draw a complete rich-text graphic from a serialisable scene node.
 * The preview canvas and export renderer call this same function so per-glyph
 * animation, wrapping, tracking, stroke and shadows stay frame-identical.
 */
export function drawRichTextFrame(ctx, graphic = {}, localTime = 0, opts = {}) {
    if (!ctx) return null;
    if (graphic.captionMode) return drawRichCaptionFrame(ctx, graphic, localTime, opts);
    const width = Math.max(1, Number(opts.width || graphic.w) || 1080);
    const height = Math.max(1, Number(opts.height || graphic.h) || 480);
    const style = graphic.style || {};
    const input = Array.isArray(graphic.runs) && graphic.runs.length
        ? graphic.runs
        : String(graphic.text ?? '');
    const stroke = style.stroke;
    const layout = layoutRichText(input, {
        fontFamily: style.fontFamily,
        fontSize: Number(style.fontSize) || 56,
        fontWeight: style.fontWeight || '600',
        color: style.color || '#FFFFFF',
        stroke: typeof stroke === 'string' ? stroke : stroke?.color || null,
        strokeWidth: Number(stroke?.width ?? style.strokeWidth) || 0,
        shadow: style.shadow || null,
        maxWidth: width,
        maxHeight: height,
        lineHeightMultiplier: Number(style.lineHeight) > 0 ? Number(style.lineHeight) : 1.2,
        align: style.textAlign || style.align || 'center',
        valign: style.valign || 'middle',
        shrinkToFit: true,
    });
    const animSpec = graphic.charAnim || null;
    const unit = animSpec?.unit === 'word' ? 'word' : 'char';
    const motionMap = animSpec?.preset
        ? sampleTypographyMotion(layout, animSpec, Math.max(0, Number(localTime) || 0), Number(opts.duration ?? opts.durationSec ?? graphic.duration) || 0)
        : null;
    const drawnOnPath = graphic.textPath
        ? drawRichTextOnPath(ctx, layout, motionMap, unit, graphic.textPath)
        : false;
    if (!drawnOnPath) drawRichText(ctx, layout, { motionMap, unit });
    return layout;
}
