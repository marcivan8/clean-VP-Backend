/**
 * Capture the player canvas and its live DOM layers into one review image.
 * SVG foreignObject is intentionally avoided: Chromium taints canvases that
 * contain it, so toDataURL silently forced the review back to the bare player.
 */
export async function captureReviewFrame(surface) {
    if (!surface) throw new Error('The preview frame is not ready yet.');
    const surfaceRect = surface.getBoundingClientRect();
    const width = Math.round(surfaceRect.width);
    const height = Math.round(surfaceRect.height);
    if (width < 2 || height < 2) throw new Error('The preview frame is not ready yet.');

    await document.fonts?.ready;
    const scale = Math.min(2, 1600 / Math.max(width, height));
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(width * scale));
    output.height = Math.max(1, Math.round(height * scale));
    const context = output.getContext('2d');
    context.scale(scale, scale);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();

    const relativeRect = (element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left - surfaceRect.left, y: rect.top - surfaceRect.top, w: rect.width, h: rect.height };
    };
    const safeToDraw = (element) => {
        if (element instanceof HTMLCanvasElement) {
            try { element.toDataURL('image/png'); return true; } catch { return false; }
        }
        if (element instanceof HTMLVideoElement && element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
        if ((element instanceof HTMLImageElement && element.currentSrc) || element instanceof HTMLVideoElement) {
            try {
                const probe = document.createElement('canvas');
                probe.width = probe.height = 1;
                const probeContext = probe.getContext('2d');
                probeContext.drawImage(element, 0, 0, 1, 1);
                probe.toDataURL('image/png');
                return true;
            } catch { return false; }
        }
        return true;
    };

    // The first canvas is Revideo's rendered footage. It is the same pixels
    // the editor shows beneath its sibling HTML overlays.
    const canvases = Array.from(surface.querySelectorAll('canvas'));
    const renderer = canvases[0];
    if (!renderer?.width || !renderer?.height || !safeToDraw(renderer)) {
        const error = new Error('The browser cannot safely capture the rendered footage frame.');
        error.code = 'SCENE_REVIEW_CAPTURE_BLOCKED';
        throw error;
    }
    const rendererRect = relativeRect(renderer);
    context.drawImage(renderer, rendererRect.x, rendererRect.y, rendererRect.w, rendererRect.h);

    const overlayLayers = Array.from(surface.querySelectorAll('[data-snap-id]'));
    for (const layer of overlayLayers) {
        if (!layer.isConnected || getComputedStyle(layer).visibility === 'hidden') continue;
        const layerRect = relativeRect(layer);
        if (layerRect.w <= 0 || layerRect.h <= 0) continue;
        const media = Array.from(layer.querySelectorAll('canvas, img, video'))
            .filter(element => element instanceof HTMLCanvasElement || element instanceof HTMLVideoElement || element.complete);
        if (media.length) {
            for (const element of media) {
                if (!safeToDraw(element)) continue;
                const rect = relativeRect(element);
                if (rect.w <= 0 || rect.h <= 0) continue;
                const style = getComputedStyle(element);
                context.save();
                context.globalAlpha = Math.max(0, Math.min(1, Number(style.opacity) || 0));
                if ('filter' in context && style.filter && style.filter !== 'none') context.filter = style.filter;
                const matrix = transformMatrix(layer);
                const layerCenter = centerOf(layerRect);
                applyTransform(context, matrix, layerCenter);
                const mediaCenter = inversePoint(centerOf(rect), layerCenter, matrix);
                const mediaWidth = element.offsetWidth || rect.w;
                const mediaHeight = element.offsetHeight || rect.h;
                try {
                    if (element instanceof HTMLVideoElement && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                        context.drawImage(element, mediaCenter.x - mediaWidth / 2, mediaCenter.y - mediaHeight / 2, mediaWidth, mediaHeight);
                    } else if (element instanceof HTMLCanvasElement || element instanceof HTMLImageElement) {
                        context.drawImage(element, mediaCenter.x - mediaWidth / 2, mediaCenter.y - mediaHeight / 2, mediaWidth, mediaHeight);
                    }
                } catch { /* a media layer can become unavailable during a seek */ }
                context.restore();
            }
            continue;
        }

        // TextOverlay is DOM by design, while the renderer below it is canvas.
        // Use browser-measured glyph rectangles so wrapping, transforms, and
        // animated positions match the frame at the current playhead time.
        const layerStyle = getComputedStyle(layer);
        const matrix = transformMatrix(layer);
        const layerCenter = centerOf(layerRect);
        context.save();
        context.globalAlpha = opacityTo(layer, surface);
        if (layerStyle.filter && layerStyle.filter !== 'none') context.filter = layerStyle.filter;
        applyTransform(context, matrix, layerCenter);
        const localWidth = layer.offsetWidth || layerRect.w;
        const localHeight = layer.offsetHeight || layerRect.h;
        const localLayerRect = { x: layerCenter.x - localWidth / 2, y: layerCenter.y - localHeight / 2, w: localWidth, h: localHeight };
        const background = layerStyle.backgroundColor;
        if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
            roundedRect(context, localLayerRect, layerStyle.borderTopLeftRadius);
            context.fillStyle = background;
            context.fill();
        }
        const cssGradient = makeCssGradient(context, layerStyle.backgroundImage, localLayerRect);
        if (cssGradient) {
            roundedRect(context, localLayerRect, layerStyle.borderTopLeftRadius);
            context.fillStyle = cssGradient;
            context.fill();
        }
        const borderWidth = parseFloat(layerStyle.borderTopWidth) || 0;
        if (borderWidth > 0 && layerStyle.borderTopColor !== 'rgba(0, 0, 0, 0)') {
            roundedRect(context, localLayerRect, layerStyle.borderTopLeftRadius);
            context.lineWidth = borderWidth;
            context.strokeStyle = layerStyle.borderTopColor;
            context.stroke();
        }

        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT, {
            acceptNode: node => node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
        });
        const range = document.createRange();
        let textNode;
        while ((textNode = walker.nextNode())) {
            const owner = textNode.parentElement;
            if (!owner) continue;
            const style = getComputedStyle(owner);
            const fontSize = parseFloat(style.fontSize) || 16;
            if (fontSize < 1 || style.visibility === 'hidden') continue;
            context.font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
            context.textAlign = 'left';
            context.textBaseline = 'alphabetic';
            context.fillStyle = style.color || '#fff';
            context.globalAlpha = opacityTo(owner, surface);
            if (style.textShadow && style.textShadow !== 'none') {
                const shadow = style.textShadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(rgba?\([^)]*\)|#[\da-f]+)/i);
                if (shadow) {
                    context.shadowOffsetX = Number(shadow[1]);
                    context.shadowOffsetY = Number(shadow[2]);
                    context.shadowBlur = Number(shadow[3]);
                    context.shadowColor = shadow[4];
                }
            }
            const stroke = style.webkitTextStroke;
            const strokeMatch = stroke && stroke.match(/^([\d.]+)px\s+(.+)$/);
            if (strokeMatch) {
                context.lineWidth = Number(strokeMatch[1]) * 2;
                context.strokeStyle = strokeMatch[2];
            }

            const chars = Array.from(textNode.nodeValue);
            let offset = 0;
            for (let char of chars) {
                if (style.textTransform === 'uppercase') char = char.toUpperCase();
                else if (style.textTransform === 'lowercase') char = char.toLowerCase();
                const start = offset;
                offset += char.length;
                range.setStart(textNode, start);
                range.setEnd(textNode, offset);
                const rect = range.getBoundingClientRect();
                if (!rect.width || !rect.height) continue;
                const screenCenter = {
                    x: rect.left - surfaceRect.left + rect.width / 2,
                    y: rect.top - surfaceRect.top + rect.height / 2,
                };
                const localCenter = inversePoint(screenCenter, layerCenter, matrix);
                const x = localCenter.x - rect.width / 2;
                const y = localCenter.y + fontSize * 0.34;
                if (strokeMatch) context.strokeText(char, x, y);
                context.fillText(char, x, y);
            }
            context.shadowColor = 'transparent';
            context.shadowBlur = 0;
            context.shadowOffsetX = 0;
            context.shadowOffsetY = 0;
            context.lineWidth = 1;
        }
        context.restore();
    }

    context.restore();
    return output.toDataURL('image/jpeg', 0.78);
}

