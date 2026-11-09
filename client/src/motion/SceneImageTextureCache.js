/** Bounded CPU pixel cache for immutable still-image scene textures. */
export class SceneImageTextureCache {
    constructor(maxBytes = 48 * 1024 * 1024) {
        this.maxBytes = Math.max(0, Number(maxBytes) || 0);
        this.bytes = 0;
        this.entries = new Map();
    }

    #signature(source) {
        const width = Number(source?.naturalWidth || source?.width) || 0;
        const height = Number(source?.naturalHeight || source?.height) || 0;
        const url = String(source?.currentSrc || source?.src || '');
        return `${url}|${width}x${height}`;
    }

    #isImmutableStill(source) {
        if (!source || source.videoWidth || source.tagName === 'CANVAS' || source.getContext) return false;
        if (source.constructor?.name === 'ImageBitmap') return true;
        if (String(source.tagName || '').toUpperCase() !== 'IMG') return false;
        const url = String(source.currentSrc || source.src || '').split(/[?#]/, 1)[0];
        return /\.(?:png|jpe?g|webp|avif|bmp|svg)$/i.test(url);
    }

    get(source) {
        if (!this.#isImmutableStill(source)) return null;
        const entry = this.entries.get(source);
        if (!entry) return null;
        const signature = this.#signature(source);
        if (entry.signature !== signature) {
            this.entries.delete(source);
            this.bytes -= entry.bytes;
            return null;
        }
        this.entries.delete(source);
        this.entries.set(source, entry);
        return entry.texture;
    }

    set(source, texture) {
        if (!this.#isImmutableStill(source) || !texture?.data) return false;
        const bytes = Number(texture.data.byteLength) || 0;
        if (!bytes || bytes > this.maxBytes) return false;
        const old = this.entries.get(source);
        if (old) this.bytes -= old.bytes;
        this.entries.delete(source);
        this.entries.set(source, { texture, bytes, signature: this.#signature(source) });
        this.bytes += bytes;
        while (this.bytes > this.maxBytes && this.entries.size) {
            const [key, entry] = this.entries.entries().next().value;
            this.entries.delete(key);
            this.bytes -= entry.bytes;
        }
        return this.entries.has(source);
    }

    clear() {
        this.entries.clear();
        this.bytes = 0;
    }
}

export const sceneImageTextureCache = new SceneImageTextureCache();
