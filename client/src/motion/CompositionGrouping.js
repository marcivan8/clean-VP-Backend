import { resolveMotionAt } from './MotionResolver.js';

/** Resolve nested group opacity on the same timeline clock as child layers. */
export function resolveCompositionOpacity(stack, time) {
    return (Array.isArray(stack) ? stack : []).reduce((product, group) => {
        const motion = resolveMotionAt({
            startTime: Number(group?.start) || 0,
            duration: Number(group?.duration) || 0,
            opacity: 1,
            animations: group?.opacityAnimations || [],
            expressions: group?.opacityExpression ? { opacity: group.opacityExpression } : {},
        }, time);
        const opacity = Math.max(0, Math.min(1, Number(group?.opacity ?? 1) * motion.opacity));
        return product * opacity;
    }, 1);
}

/**
 * Rebuild isolated composition boundaries after scene layers have been
 * flattened onto timeline tracks. Track sorting can make siblings non-adjacent,
 * so grouping must use their composition ancestry rather than adjacent runs.
 *
 * The first child establishes the group's position in the parent layer order;
 * children retain their original bottom-to-top order inside that group.
 */
export function groupCompositionEntries(entries, depth = 0) {
    const source = Array.isArray(entries) ? entries : [];
    const consumed = new Set();
    const output = [];

    for (let index = 0; index < source.length; index++) {
        if (consumed.has(index)) continue;
        const entry = source[index];
        const stack = Array.isArray(entry?.clip?.compositionStack) ? entry.clip.compositionStack : [];
        const group = stack[depth];
        if (!group?.id) {
            consumed.add(index);
            output.push({ type: 'layer', entry });
            continue;
        }

        // Require the same parent path and scene scope: node IDs may only be
        // unique within their scene document.
        const sceneId = entry?.clip?.sceneId ?? null;
        const parentPath = stack.slice(0, depth).map(item => item?.id);
        const members = [];
        for (let candidate = index; candidate < source.length; candidate++) {
            if (consumed.has(candidate)) continue;
            const candidateStack = Array.isArray(source[candidate]?.clip?.compositionStack)
                ? source[candidate].clip.compositionStack : [];
            const candidateGroup = candidateStack[depth];
            if (candidateGroup?.id !== group.id) continue;
            if ((source[candidate]?.clip?.sceneId ?? null) !== sceneId) continue;
            if (!parentPath.every((id, parentIndex) => candidateStack[parentIndex]?.id === id)) continue;
            consumed.add(candidate);
            members.push(source[candidate]);
        }

        output.push({
            type: 'composition',
            group,
            key: `${sceneId ?? 'no-scene'}:${parentPath.join('/')}:${group.id}`,
            children: groupCompositionEntries(members, depth + 1),
        });
    }

    return output;
}

