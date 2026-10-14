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
export function sampleTypographyMotion(layout, animSpec = {}, localTime = 0) {
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
