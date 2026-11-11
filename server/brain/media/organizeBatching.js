'use strict';

function chunkItems(items, chunkSize) {
    const values = Array.isArray(items) ? items : [];
    const size = Math.max(1, Math.floor(Number(chunkSize) || 1));
    const chunks = [];
    for (let start = 0; start < values.length; start += size) {
        chunks.push(values.slice(start, start + size));
    }
    return chunks;
}

/** Keep model output constrained to the requested IDs and append any omissions. */
function completeOrder(requestedIds, proposedIds) {
    const allowed = new Set((requestedIds || []).map(String));
    const result = [];
    const seen = new Set();
    for (const value of proposedIds || []) {
        const id = String(value);
        if (allowed.has(id) && !seen.has(id)) { result.push(id); seen.add(id); }
    }
    for (const value of requestedIds || []) {
        const id = String(value);
        if (!seen.has(id)) { result.push(id); seen.add(id); }
    }
    return result;
}

/** Flatten locally ordered groups in a globally selected group order. */
function mergeGroupOrders(groups, proposedGroupIds) {
    const byId = new Map((groups || []).map(group => [String(group.id), group]));
    const orderedGroupIds = completeOrder([...byId.keys()], proposedGroupIds);
    return orderedGroupIds.flatMap(id => (byId.get(id)?.orderedIds || []).map(String));
}

module.exports = { chunkItems, completeOrder, mergeGroupOrders };
