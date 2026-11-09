/**
 * Revideo imports hls.js at module scope, even when every source is a normal
 * MP4. Keep that dependency out of the editor's initial chunk and load it only
 * for HLS playlists. This adapter implements the small API Revideo's Video
 * node uses (loadSource + attachMedia).
 */
export default class LazyHls {
  constructor(config, loadHls = () => import('hls.js/dist/hls.mjs')) {
    this.config = config;
    this.loadHls = loadHls;
    this.source = null;
    this.media = null;
    this.instance = null;
    this.destroyed = false;
    this.loading = null;
  }

  loadSource(source) {
    this.source = source;
    this.attachWhenReady();
  }

  attachMedia(media) {
    this.media = media;
    this.attachWhenReady();
  }

  attachWhenReady() {
    if (this.loading || this.instance || this.destroyed || !this.source || !this.media) return;
    // Import the package entry directly so Vite's exact-package alias above
    // does not rewrite this lazy edge back to this adapter.
    this.loading = this.loadHls().then(({ default: Hls }) => {
      if (this.destroyed) return;
      const instance = new Hls(this.config);
      this.instance = instance;
      instance.loadSource(this.source);
      instance.attachMedia(this.media);
    }).catch((error) => {
      // Revideo will report the media element's normal playback failure. Log
      // the module-load error here so HLS-only failures are still diagnosable.
      console.error('[LazyHls] Unable to load HLS playback support', error);
    }).finally(() => {
      this.loading = null;
    });
  }

  destroy() {
    this.destroyed = true;
    this.instance?.destroy();
    this.instance = null;
  }
}
