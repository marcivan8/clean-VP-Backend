/**
 * server/knowledge/vibedDesignStudioKnowledge.js
 *
 * VIBED Design Studio Tools & Autonomous Craft Knowledge Engine — Version 1.0.0
 *
 * Provides a comprehensive, versioned, zero-dependency craft and execution
 * registry for the Figma-class Design Studio across the platform.
 *
 * Powers the Editorial Brain (ROKA), intent parsing, generative layer direction,
 * and autonomous design pipelines across 7 core capability domains:
 *   1. Canvas & Layer Geometry: Coordinates, alignment, distribution, z-order, scaling.
 *   2. Typography & Hierarchy: Font pairing, scale ladders, letter spacing, contrast.
 *   3. Subject Cutout & Masking: Freeze frame extraction, alpha masking, depth placement.
 *   4. Art Direction Presets: The 94° rule, 1:16 ratio, Pour slower than you think, brand kit.
 *   5. Multi-Surface Adaptation: Reflowing compositions to 16:9, 1:1, 3:2, 2:3, 4:5, A4 print.
 *   6. Quality & Compliance Audits: 120px legibility, timestamp collision, WCAG contrast.
 *   7. Asset Export Pipeline: Multi-resolution rendering (1280x720, 640x360) and alpha PNGs.
 *
 * Pure, deterministic, dependency-free. Strictly zero emojis.
 */

'use strict';

const VIBED_DESIGN_STUDIO_KNOWLEDGE_VERSION = '1.0.0';

/**
 * ─── 1. DESIGN SKILL DOMAINS ────────────────────────────────────────────────
 */
const DESIGN_SKILL_DOMAINS = Object.freeze({
    CANVAS_GEOMETRY:     'canvas-geometry',
    TYPOGRAPHY_HIERARCHY:'typography-hierarchy',
    SUBJECT_CUTOUT:      'subject-cutout',
    ART_DIRECTION:       'art-direction',
    MULTI_SURFACE:       'multi-surface',
    QUALITY_AUDIT:       'quality-audit',
    EXPORT_PRODUCTION:   'export-production',
});

/**
 * ─── 2. COMPREHENSIVE TOOL REGISTRY & USAGE CONTRACTS ───────────────────────
 */