function opacityTo(element, stopAt) {
    let opacity = 1;
    for (let current = element; current && current !== stopAt; current = current.parentElement) {
        const value = Number(getComputedStyle(current).opacity);
        if (Number.isFinite(value)) opacity *= value;
    }
    return Math.max(0, Math.min(1, opacity));
}

function centerOf(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function transformMatrix(element) {
    const value = getComputedStyle(element).transform;
    if (!value || value === 'none') return { a: 1, b: 0, c: 0, d: 1 };
    try {
        const matrix = new DOMMatrixReadOnly(value);
        return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
    } catch {
        return { a: 1, b: 0, c: 0, d: 1 };
    }
}

function applyTransform(context, matrix, center) {
    context.translate(center.x, center.y);
    context.transform(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0);
    context.translate(-center.x, -center.y);
}

function inversePoint(point, center, matrix) {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!determinant) return point;
    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
        x: center.x + (matrix.d * x - matrix.c * y) / determinant,
        y: center.y + (-matrix.b * x + matrix.a * y) / determinant,
    };
}

function roundedRect(context, rect, radiusValue) {
    const radius = Math.max(0, Math.min(parseFloat(radiusValue) || 0, rect.w / 2, rect.h / 2));
    context.beginPath();
    if (typeof context.roundRect === 'function') {
        context.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    } else {
        context.rect(rect.x, rect.y, rect.w, rect.h);
    }
}

