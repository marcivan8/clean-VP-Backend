/**
 * client/src/design-studio/autoLayout.js
 *
 * Professional Auto Layout (CSS Flexbox-inspired), Constraints,
 * Responsive Resizing, and Smart Selection Spacing Engine.
 *
 * Strictly zero emojis.
 */

/**
 * Resolves positions and dimensions of child layers within an Auto Layout Frame.
 *
 * @param {object} frame Frame layer with autoLayout configuration
 * @param {Array<object>} children Array of child layer objects
 * @returns {{ frameUpdates: object, childrenUpdates: Array<{ id: string, x: number, y: number, w: number, h: number }> }}
 */
export function resolveAutoLayout(frame, children) {
    if (!frame || !children || children.length === 0) {
        return { frameUpdates: {}, childrenUpdates: [] };
    }

    const al = frame.autoLayout || {
        enabled: true,
        direction: 'horizontal', // 'horizontal' | 'vertical' | 'wrap'
        gap: 16,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        alignItems: 'center', // 'start' | 'center' | 'end'
        justifyContent: 'start', // 'start' | 'center' | 'end' | 'space-between'
        sizingH: 'hug', // 'fixed' | 'hug' | 'fill'
        sizingV: 'hug',
    };

    const isHorizontal = al.direction !== 'vertical';
    const pLeft = Number(al.paddingLeft ?? al.padding ?? 16);
    const pRight = Number(al.paddingRight ?? al.padding ?? 16);
    const pTop = Number(al.paddingTop ?? al.padding ?? 16);
    const pBottom = Number(al.paddingBottom ?? al.padding ?? 16);
    const gap = Number(al.gap ?? 16);

    const childrenUpdates = [];

    let currentOffset = isHorizontal ? pLeft : pTop;
    let maxCrossDimension = 0;

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childW = Number(child.w || 100);
        const childH = Number(child.h || 40);

        let x = child.x;
        let y = child.y;

        if (isHorizontal) {
            x = currentOffset;
            // Cross-axis alignment
            if (al.alignItems === 'center') {
                const targetH = frame.h || (childH + pTop + pBottom);
                y = pTop + Math.max(0, (targetH - pTop - pBottom - childH) / 2);
            } else if (al.alignItems === 'end') {
                const targetH = frame.h || (childH + pTop + pBottom);
                y = targetH - pBottom - childH;
            } else {
                y = pTop;
            }
            currentOffset += childW + gap;
            maxCrossDimension = Math.max(maxCrossDimension, childH);
        } else {
            y = currentOffset;
            // Cross-axis alignment
            if (al.alignItems === 'center') {
                const targetW = frame.w || (childW + pLeft + pRight);
                x = pLeft + Math.max(0, (targetW - pLeft - pRight - childW) / 2);
            } else if (al.alignItems === 'end') {
                const targetW = frame.w || (childW + pLeft + pRight);
                x = targetW - pRight - childW;
            } else {
                x = pLeft;
            }
            currentOffset += childH + gap;
            maxCrossDimension = Math.max(maxCrossDimension, childW);
        }

        childrenUpdates.push({
            id: child.id,
            x: Math.round(x),
            y: Math.round(y),
            w: childW,
            h: childH,
        });
    }

    // Determine final frame bounds if 'hug' mode is active
    const frameUpdates = {};
    if (isHorizontal) {
        const totalContentW = currentOffset - gap + pRight;
        if (al.sizingH === 'hug') frameUpdates.w = Math.max(40, Math.round(totalContentW));
        if (al.sizingV === 'hug') frameUpdates.h = Math.max(40, Math.round(maxCrossDimension + pTop + pBottom));
    } else {
        const totalContentH = currentOffset - gap + pBottom;
        if (al.sizingH === 'hug') frameUpdates.w = Math.max(40, Math.round(maxCrossDimension + pLeft + pRight));
        if (al.sizingV === 'hug') frameUpdates.h = Math.max(40, Math.round(totalContentH));
    }

    return { frameUpdates, childrenUpdates };
}

/**
 * Computes responsive layer position and size when its parent frame is resized.
 *
 * @param {object} layer
 * @param {{ w: number, h: number }} oldFrame
 * @param {{ w: number, h: number }} newFrame
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function applyConstraints(layer, oldFrame, newFrame) {
    if (!oldFrame || !newFrame || (oldFrame.w === newFrame.w && oldFrame.h === newFrame.h)) {
        return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    }

    const c = layer.constraints || { horizontal: 'left', vertical: 'top' };
    const dw = newFrame.w - oldFrame.w;
    const dh = newFrame.h - oldFrame.h;

    let { x, y, w, h } = layer;

    // Horizontal constraint
    switch (c.horizontal) {
        case 'right':
            x += dw;
            break;
        case 'center':
            x += dw / 2;
            break;
        case 'scale': {
            const scaleX = newFrame.w / Math.max(1, oldFrame.w);
            x *= scaleX;
            w *= scaleX;
            break;
        }
        case 'left_right': // stretch
            w = Math.max(10, w + dw);
            break;
        case 'left':
        default:
            // stays anchored to left
            break;
    }

    // Vertical constraint
    switch (c.vertical) {
        case 'bottom':
            y += dh;
            break;
        case 'center':
            y += dh / 2;
            break;
        case 'scale': {
            const scaleY = newFrame.h / Math.max(1, oldFrame.h);
            y *= scaleY;
            h *= scaleY;
            break;
        }
        case 'top_bottom': // stretch
            h = Math.max(10, h + dh);
            break;
        case 'top':
        default:
            // stays anchored to top
            break;
    }

    return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
    };
}

/**
 * Smart Selection: Distributes selected layers with uniform spacing.
 *
 * @param {Array<object>} layers
 * @param {'horizontal'|'vertical'|'auto'} axis
 * @param {number|null} targetGap
 * @returns {Array<object>} Array of updated layer objects
 */
export function distributeSmartSelection(layers, axis = 'auto', targetGap = null) {
    if (!layers || layers.length < 2) return layers;

    // Detect dominant axis if set to 'auto'
    const sortedX = [...layers].sort((a, b) => a.x - b.x);
    const sortedY = [...layers].sort((a, b) => a.y - b.y);

    const spanX = sortedX[sortedX.length - 1].x - sortedX[0].x;
    const spanY = sortedY[sortedY.length - 1].y - sortedY[0].y;

    const useHorizontal = axis === 'horizontal' || (axis === 'auto' && spanX >= spanY);
    const sorted = useHorizontal ? sortedX : sortedY;

    if (useHorizontal) {
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalItemsWidth = sorted.slice(0, -1).reduce((acc, l) => acc + (l.w || 100), 0);
        const totalDistance = (last.x + (last.w || 100)) - first.x;
        const computedGap = targetGap !== null
            ? targetGap
            : Math.max(0, (totalDistance - totalItemsWidth - (last.w || 100)) / (sorted.length - 1));

        let currentX = first.x;
        return sorted.map(l => {
            const updated = { ...l, x: Math.round(currentX) };
            currentX += (l.w || 100) + computedGap;
            return updated;
        });
    } else {
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalItemsHeight = sorted.slice(0, -1).reduce((acc, l) => acc + (l.h || 40), 0);
        const totalDistance = (last.y + (last.h || 40)) - first.y;
        const computedGap = targetGap !== null
            ? targetGap
            : Math.max(0, (totalDistance - totalItemsHeight - (last.h || 40)) / (sorted.length - 1));

        let currentY = first.y;
        return sorted.map(l => {
            const updated = { ...l, y: Math.round(currentY) };
            currentY += (l.h || 40) + computedGap;
            return updated;
        });
    }
}
