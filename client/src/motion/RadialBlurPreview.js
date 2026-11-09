/** Bounded Canvas zoom blur for previewing radial blur on media overlays. */
export function drawRadialBlur(context, source, width, height, radial = {}) {
    if (!context || !source || !width || !height) return;
    const samples = Math.max(1, Math.min(16, Math.round(Number(radial.samples) || 12)));
    const intensity = Math.max(0, Math.min(1, Number(radial.intensity) || 0));
    const centerX = width * Math.max(0, Math.min(1, Number(radial.centerX ?? 0.5)));
    const centerY = height * Math.max(0, Math.min(1, Number(radial.centerY ?? 0.5)));
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = 1 / samples;
    for (let index = 0; index < samples; index++) {
        const progress = index / samples;
        const factor = 1 / Math.max(0.5, 1 - progress * intensity * 0.5);
        context.save();
        context.translate(centerX, centerY);
        context.scale(factor, factor);
        context.translate(-centerX, -centerY);
        context.drawImage(source, 0, 0, width, height);
        context.restore();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
}

export function previewCanvasSize(width, height) {
    const scale = Math.min(1, 512 / Math.max(Number(width) || 1, Number(height) || 1));
    return { width: Math.max(1, Math.round((Number(width) || 1) * scale)), height: Math.max(1, Math.round((Number(height) || 1) * scale)) };
}
