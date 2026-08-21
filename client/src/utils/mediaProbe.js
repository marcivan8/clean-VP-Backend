/**
 * Utility for extracting metadata and generating thumbnails from media files
 * Runs entirely on the client side using native browser APIs.
 */

export const probeMedia = async (file) => {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const type = file.type.split('/')[0];

        if (type === 'video') {
            extractVideoMetadata(url).then(meta => {
                URL.revokeObjectURL(url);
                resolve(meta);
            }).catch(err => {
                URL.revokeObjectURL(url);
                reject(err);
            });
        } else if (type === 'audio') {
            extractAudioMetadata(url).then(meta => {
                URL.revokeObjectURL(url);
                resolve(meta);
            }).catch(err => {
                URL.revokeObjectURL(url);
                reject(err);
            });
        } else if (type === 'image') {
            extractImageMetadata(url).then(meta => {
                URL.revokeObjectURL(url);
                resolve(meta);
            }).catch(err => {
                URL.revokeObjectURL(url);
                reject(err);
            });
        } else {
            reject(new Error(`Unsupported media type: ${file.type}`));
        }
    });
};

const extractVideoMetadata = (url) => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.preload = 'metadata';
        video.muted = true; // Required for unmuted autoplay policies in some browsers

        // BUG: this promise had no timeout. `onloadedmetadata` failing to fire
        // — with no `onerror` either — is a known iOS Safari failure mode for
        // large blob: URLs (a freshly-recorded phone video can be hundreds of
        // MB) under memory pressure: the browser just never finishes loading
        // metadata, silently, forever. handleFileImport in IDELayout.jsx
        // `await`s this per file in a sequential loop — a stuck probe hangs
        // that whole upload indefinitely, and since aspect-ratio auto-detection
        // (detectAspectRatio) only runs AFTER this resolves, the project's
        // aspectRatio field never leaves its '16:9' default. That's the root
        // cause of exports coming out 16:9 "no matter what setting you choose"
        // when no platform preset is picked (the project's own aspect ratio is
        // what a platform-less export falls back to) — it's not a setting
        // being ignored, it's this probe never completing in the first place.
        // 12s is generous for reading a moov atom's worth of metadata even on
        // a slow connection; a real load taking longer than that would have
        // already made the editor feel broken well before export.
        const PROBE_TIMEOUT_MS = 12000;
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            console.warn('[mediaProbe] Timed out waiting for video metadata (12s) — aspect ratio/duration will fall back to defaults.');
            reject(new Error('Timed out loading video metadata'));
        }, PROBE_TIMEOUT_MS);
        const clearProbeTimeout = () => { settled = true; clearTimeout(timeoutId); };

        video.onloadedmetadata = () => {
            clearProbeTimeout();
            // We have basic metadata, now seek to 25% to grab a thumbnail
            const duration = video.duration || 0;
            const width = video.videoWidth || 0;
            const height = video.videoHeight || 0;
            const fps = 30; // Native FPS extraction is hard in browsers, default to 30

            // If duration is 0, we can't seek meaningfully
            if (duration === 0) {
                 resolve({ duration, width, height, fps, thumbnail: null });
                 return;
            }

            // Seek to 25% of the video to avoid black intro frames
            const targetTime = Math.min(duration * 0.25, 2); 
            
            video.onseeked = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 320;
                    const scale = width > 0 ? Math.min(MAX_WIDTH / width, 1) : 1;
                    canvas.width = (width * scale) || MAX_WIDTH;
                    canvas.height = (height * scale) || (MAX_WIDTH * 9/16);
                    
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const thumbnail = canvas.toDataURL('image/jpeg', 0.8);
                    
                    resolve({ duration, width, height, fps, thumbnail });
                } catch (e) {
                    console.warn("Failed to generate thumbnail for video", e);
                    resolve({ duration, width, height, fps, thumbnail: null });
                }
            };

            video.onerror = () => {
                console.warn("Failed to seek video for thumbnail");
                resolve({ duration, width, height, fps, thumbnail: null });
            };
            
            video.currentTime = targetTime;
        };

        video.onerror = () => {
            if (settled) return;
            clearProbeTimeout();
            reject(new Error("Failed to load video metadata"));
        };
        video.src = url;
        video.load();
    });
};

const extractAudioMetadata = (url) => {
    return new Promise((resolve, reject) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        
        audio.onloadedmetadata = () => {
            resolve({ duration: audio.duration, thumbnail: null });
        };
        
        audio.onerror = () => reject(new Error("Failed to load audio metadata"));
        audio.src = url;
    });
};

const extractImageMetadata = (url) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            try {
                // Generate a smaller thumbnail
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 320;
                const scale = Math.min(MAX_WIDTH / img.naturalWidth, 1);
                canvas.width = img.naturalWidth * scale;
                canvas.height = img.naturalHeight * scale;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const thumbnail = canvas.toDataURL('image/jpeg', 0.8);

                resolve({ 
                    width: img.naturalWidth, 
                    height: img.naturalHeight, 
                    thumbnail 
                });
            } catch (e) {
                console.warn("Failed to generate thumbnail for image", e);
                resolve({ 
                    width: img.naturalWidth, 
                    height: img.naturalHeight, 
                    thumbnail: url // Fallback to raw URL
                });
            }
        };
        
        img.onerror = () => reject(new Error("Failed to load image metadata"));
        img.src = url;
    });
};
