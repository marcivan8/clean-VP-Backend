/** True when media is guidance/reference material and must never be editable footage. */
export function isReferenceAsset(asset) {
    return asset?.assistantReference === true
        || asset?.isReference === true
        || asset?.is_reference === true
        || asset?.role === 'reference';
}
