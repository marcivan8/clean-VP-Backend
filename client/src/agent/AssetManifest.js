import { isReferenceAsset } from '../utils/assetRoles.js';

const ASSET_ROLES = new Set(['source', 'reference', 'stock', 'generated', 'audio', 'document']);

function analysisFor(asset = {}) {
    return asset.visualAnalysis || asset.analysis || {};
}

function inferRole(asset = {}) {
    if (isReferenceAsset(asset)) return 'reference';
    if (asset.provider || asset.isStock || asset.stockProvider) return 'stock';
    if (asset.generated === true || asset.isGenerated === true || asset.origin === 'generated') return 'generated';
    if (asset.type === 'audio') return 'audio';
    if (['document', 'pdf', 'text'].includes(String(asset.type || '').toLowerCase())) return 'document';
    return ASSET_ROLES.has(asset.role) ? asset.role : 'source';
}

function inferAnalysisStatus(asset = {}) {
    const status = String(asset.analysis_status || asset.analysisStatus || asset.visualAnalysis?.status || asset.analysis?.status || '').toLowerCase();
    if (['done', 'complete', 'completed', 'analyzed'].includes(status)) return 'complete';
    if (['running', 'processing', 'pending', 'queued'].includes(status)) return 'processing';
    if (['failed', 'error'].includes(status)) return 'failed';
    return asset.analysis || asset.visualAnalysis || asset.contentDescription ? 'complete' : 'not_started';
}

/** Canonical, compact inventory used by planning and execution. Includes every asset. */
export function buildAssetManifest(assets = []) {
    return (Array.isArray(assets) ? assets : []).filter(Boolean).map((asset, index) => {
        const analysis = analysisFor(asset);
        const description = analysis.contentDescription || analysis.content_description || asset.contentDescription || asset.suggestedLabel || null;
        const role = inferRole(asset);
        const confidenceValue = Number(analysis.confidence ?? asset.analysisConfidence ?? asset.confidence);
        return {
            id: String(asset.id || `unidentified-${index}`),
            name: String(asset.name || asset.file?.name || 'Untitled asset').slice(0, 120),
            type: String(asset.type || 'unknown').toLowerCase(),
            role,
            editable: role !== 'reference',
            analysisStatus: inferAnalysisStatus(asset),
            confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : null,
            description: description ? String(description).slice(0, 220) : null,
            duration: Number.isFinite(Number(asset.duration)) ? Number(asset.duration) : null,
            source: asset.provider ? String(asset.provider) : asset.generated || asset.isGenerated ? 'generated' : 'user',
        };
    });
}

export function manifestSummary(manifest) {
    const counts = {};
    for (const item of manifest || []) counts[item.role] = (counts[item.role] || 0) + 1;
    return { total: (manifest || []).length, byRole: counts, assets: manifest || [] };
}
