/** Shared, bounded cache for muted video textures used by live 3D scenes. */
export class VideoTextureCache {
    constructor(createVideo, limit = 12) {
        this.createVideo = createVideo;
        this.limit = Math.max(1, Math.floor(Number(limit) || 12));
        this.entries = new Map();
    }

    #touch(url, entry) {
        this.entries.delete(url);
        this.entries.set(url, entry);
    }

    #dispose(url, entry) {
        this.entries.delete(url);
        entry.video.removeEventListener?.('loadeddata', entry.notify);
        entry.video.removeEventListener?.('seeked', entry.notify);
        entry.video.pause?.();
        entry.video.removeAttribute?.('src');
        entry.video.load?.();
    }

    #trim() {
        while (this.entries.size > this.limit) {
            const candidate = [...this.entries.entries()].find(([, entry]) => entry.subscribers.size === 0);
            if (!candidate) return;
            this.#dispose(...candidate);
        }
    }

    get(url) {
        const entry = this.entries.get(url);
        if (!entry) return null;
        this.#touch(url, entry);
        return entry.video.readyState >= 2 ? entry.video : null;
    }

    subscribe(url, onFrame) {
        if (!url || typeof this.createVideo !== 'function') return () => {};
        let entry = this.entries.get(url);
        if (!entry) {
            const video = this.createVideo();
            if (!video) return () => {};
            const subscribers = new Set();
            const notify = () => subscribers.forEach(callback => callback());
            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.crossOrigin = 'anonymous';
            video.addEventListener('loadeddata', notify);
            video.addEventListener('seeked', notify);
            video.addEventListener('error', () => console.warn('[TemplateCanvas] 3D video texture failed to load'));
            entry = { video, subscribers, notify };
            this.entries.set(url, entry);
            video.src = url;
            video.load();
        } else this.#touch(url, entry);

        entry.subscribers.add(onFrame);
        if (entry.video.readyState >= 2) onFrame();
        this.#trim();
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            entry.subscribers.delete(onFrame);
            this.#trim();
        };
    }

    clear() {
        for (const [url, entry] of this.entries) this.#dispose(url, entry);
    }
}

export function createBrowserVideoTextureCache(limit = 12) {
    return new VideoTextureCache(
        () => typeof document !== 'undefined' ? document.createElement('video') : null,
        limit,
    );
}

/** Resolve scene video texture sources the same way export resolves asset IDs. */
export function resolveSceneVideoTextures(objects = [], assets = []) {
    const byId = new Map((Array.isArray(assets) ? assets : [])
        .filter(asset => asset?.id)
        .map(asset => [asset.id, asset]));
    return (Array.isArray(objects) ? objects : [])
        .filter(object => object?.type === 'video')
        .map(object => {
            const asset = object.videoAssetId ? byId.get(object.videoAssetId) : null;
            // Keep precedence identical to exportProcessor's assetMap lookup:
            // explicit scene URL, then original source, proxy, and public URL.
            const url = object.videoUrl || asset?.sourceUrl || asset?.proxyUrl || asset?.url || null;
            return { object, url, textureKey: object.videoTextureKey || object.id || url };
        })
        .filter(texture => texture.url && texture.textureKey);
}

/** Resolve still-image and mesh textures from the project asset manifest. */
export function resolveSceneImageTextures(objects = [], assets = []) {
    const byId = new Map((Array.isArray(assets) ? assets : [])
        .filter(asset => asset?.id)
        .map(asset => [asset.id, asset]));
    return (Array.isArray(objects) ? objects : [])
        .filter(object => ['image', 'mesh'].includes(object?.type))
        .map(object => {
            const asset = object.imageAssetId ? byId.get(object.imageAssetId) : null;
            const url = object.imageUrl || object.textureUrl || asset?.sourceUrl || asset?.proxyUrl || asset?.url || null;
            return { object, url };
        })
        .filter(texture => texture.url);
}

/** List audio assets needed by scene objects and procedural particle systems. */
export function resolveSceneAudioReactiveAssetIds(scene = {}) {
    return [...new Set([
        ...(Array.isArray(scene?.objects) ? scene.objects : []).map(object => object?.audioReactive?.assetId),
        scene?.particles?.audioReactive?.assetId,
    ].filter(value => typeof value === 'string' && value.length > 0))];
}
