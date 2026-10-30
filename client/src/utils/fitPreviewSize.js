/** Contain a frame with the given aspect ratio inside a measured box. */
export function fitPreviewSize(containerWidth, containerHeight, aspectRatio) {
    const width = Number(containerWidth);
    const height = Number(containerHeight);
    const ratio = Number(aspectRatio);
    if (!(width > 0) || !(height > 0) || !(ratio > 0)) {
        return { width: 0, height: 0 };
    }

    const fittedWidth = Math.min(width, height * ratio);
    const fittedHeight = fittedWidth / ratio;
    return { width: fittedWidth, height: fittedHeight };
}