function makeCssGradient(context, backgroundImage, rect) {
    const match = String(backgroundImage || '').match(/^(linear|radial|conic)-gradient\((.*)\)$/i);
    if (!match) return null;
    const kind = match[1].toLowerCase();
    const parts = splitCssArgs(match[2]);
    const first = parts[0] || '';
    const hasDirection = /(?:deg|turn|rad|to\s+(?:top|bottom|left|right))/i.test(first);
    const direction = hasDirection ? parts.shift() : '';
    const stops = parts.map(part => {
        const color = part.match(/rgba?\([^)]*\)|#[\da-f]{3,8}/i)?.[0];
        if (!color) return null;
        const position = part.slice(part.indexOf(color) + color.length).match(/(-?[\d.]+)%/);
        return { color, position: position ? Math.max(0, Math.min(1, Number(position[1]) / 100)) : null };
    }).filter(Boolean);
    if (stops.length < 2) return null;

    let gradient;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    if (kind === 'linear') {
        const degrees = gradientDegrees(direction);
        const radians = (degrees - 90) * Math.PI / 180;
        const dx = Math.sin(radians);
        const dy = -Math.cos(radians);
        const halfLength = Math.abs(dx) * rect.w / 2 + Math.abs(dy) * rect.h / 2;
        gradient = context.createLinearGradient(cx - dx * halfLength, cy - dy * halfLength, cx + dx * halfLength, cy + dy * halfLength);
    } else if (kind === 'radial') {
        const radius = Math.max(rect.w, rect.h) / 2;
        gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
    } else if (typeof context.createConicGradient === 'function') {
        gradient = context.createConicGradient(gradientDegrees(direction) * Math.PI / 180, cx, cy);
    } else return null;

    stops.forEach((stop, index) => {
        const offset = stop.position ?? index / (stops.length - 1);
        try { gradient.addColorStop(offset, stop.color); } catch { /* ignore an invalid CSS stop */ }
    });
    return gradient;
}

function splitCssArgs(value) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < value.length; index++) {
        if (value[index] === '(') depth++;
        else if (value[index] === ')') depth--;
        else if (value[index] === ',' && depth === 0) {
            parts.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(value.slice(start).trim());
    return parts;
}

function gradientDegrees(direction) {
    const angle = String(direction || '').match(/(-?[\d.]+)deg/i);
    if (angle) return Number(angle[1]);
    const turns = String(direction || '').match(/(-?[\d.]+)turn/i);
    if (turns) return Number(turns[1]) * 360;
    const radians = String(direction || '').match(/(-?[\d.]+)rad/i);
    if (radians) return Number(radians[1]) * 180 / Math.PI;
    const text = String(direction || '').toLowerCase();
    if (text.includes('to right')) return 90;
    if (text.includes('to left')) return 270;
    if (text.includes('to top')) return 0;
    return 180;
}

export default captureReviewFrame;
