const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const storageConfig = require('../config/storage');

const uploadsRoot = path.resolve(__dirname, '../uploads');
const OWNED_PREFIXES = ['raw', 'proxies', 'analysis-only', 'ai-training'];

function parseOwnedObject(reference, userId) {
    if (typeof reference !== 'string' || !reference.trim()) return null;
    let value = reference.trim();
    try {
        if (value.startsWith('gs://')) {
            const parsed = new URL(value);
            if (storageConfig.bucket && parsed.hostname !== storageConfig.bucket.name) return null;
            value = parsed.pathname.replace(/^\//, '');
        } else if (/^https?:\/\//i.test(value)) {
            const parsed = new URL(value);
            if (parsed.pathname.startsWith('/api/proxy/gcs-media/')) {
                value = parsed.pathname.slice('/api/proxy/gcs-media/'.length);
            } else if (parsed.hostname === 'storage.googleapis.com' && storageConfig.bucket
                && parsed.pathname.startsWith(`/${storageConfig.bucket.name}/`)) {
                value = parsed.pathname.slice(storageConfig.bucket.name.length + 2);
            } else if (parsed.pathname.startsWith('/uploads/')) {
                value = parsed.pathname.slice('/uploads/'.length);
            } else return null;
        } else if (value.startsWith('/api/proxy/gcs-media/')) {
            value = value.slice('/api/proxy/gcs-media/'.length);
        } else if (value.startsWith('/uploads/')) {
            value = value.slice('/uploads/'.length);
        }
        value = decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/^\/+/, '');
    } catch { return null; }

    const parts = value.split('/');
    if (parts.length < 3 || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return null;
    if (!OWNED_PREFIXES.includes(parts[0]) || parts[1] !== String(userId)) return null;
    return parts.join('/');
}

async function resolveEffectMedia(reference, userId) {
    const objectPath = parseOwnedObject(reference, userId);
    if (!objectPath) throw new Error('Media reference is invalid or does not belong to this account');
    const extension = path.extname(objectPath).replace(/[^.a-zA-Z0-9]/g, '') || '.media';

    if (storageConfig.useLocalStorage || !storageConfig.bucket) {
        const localPath = path.resolve(uploadsRoot, objectPath);
        if (!localPath.startsWith(`${uploadsRoot}${path.sep}`) || !fs.existsSync(localPath)) {
            throw new Error('Uploaded media was not found');
        }
        return { path: localPath, cleanup: async () => {} };
    }

    const object = storageConfig.bucket.file(objectPath);
    const [exists] = await object.exists();
    if (!exists) throw new Error('Uploaded media was not found');
    const tempPath = path.join(os.tmpdir(), `vibed-effect-${process.pid}-${crypto.randomUUID()}${extension}`);
    await object.download({ destination: tempPath });
    return { path: tempPath, cleanup: async () => fs.promises.rm(tempPath, { force: true }) };
}

module.exports = { parseOwnedObject, resolveEffectMedia };