const DESIGN_TOOL_REGISTRY = Object.freeze({
    // ═════════════════════════════════════════════════════════════════════════
    // A. CANVAS & LAYER GEOMETRY
    // ═════════════════════════════════════════════════════════════════════════
    ds_transform_layer: {
        id: 'ds_transform_layer',
        label: 'Transform layer',
        domain: DESIGN_SKILL_DOMAINS.CANVAS_GEOMETRY,
        destructive: false,
        cost: 'local',
        purpose: 'Adjusts coordinates (X, Y), dimensions (W, H), scale, or opacity for target canvas layer.',
        usageWays: [
            { mode: 'nudge_relative', description: 'Shift layer relative to current position (e.g., nudge 30px left or down).' },
            { mode: 'reposition_absolute', description: 'Set exact pixel coordinates on the active viewport canvas.' },
            { mode: 'scale_dimensions', description: 'Resize layer bounding box while preserving safe area boundaries.' },
            { mode: 'adjust_opacity', description: 'Set layer transparency between 0% and 100% for layered depth.' },
        ],
        whenToUse: 'When adjusting visual balance, resolving element collisions, or framing subjects with breathing room.',
        whenNotToUse: 'Do not push text layers into the outer 48px boundary where platform UI covers them.',
        preconditions: ['Target layer exists on canvas.', 'Target layer is not locked.'],
        parameters: {
            layerId: { type: 'string', required: true, description: 'ID of target layer (e.g. headline, duration, subject, background).' },
            x: { type: 'number', required: false, description: 'X position in pixels.' },
            y: { type: 'number', required: false, description: 'Y position in pixels.' },
            w: { type: 'number', required: false, description: 'Width in pixels.' },
            h: { type: 'number', required: false, description: 'Height in pixels.' },
            dx: { type: 'number', required: false, description: 'Relative X delta in pixels.' },
            dy: { type: 'number', required: false, description: 'Relative Y delta in pixels.' },
            opacity: { type: 'number', required: false, description: 'Opacity from 0 to 100.' },
        },
    },

    ds_align_layer: {
        id: 'ds_align_layer',
        label: 'Align layer',
        domain: DESIGN_SKILL_DOMAINS.CANVAS_GEOMETRY,
        destructive: false,
        cost: 'local',
        purpose: 'Snaps a layer or selection to canvas alignment anchors or adjacent layer edges.',
        usageWays: [
            { mode: 'canvas_center', description: 'Center horizontally or vertically within active viewport.' },
            { mode: 'canvas_safe_left', description: 'Align flush with the 48px or 64px safe left margin.' },
            { mode: 'canvas_safe_top', description: 'Place flush below top safe area margin.' },
        ],
        whenToUse: 'When organizing headlines, duration badges, and sub-elements with geometric precision.',
        whenNotToUse: 'Do not center headlines if a large subject cutout occupies the center stage.',
        preconditions: ['Target layer exists on canvas.'],
        parameters: {
            layerId: { type: 'string', required: true, description: 'ID of target layer.' },
            alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'], required: true },
        },
    },

    ds_reorder_layer: {
        id: 'ds_reorder_layer',
        label: 'Reorder layer z-index',
        domain: DESIGN_SKILL_DOMAINS.CANVAS_GEOMETRY,
        destructive: false,
        cost: 'local',
        purpose: 'Moves a layer forward, backward, to top, or to bottom of the visual render stack.',
        usageWays: [
            { mode: 'bring_to_front', description: 'Pushes text or duration badge above all other elements.' },
            { mode: 'send_behind_subject', description: 'Places headline behind subject cutout for editorial depth.' },
        ],
        whenToUse: 'When creating depth-stacked compositions where text sits partially behind a masked subject.',
        whenNotToUse: 'Never push the background layer above interactive content layers.',
        preconditions: ['Target layer exists on canvas.'],
        parameters: {
            layerId: { type: 'string', required: true, description: 'ID of target layer.' },
            direction: { type: 'string', enum: ['forward', 'backward', 'front', 'back'], required: true },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // B. TYPOGRAPHY & HIERARCHY
    // ═════════════════════════════════════════════════════════════════════════
    ds_set_typography: {
        id: 'ds_set_typography',
        label: 'Set typography',
        domain: DESIGN_SKILL_DOMAINS.TYPOGRAPHY_HIERARCHY,
        destructive: false,
        cost: 'local',
        purpose: 'Configures text content, typeface, font size, fill color, line height, and text alignment.',
        usageWays: [
            { mode: 'scale_headline', description: 'Scale font size between 36px and 96px for thumbnail punch.' },
            { mode: 'typeface_pairing', description: 'Switch font family between Plus Jakarta Sans, Geist, Instrument Serif, or JetBrains Mono.' },
            { mode: 'color_swatch', description: 'Update text fill to high-contrast palette swatch or custom hex.' },
        ],
        whenToUse: 'When crafting headlines, setting readability scales, or matching brand typography.',
        whenNotToUse: 'Do not reduce headline font size below 48px on 1280x720 video thumbnails.',
        preconditions: ['Target text or badge layer exists.'],
        parameters: {
            layerId: { type: 'string', required: false, default: 'headline', description: 'Target text layer ID.' },
            text: { type: 'string', required: false, description: 'New text string.' },
            fontSize: { type: 'number', required: false, description: 'Font size in pixels.' },
            fontFamily: { type: 'string', required: false, enum: ['Plus Jakarta Sans', 'Geist', 'Instrument Serif', 'JetBrains Mono'] },
            fill: { type: 'string', required: false, description: 'Hex or CSS color string.' },
            textAlign: { type: 'string', required: false, enum: ['left', 'center', 'right'] },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // C. SUBJECT CUTOUT & MASKING
    // ═════════════════════════════════════════════════════════════════════════
    ds_anchor_subject_frame: {
        id: 'ds_anchor_subject_frame',
        label: 'Anchor subject frame',
        domain: DESIGN_SKILL_DOMAINS.SUBJECT_CUTOUT,
        destructive: false,
        cost: 'local',
        purpose: 'Selects a frozen video frame landmark (e.g. Frame 0:11) and updates subject cutout mask.',
        usageWays: [
            { mode: 'timestamp_freeze', description: 'Anchor to high-energy expression, product reveal, or action peak.' },
            { mode: 'mask_refinement', description: 'Toggle cutout mask boundary or reposition subject on the stage.' },
        ],
        whenToUse: 'When tying thumbnail visuals directly to an authentic high-impact moment in the footage.',
        whenNotToUse: 'Avoid selecting blurry motion frames or transition frames with half-occluded subjects.',
        preconditions: ['Project footage exists or sample frame is loaded.'],
        parameters: {
            frameLabel: { type: 'string', required: true, description: 'Frame label or timestamp (e.g. Frame 0:11).' },
            scale: { type: 'number', required: false, description: 'Scale multiplier for the cutout.' },
            position: { type: 'string', required: false, enum: ['left', 'right', 'center'] },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // D. ART DIRECTION PRESETS
    // ═════════════════════════════════════════════════════════════════════════
    ds_apply_direction: {
        id: 'ds_apply_direction',
        label: 'Apply art direction',
        domain: DESIGN_SKILL_DOMAINS.ART_DIRECTION,
        destructive: false,
        cost: 'local',
        purpose: 'Applies a complete unified editorial design system including palette, typography, and mood.',
        usageWays: [
            { mode: 'editorial_light', description: 'Direction B: The 94° rule. Clean warm light background (#F5EFEB) with editorial serif/sans and burnt terracotta accents (#C8622F).' },
            { mode: 'bold_split_number', description: 'Direction C: 1:16. High contrast split gradient (#C85A17 to #1F140E) with giant single-statistic typography.' },
            { mode: 'moody_off_kit', description: 'Direction D: Pour slower than you think. Deep midnight blues (#0B192C to #1E3E62) with electric cyan/ice accents.' },
        ],
        whenToUse: 'When auditioning overarching visual identities or aligning a design with campaign mood.',
        whenNotToUse: 'Do not override an explicit client brand kit unless requested to explore alternatives.',
        preconditions: ['Canvas initialized.'],
        parameters: {
            directionId: { type: 'string', required: true, enum: ['dir-b', 'dir-c', 'dir-d'] },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // E. MULTI-SURFACE ADAPTATION
    // ═════════════════════════════════════════════════════════════════════════
    ds_adapt_surface: {
        id: 'ds_adapt_surface',
        label: 'Adapt surface format',
        domain: DESIGN_SKILL_DOMAINS.MULTI_SURFACE,
        destructive: false,
        cost: 'local',
        purpose: 'Reflows canvas dimensions and layer positions to fit target destination surface and aspect ratio.',
        usageWays: [
            { mode: 'thumbnail_16x9', description: '1280x720 16:9 for YouTube and desktop video cards.' },
            { mode: 'social_1x1', description: '1080x1080 1:1 for Instagram feed and LinkedIn image posts.' },
            { mode: 'product_3x2', description: '1200x800 3:2 for web showcase and hero landing displays.' },
            { mode: 'packaging_2x3', description: '800x1200 2:3 vertical product card and packaging box.' },
            { mode: 'feed_4x5', description: '1080x1350 4:5 vertical feed advertisement.' },
            { mode: 'print_a4', description: '2480x3508 A4 300DPI print poster.' },
        ],
        whenToUse: 'When extending a single video launch brief across multichannel marketing surfaces.',
        whenNotToUse: 'Do not scale blindly without reflowing text bounding boxes; safe margins differ per surface.',
        preconditions: ['Design brief or active layers present.'],
        parameters: {
            formatId: { type: 'string', required: true, enum: ['thumbnail', 'social', 'product', 'packaging', 'ad', 'print'] },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // F. QUALITY & COMPLIANCE AUDITS
    // ═════════════════════════════════════════════════════════════════════════
    ds_run_quality_audit: {
        id: 'ds_run_quality_audit',
        label: 'Run design quality audit',
        domain: DESIGN_SKILL_DOMAINS.QUALITY_AUDIT,
        destructive: false,
        cost: 'local',
        purpose: 'Evaluates composition against professional visual standards: 120px readability, timestamp overlay collision, WCAG contrast, and safe areas.',
        usageWays: [
            { mode: 'thumbnail_legibility', description: 'Verifies headline remains readable at 120px mobile search result thumbnail width.' },
            { mode: 'timestamp_collision', description: 'Ensures bottom-right 180x48px safe zone is free of text to avoid YouTube duration badge collision.' },
            { mode: 'contrast_check', description: 'Measures luminance ratio between foreground text and background/subject (target ≥ 4.5:1).' },
            { mode: 'safe_margins', description: 'Confirms all critical visual elements reside within inner 5% margins.' },
        ],
        whenToUse: 'Before final export or when evaluating design pass quality.',
        whenNotToUse: 'Do not flag intentional subtle watermark elements as contrast failures.',
        preconditions: ['Layers loaded on canvas.'],
        parameters: {
            checkType: { type: 'string', required: false, enum: ['all', 'legibility', 'collision', 'contrast', 'safe_margins'], default: 'all' },
        },
    },

    // ═════════════════════════════════════════════════════════════════════════
    // G. ASSET EXPORT PIPELINE
    // ═════════════════════════════════════════════════════════════════════════
    ds_export_surface_assets: {
        id: 'ds_export_surface_assets',
        label: 'Export surface assets',
        domain: DESIGN_SKILL_DOMAINS.EXPORT_PRODUCTION,
        destructive: false,
        cost: 'local',
        purpose: 'Renders high-resolution pixel-perfect PNG images off-screen and triggers downloads for full and preview sizes.',
        usageWays: [
            { mode: 'export_dual_size', description: 'Generates full 1280x720 master PNG and 640x360 optimized thumbnail.' },
            { mode: 'export_alpha_matte', description: 'Exports isolated cutout layer with transparent alpha channel for video overlays.' },
        ],
        whenToUse: 'When the user approves the composition and requests final file delivery.',
        whenNotToUse: 'Do not export while quality checks have unresolved critical collisions.',
        preconditions: ['Canvas has at least one visible layer.'],
        parameters: {
            sizes: { type: 'array', required: false, default: [1.0, 0.5] },
            includeAlpha: { type: 'boolean', required: false, default: false },
        },
    },
});

/**
 * ─── 3. AUTONOMOUS DESIGN RECIPES & COMPOSITION PIPELINES ───────────────────
 */
const AUTONOMOUS_DESIGN_RECIPES = Object.freeze([
    {
        id: 'viral_thumbnail_pipeline',
        title: 'Viral Thumbnail Composition',
        description: 'Constructs a high-CTR YouTube thumbnail anchored on a freeze frame with clean typography and collision-free duration badge.',
        steps: [
            { tool: 'ds_anchor_subject_frame', params: { frameLabel: 'Frame 0:11', position: 'right' } },
            { tool: 'ds_apply_direction', params: { directionId: 'dir-b' } },
            { tool: 'ds_set_typography', params: { layerId: 'headline', fontSize: 72, fontFamily: 'Plus Jakarta Sans' } },
            { tool: 'ds_align_layer', params: { layerId: 'headline', alignment: 'left' } },
            { tool: 'ds_run_quality_audit', params: { checkType: 'all' } },
            { tool: 'ds_export_surface_assets', params: { sizes: [1.0, 0.5] } },
        ],
    },
    {
        id: 'cross_surface_reflow_pipeline',
        title: 'Cross-Surface Adaptation Pass',
        description: 'Reflows a master 16:9 thumbnail design to 1:1 social square and 4:5 feed ad while preserving typography hierarchy.',
        steps: [
            { tool: 'ds_adapt_surface', params: { formatId: 'social' } },
            { tool: 'ds_align_layer', params: { layerId: 'headline', alignment: 'center' } },
            { tool: 'ds_transform_layer', params: { layerId: 'subject', y: 320, scale: 0.9 } },
            { tool: 'ds_run_quality_audit', params: { checkType: 'contrast' } },
        ],
    },
    {
        id: 'collision_and_contrast_remediation',
        title: 'Quality & Timestamp Collision Remediation',
        description: 'Detects and rectifies timestamp overlap or low-contrast headline issues automatically.',
        steps: [
            { tool: 'ds_run_quality_audit', params: { checkType: 'all' } },
            { tool: 'ds_transform_layer', params: { layerId: 'duration', x: 48, y: 48 } },
            { tool: 'ds_set_typography', params: { layerId: 'headline', fill: '#F4EDE2', fontSize: 76 } },
        ],
    },
]);

/**
 * Classifies a user prompt into relevant design skill domains.
 *
 * @param {string} prompt
 * @returns {Array<{ domain: string, score: number }>}
 */
function classifyDesignSkills(prompt) {
    if (!prompt || typeof prompt !== 'string') return [];
    const s = prompt.toLowerCase();
    const hits = [];

    const patterns = [
        { domain: DESIGN_SKILL_DOMAINS.TYPOGRAPHY_HIERARCHY, regex: /(text|font|headline|typography|letter|size|serif|bold|italic|title|write)/i, weight: 1.0 },
        { domain: DESIGN_SKILL_DOMAINS.CANVAS_GEOMETRY, regex: /(move|shift|nudge|left|right|top|bottom|center|align|distribute|scale|resize|layer|position|opacity|z-index|front|back)/i, weight: 0.95 },
        { domain: DESIGN_SKILL_DOMAINS.SUBJECT_CUTOUT, regex: /(subject|cutout|mask|person|face|freeze|frame|anchor|cut out|isolate)/i, weight: 0.9 },
        { domain: DESIGN_SKILL_DOMAINS.ART_DIRECTION, regex: /(direction|style|94|ratio|1:16|pour slower|palette|brand|theme|mood|aesthetic)/i, weight: 0.9 },
        { domain: DESIGN_SKILL_DOMAINS.MULTI_SURFACE, regex: /(adapt|surface|format|instagram|feed|social|poster|print|packaging|product|aspect|square|feed|1:1|4:5|a4)/i, weight: 0.85 },
        { domain: DESIGN_SKILL_DOMAINS.QUALITY_AUDIT, regex: /(check|audit|quality|readability|legib|collision|safe area|contrast|wcag|margin)/i, weight: 0.8 },
        { domain: DESIGN_SKILL_DOMAINS.EXPORT_PRODUCTION, regex: /(export|download|png|render|bundle|alpha|transparent|save|hires)/i, weight: 0.75 },
    ];

    for (const p of patterns) {
        if (p.regex.test(s)) {
            hits.push({ domain: p.domain, score: p.weight });
        }
    }

    return hits.sort((a, b) => b.score - a.score);
}

/**
 * Returns the complete craft contract for a given design tool ID.
 *
 * @param {string} toolId
 * @returns {object|null}
 */
function getDesignToolContract(toolId) {
    return DESIGN_TOOL_REGISTRY[toolId] || null;
}

/**
 * Returns all design tools belonging to a skill domain.
 *
 * @param {string} domain
 * @returns {Array<object>}
 */
function getDesignToolsByDomain(domain) {
    return Object.values(DESIGN_TOOL_REGISTRY).filter(tool => tool.domain === domain);
}

/**
 * Synthesizes an intelligent craft guidance block for the AI regarding Design Studio mastery.
 *
 * @param {Array<string>} [availableToolIds]
 * @param {object} [context]
 * @param {object} [options]
 * @returns {string}
 */
function buildDesignStudioKnowledgePrompt(availableToolIds = [], context = {}, options = {}) {
    const readySet = availableToolIds.length ? new Set(availableToolIds) : null;
    const relevantTools = Object.values(DESIGN_TOOL_REGISTRY).filter(t => !readySet || readySet.has(t.id));

    const domainSections = [];
    const grouped = new Map();
    for (const tool of relevantTools) {
        if (!grouped.has(tool.domain)) grouped.set(tool.domain, []);
        grouped.get(tool.domain).push(tool);
    }

    const isCompact = options.compact === true || (context && context.isCompactPrompt === true);

    for (const [domain, tools] of grouped.entries()) {
        const toolSummaries = tools.map(t => {
            if (isCompact) {
                const modes = (t.usageWays || []).map(u => u.mode).join(', ');
                return `  ▸ ${t.id} ("${t.label}"): ${t.purpose} | Modes: ${modes}`;
            }
            const usageModes = (t.usageWays || []).map(u => `      • ${u.mode}: ${u.description}`).join('\n');
            return `  ▸ ${t.id} ("${t.label}"):
    Purpose: ${t.purpose}
    Optimal When: ${t.whenToUse}
    Anti-pattern / Avoid: ${t.whenNotToUse}
    Modes:
${usageModes}`;
        }).join(isCompact ? '\n' : '\n\n');

        domainSections.push(`[${domain.toUpperCase()}]\n${toolSummaries}`);
    }

    if (isCompact) {
        return `═══════════════════════════════════════════════
DESIGN STUDIO CRAFT & KNOWLEDGE REGISTRY
═══════════════════════════════════════════════
Core Figma-class visual design rules:
1. Mobile 120px Readability: Headlines must remain legible at 120px thumbnail width (fontSize ≥ 48px).
2. Platform Safe Zones: Never place text in bottom-right corner where video timestamps overlay.
3. Contrast Discipline: Keep minimum 4.5:1 luminance ratio between foreground text and canvas background.
4. Depth Stacking: Place masked subject cutouts to partially overlap or frame background typography.

CAPABILITIES:
${domainSections.join('\n\n')}

RECIPES:
• Viral Thumbnail: ds_anchor_subject_frame → ds_apply_direction (dir-b) → ds_set_typography → ds_run_quality_audit → ds_export_surface_assets.
• Multi-Surface: ds_adapt_surface → ds_align_layer → ds_transform_layer → ds_run_quality_audit.`;
    }

    return `═══════════════════════════════════════════════
DESIGN STUDIO CRAFT & KNOWLEDGE REGISTRY
═══════════════════════════════════════════════
You have complete architectural and creative mastery over the VIBED Design Studio.
Apply precise visual hierarchy, platform UI awareness, and multi-surface adaptations.

CORE VISUAL DESIGN PRINCIPLES:
1. Mobile 120px Readability: Thumbnails are evaluated at 120px width in mobile recommendations. Keep headline text short (3 to 6 words), uppercase or high-contrast title case, and font size 48px to 96px.
2. Platform UI Avoidance: YouTube, TikTok, and Instagram overlay critical timestamps, badges, and progress indicators in the bottom-right and bottom-center areas. Keep duration badges and key text in the top-left or upper-third safe zones.
3. Contrast & Luminance: Ensure ≥ 4.5:1 WCAG AA contrast ratio between typography fills and canvas backdrop. Use dark editorial backdrops for warm cream text or light parchment backdrops for crisp dark serifs.
4. Subject Layer Depth: Anchor subjects to authentic high-energy video frames (e.g. Frame 0:11). Use masked cutouts with depth stacking (placing typography partially behind or wrapping the subject) to create editorial authority.
5. Multi-Surface Adaptability: A single video creative brief adapts across 16:9 Thumbnail, 1:1 Social, 3:2 Product Showcase, 2:3 Packaging, 4:5 Feed Ad, and A4 Print. Re-center and adjust bounding boxes per surface ratio.

AVAILABLE DESIGN STUDIO TOOLS:
${domainSections.join('\n\n')}

STANDARD AUTONOMOUS DESIGN RECIPES:
• Viral Thumbnail Composition: ds_anchor_subject_frame → ds_apply_direction (The 94° rule) → ds_set_typography (72px Plus Jakarta Sans) → ds_run_quality_audit (timestamp & legibility) → ds_export_surface_assets.
• Multi-Surface Adaptation Pass: ds_adapt_surface (social 1:1) → ds_align_layer (center headline) → ds_transform_layer (re-center cutout) → ds_run_quality_audit.
• Quality & Contrast Remediation: ds_run_quality_audit → ds_transform_layer (move duration to top-left) → ds_set_typography (adjust fill for high contrast).`;
}

module.exports = {
    VIBED_DESIGN_STUDIO_KNOWLEDGE_VERSION,
    DESIGN_SKILL_DOMAINS,
    DESIGN_TOOL_REGISTRY,
    AUTONOMOUS_DESIGN_RECIPES,
    classifyDesignSkills,
    getDesignToolContract,
    getDesignToolsByDomain,
    buildDesignStudioKnowledgePrompt,
};
