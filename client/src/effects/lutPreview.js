/**
 * Parse the deliberately small CSS filter subset returned by the LUT preview
 * API into a color matrix that can be applied to a WebGL video texture.
 * This is a preview approximation; export continues to use the source .cube.
 */
const IDENTITY = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
];

function multiply(a, b) {
    return a.map((row, r) => row.map((_, c) =>
        row.reduce((sum, value, k) => sum + value * b[k][c], 0)));
}

function operation(name, raw, unit = '') {
    let amount = Number(raw);
    if (!Number.isFinite(amount)) return null;
    if (name === 'hue-rotate' ? !['deg', 'rad'].includes(unit) : !['', '%'].includes(unit)) return null;
    const pct = unit === '%';
    if (pct) amount /= 100;
    const diagonal = (r, g, b, bias = [0, 0, 0]) => [
        [r, 0, 0, bias[0]], [0, g, 0, bias[1]], [0, 0, b, bias[2]], [0, 0, 0, 1],
    ];
    switch (name) {
        case 'brightness': return diagonal(amount, amount, amount);
        case 'contrast': return diagonal(amount, amount, amount, [0.5 * (1 - amount), 0.5 * (1 - amount), 0.5 * (1 - amount)]);
        case 'saturate': {
            const s = amount;
            const ir = 0.2126 * (1 - s), ig = 0.7152 * (1 - s), ib = 0.0722 * (1 - s);
            return [[ir + s, ig, ib, 0], [ir, ig + s, ib, 0], [ir, ig, ib + s, 0], [0, 0, 0, 1]];
        }
        case 'grayscale': {
            const s = 1 - amount;
            const r = 0.2126, g = 0.7152, b = 0.0722;
            return [[r + s * (1 - r), g * (1 - s), b * (1 - s), 0], [r * (1 - s), g + s * (1 - g), b * (1 - s), 0], [r * (1 - s), g * (1 - s), b + s * (1 - b), 0], [0, 0, 0, 1]];
        }
        case 'sepia': {
            const s = 1 - amount;
            return [[0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0], [0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0], [0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0], [0, 0, 0, 1]];
        }
        case 'invert': return diagonal(1 - 2 * amount, 1 - 2 * amount, 1 - 2 * amount, [amount, amount, amount]);
        case 'hue-rotate': {
            const angle = (unit === 'deg' ? amount : amount * 180 / Math.PI) * Math.PI / 180;
            const c = Math.cos(angle), s = Math.sin(angle);
            return [
                [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0],
                [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0],
                [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0],
                [0, 0, 0, 1],
            ];
        }
        default: return null;
    }
}

/** Return four RGBA rows (the last row is identity) or null if unsupported. */
export function cssFilterToColorMatrix(filter) {
    const source = String(filter || '').trim();
    if (!source || source === 'none') return IDENTITY.map(row => [...row]);
    const pattern = /([a-z-]+)\(\s*([-+\d.eE]+)\s*(%|deg|rad)?\s*\)/gy;
    let cursor = 0;
    let matrix = IDENTITY.map(row => [...row]);
    while (cursor < source.length) {
        while (/\s/.test(source[cursor] || '')) cursor++;
        pattern.lastIndex = cursor;
        const match = pattern.exec(source);
        if (!match) return null;
        const op = operation(match[1].toLowerCase(), match[2], match[3] || '');
        if (!op) return null;
        matrix = multiply(op, matrix);
        cursor = pattern.lastIndex;
    }
    return matrix.slice(0, 3).map(row => row.slice(0, 4)).concat([[0, 0, 0, 1]]);
}

/** Scale supported CSS color functions using the editor's neutral values. */
export function scaleCssFilterIntensity(filter, intensity = 1) {
    const source = String(filter || '').trim();
    const amount = Math.max(0, Math.min(1, Number.isFinite(Number(intensity)) ? Number(intensity) : 1));
    if (!source || source === 'none') return source;
    const functions = [...source.matchAll(/([a-z-]+)\(\s*([-+\d.eE]+)\s*(%|deg|rad)?\s*\)/gi)];
    if (!functions.length || functions.some(match => !['brightness', 'contrast', 'saturate', 'sepia', 'grayscale', 'invert', 'hue-rotate'].includes(match[1].toLowerCase()))) {
        return amount >= 0.999 ? source : null;
    }
    return functions.map(([, name, raw, unit = '']) => {
        const numeric = Number(raw);
        const identity = name.toLowerCase() === 'hue-rotate' ? 0
            : ['sepia', 'grayscale', 'invert'].includes(name.toLowerCase()) ? 0 : 1;
        return `${name}(${Number((identity + (numeric - identity) * amount).toFixed(4))}${unit})`;
    }).join(' ');
}

