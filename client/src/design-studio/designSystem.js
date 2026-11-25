/**
 * client/src/design-studio/designSystem.js
 *
 * Professional Design System Engine: Reusable Components,
 * Instances, Variants, Variables/Tokens (with Mode Themes),
 * and Property Copy/Paste Clipboard.
 *
 * Strictly zero emojis.
 */

import { LUCIDE_ICON_COMPONENTS } from './lucideIconLibrary.js';

// ── Theme Variables & Design Tokens ──────────────────────────────────────────

export const THEME_MODES = {
    dark: {
        id: 'dark',
        label: 'Dark Studio',
        colors: {
            brand: '#00E5FF',
            brandDark: '#0B7C91',
            accent: '#C85A17',
            surface: '#0D0F12',
            surfaceAlt: '#161920',
            surfaceCard: '#1E222B',
            text: '#EDEAE3',
            textMuted: '#9CA3AF',
            border: '#2A2E39',
        },
    },
    light: {
        id: 'light',
        label: 'Light Studio',
        colors: {
            brand: '#0B7C91',
            brandDark: '#044350',
            accent: '#C85A17',
            surface: '#EDEAE3',
            surfaceAlt: '#FFFFFF',
            surfaceCard: '#F7F5F0',
            text: '#111827',
            textMuted: '#6B7280',
            border: '#D8D4CC',
        },
    },
    editorial: {
        id: 'editorial',
        label: 'Editorial Warm',
        colors: {
            brand: '#C85A17',
            brandDark: '#8F3F0D',
            accent: '#00E5FF',
            surface: '#F4EDE2',
            surfaceAlt: '#EAE1D3',
            surfaceCard: '#DFD4C4',
            text: '#1F140E',
            textMuted: '#7A6B5F',
            border: '#D0C1B0',
        },
    },
};

export const TYPOGRAPHY_STYLES = {
    display: {
        id: 'display',
        name: 'Display Bold',
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: 800,
        fontSize: 72,
        lineHeight: 1.1,
        letterSpacing: -1.5,
    },
    headline: {
        id: 'headline',
        name: 'Headline',
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: 700,
        fontSize: 48,
        lineHeight: 1.2,
        letterSpacing: -0.5,
    },
    serifTitle: {
        id: 'serifTitle',
        name: 'Editorial Serif',
        fontFamily: 'Instrument Serif',
        fontWeight: 400,
        fontSize: 56,
        lineHeight: 1.15,
        letterSpacing: 0,
    },
    body: {
        id: 'body',
        name: 'Body Medium',
        fontFamily: 'Geist',
        fontWeight: 400,
        fontSize: 16,
        lineHeight: 1.5,
        letterSpacing: 0,
    },
    mono: {
        id: 'mono',
        name: 'Code Mono',
        fontFamily: 'JetBrains Mono',
        fontWeight: 500,
        fontSize: 14,
        lineHeight: 1.4,
        letterSpacing: 0,
    },
};

export const EFFECT_STYLES = {
    cardElevation: {
        id: 'cardElevation',
        name: 'Card Elevation',
        dropShadow: { x: 0, y: 8, blur: 24, spread: 0, color: 'rgba(0, 0, 0, 0.35)' },
    },
    cyanGlow: {
        id: 'cyanGlow',
        name: 'Cyan Glow',
        dropShadow: { x: 0, y: 0, blur: 20, spread: 2, color: 'rgba(0, 229, 255, 0.45)' },
    },
    glassmorphism: {
        id: 'glassmorphism',
        name: 'Glassmorphism',
        backdropBlur: 16,
        fill: 'rgba(255, 255, 255, 0.08)',
        stroke: 'rgba(255, 255, 255, 0.15)',
        strokeWidth: 1,
    },
    subtleInner: {
        id: 'subtleInner',
        name: 'Subtle Inset',
        innerShadow: { x: 0, y: 2, blur: 4, color: 'rgba(0, 0, 0, 0.25)' },
    },
};

// ── Built-in Starter Components ───────────────────────────────────────────────

export const STARTER_COMPONENTS = [
    {
        id: 'cmp_cta_button',
        name: 'Primary CTA Button',
        category: 'Buttons',
        w: 200,
        h: 48,
        layers: [
            {
                id: 'bg',
                name: 'Button Background',
                type: 'rect',
                x: 0,
                y: 0,
                w: 200,
                h: 48,
                fill: '#00E5FF',
                cornerRadius: 24,
                stroke: 'transparent',
                strokeWidth: 0,
            },
            {
                id: 'label',
                name: 'Button Label',
                type: 'text',
                x: 0,
                y: 14,
                w: 200,
                h: 20,
                text: 'GET STARTED',
                fontFamily: 'Plus Jakarta Sans',
                fontWeight: 700,
                fontSize: 14,
                fill: '#0D0F12',
                textAlign: 'center',
            },
        ],
    },
    {
        id: 'cmp_duration_badge',
        name: 'Duration Badge',
        category: 'Badges',
        w: 64,
        h: 28,
        layers: [
            {
                id: 'badge_bg',
                name: 'Pill Background',
                type: 'rect',
                x: 0,
                y: 0,
                w: 64,
                h: 28,
                fill: '#C85A17',
                cornerRadius: 6,
            },
            {
                id: 'badge_text',
                name: 'Time Text',
                type: 'text',
                x: 0,
                y: 6,
                w: 64,
                h: 16,
                text: '0:30',
                fontFamily: 'JetBrains Mono',
                fontWeight: 700,
                fontSize: 12,
                fill: '#FFFFFF',
                textAlign: 'center',
            },
        ],
    },
    {
        id: 'cmp_stat_callout',
        name: 'Stat Callout Card',
        category: 'Cards',
        w: 240,
        h: 110,
        layers: [
            {
                id: 'card_bg',
                name: 'Card Background',
                type: 'rect',
                x: 0,
                y: 0,
                w: 240,
                h: 110,
                fill: 'rgba(255, 255, 255, 0.05)',
                stroke: 'rgba(255, 255, 255, 0.12)',
                strokeWidth: 1,
                cornerRadius: 12,
            },
            {
                id: 'metric_value',
                name: 'Metric Number',
                type: 'text',
                x: 16,
                y: 16,
                w: 208,
                h: 40,
                text: '94° C',
                fontFamily: 'Plus Jakarta Sans',
                fontWeight: 800,
                fontSize: 32,
                fill: '#00E5FF',
            },
            {
                id: 'metric_label',
                name: 'Metric Description',
                type: 'text',
                x: 16,
                y: 62,
                w: 208,
                h: 24,
                text: 'Optimal water temperature',
                fontFamily: 'Geist',
                fontWeight: 400,
                fontSize: 13,
                fill: '#9CA3AF',
            },
        ],
    },
];

const libraryRect = (id, name, x, y, w, h, fill, options = {}) => ({
    id, name, type: 'rect', x, y, w, h, fill,
    stroke: options.stroke || 'transparent',
    strokeWidth: options.strokeWidth || 0,
    cornerRadius: options.cornerRadius ?? 8,
    opacity: 100,
    visible: true,
    locked: false,
});

const libraryText = (id, name, text, x, y, w, size, fill, options = {}) => ({
    id, name, type: 'text', x, y, w, h: options.h || Math.ceil(size * 1.45), text,
    fontFamily: options.fontFamily || 'Geist',
    fontWeight: options.fontWeight || 500,
    fontSize: size,
    fill,
    textAlign: options.textAlign || 'left',
    letterSpacing: options.letterSpacing || 0,
    opacity: 100,
    visible: true,
    locked: false,
});

const libraryEllipse = (id, name, x, y, w, h, fill, options = {}) => ({
    id, name, type: 'ellipse', x, y, w, h, fill,
    stroke: options.stroke || 'transparent',
    strokeWidth: options.strokeWidth || 0,
    opacity: 100,
    visible: true,
    locked: false,
});

const libraryImage = (id, name, src, x, y, w, h, options = {}) => ({
    id, name, type: 'image', src, x, y, w, h,
    imageFit: options.imageFit || 'cover',
    cornerRadius: options.cornerRadius || 0,
    opacity: 100,
    visible: true,
    locked: false,
});

const libraryComponent = (id, name, category, w, h, description, layers, tags = []) => ({
    id: `cmp_${id}`,
    name,
    category,
    description,
    tags,
    w,
    h,
    layers,
});

// Editable component recipes. Every child is a regular canvas layer, so users
// can restyle, replace text, resize, reorder, or remove pieces after insertion.
STARTER_COMPONENTS.push(
    libraryComponent('button_secondary', 'Secondary Button', 'Buttons', 190, 48, 'Quiet secondary action with a soft surface.', [
        libraryRect('surface', 'Button Surface', 0, 0, 190, 48, '#202630', { stroke: '#46515F', cornerRadius: 12 }),
        libraryText('label', 'Button Label', 'LEARN MORE', 0, 15, 190, 14, '#F7F9FC', { fontWeight: 700, textAlign: 'center', letterSpacing: 0.6 }),
    ], ['action', 'secondary', 'cta']),
    libraryComponent('button_outline', 'Outline Button', 'Buttons', 190, 48, 'High contrast outline action.', [
        libraryRect('surface', 'Button Outline', 0, 0, 190, 48, 'transparent', { stroke: '#00E5FF', strokeWidth: 2, cornerRadius: 12 }),
        libraryText('label', 'Button Label', 'SEE THE WORK', 0, 15, 190, 13, '#00E5FF', { fontWeight: 700, textAlign: 'center', letterSpacing: 0.8 }),
    ], ['action', 'outline', 'cta']),
    libraryComponent('button_pill', 'Pill Action', 'Buttons', 168, 42, 'Compact rounded action for social and creator layouts.', [
        libraryRect('surface', 'Pill Surface', 0, 0, 168, 42, '#8A2BE2', { cornerRadius: 21 }),
        libraryText('label', 'Button Label', 'FOLLOW ALONG', 0, 13, 168, 12, '#FFFFFF', { fontWeight: 700, textAlign: 'center', letterSpacing: 0.5 }),
    ], ['action', 'pill', 'social']),
    libraryComponent('badge_new', 'New Badge', 'Badges', 76, 28, 'Small accent marker for new content.', [
        libraryRect('surface', 'Badge Surface', 0, 0, 76, 28, '#00E5FF', { cornerRadius: 14 }),
        libraryText('label', 'Badge Label', 'NEW', 0, 7, 76, 11, '#071114', { fontWeight: 800, textAlign: 'center', letterSpacing: 1 }),
    ], ['label', 'status', 'pill']),
    libraryComponent('badge_live', 'Live Status Badge', 'Badges', 100, 30, 'Live indicator with an editable LED dot and label.', [
        libraryRect('surface', 'Badge Surface', 0, 0, 100, 30, '#27151B', { stroke: '#6A303D', cornerRadius: 15 }),
        libraryEllipse('led', 'Status LED', 11, 11, 8, 8, '#FF496C'),
        libraryText('label', 'Badge Label', 'LIVE', 26, 8, 64, 11, '#FFD8DF', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1 }),
    ], ['live', 'status', 'stream']),
    libraryComponent('badge_rating', 'Rating Badge', 'Badges', 92, 30, 'Compact rating or score capsule.', [
        libraryRect('surface', 'Badge Surface', 0, 0, 92, 30, '#24211A', { stroke: '#5A4A28', cornerRadius: 8 }),
        libraryText('score', 'Rating Value', '4.9 / 5', 8, 7, 76, 12, '#FFD46B', { fontWeight: 700, textAlign: 'center' }),
    ], ['rating', 'score', 'review']),
    libraryComponent('badge_step', 'Step Marker', 'Badges', 44, 44, 'Numbered marker for tutorials and multi-step stories.', [
        libraryEllipse('surface', 'Marker Surface', 0, 0, 44, 44, '#00E5FF'),
        libraryText('number', 'Step Number', '01', 0, 13, 44, 14, '#071114', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
    ], ['number', 'step', 'tutorial']),
    libraryComponent('card_feature', 'Feature Card', 'Cards', 260, 156, 'Feature card with eyebrow, title, and supporting copy.', [
        libraryRect('surface', 'Card Surface', 0, 0, 260, 156, '#151A22', { stroke: '#323C4A', cornerRadius: 14 }),
        libraryEllipse('icon', 'Icon Disc', 18, 18, 34, 34, '#17343A'),
        libraryText('iconMark', 'Icon Mark', '01', 18, 29, 34, 10, '#75EDFA', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
        libraryText('eyebrow', 'Eyebrow', 'MADE FOR CREATORS', 18, 66, 220, 9, '#7E8C9D', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1 }),
        libraryText('title', 'Feature Title', 'Find your next cut', 18, 84, 224, 18, '#F7F9FC', { fontWeight: 700 }),
        libraryText('body', 'Feature Description', 'Turn a rough idea into a clear story.', 18, 113, 224, 11, '#AAB4C2', { h: 18 }),
    ], ['feature', 'product', 'card']),
    libraryComponent('card_quote', 'Quote Card', 'Cards', 280, 142, 'Editorial quote card with attribution.', [
        libraryRect('surface', 'Card Surface', 0, 0, 280, 142, '#F2EEE7', { cornerRadius: 14 }),
        libraryText('quoteMark', 'Quote Mark', '“', 18, 4, 34, 42, '#8A2BE2', { fontFamily: 'Instrument Serif', h: 48 }),
        libraryText('quote', 'Quote', 'Make every second\nfeel intentional.', 20, 32, 240, 20, '#20232A', { fontFamily: 'Instrument Serif', fontWeight: 400, h: 52 }),
        libraryText('attribution', 'Attribution', '— THE CREATIVE NOTEBOOK', 20, 108, 242, 9, '#646C77', { fontFamily: 'JetBrains Mono', fontWeight: 600, letterSpacing: 0.5 }),
    ], ['quote', 'editorial', 'testimonial']),
    libraryComponent('card_pricing', 'Pricing Plan Card', 'Cards', 240, 238, 'Plan card with price, perks, and a CTA.', [
        libraryRect('surface', 'Card Surface', 0, 0, 240, 238, '#171B24', { stroke: '#3D4654', cornerRadius: 14 }),
        libraryText('plan', 'Plan Name', 'CREATOR', 18, 18, 204, 10, '#91A0B2', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1.3 }),
        libraryText('price', 'Price', '$19', 18, 43, 204, 34, '#F7F9FC', { fontWeight: 800 }),
        libraryText('period', 'Billing Period', '/ month', 95, 58, 120, 12, '#9BA7B6'),
        libraryText('description', 'Plan Description', 'Everything you need to publish.', 18, 91, 202, 11, '#B5BFCC', { h: 20 }),
        libraryText('perk1', 'Plan Perk One', '01  Unlimited projects', 18, 121, 204, 10, '#DAE1EA', { fontFamily: 'Geist', h: 15 }),
        libraryText('perk2', 'Plan Perk Two', '02  4K exports', 18, 145, 204, 10, '#DAE1EA', { fontFamily: 'Geist', h: 15 }),
        libraryRect('cta', 'Plan Button', 16, 182, 208, 38, '#00E5FF', { cornerRadius: 9 }),
        libraryText('ctaLabel', 'Plan Button Label', 'CHOOSE CREATOR', 16, 194, 208, 11, '#071114', { fontWeight: 800, textAlign: 'center', letterSpacing: 0.5 }),
    ], ['pricing', 'plans', 'subscription']),
    libraryComponent('card_profile', 'Profile Card', 'Cards', 236, 116, 'Compact creator or speaker profile.', [
        libraryRect('surface', 'Card Surface', 0, 0, 236, 116, '#171B24', { stroke: '#313A48', cornerRadius: 14 }),
        libraryEllipse('avatar', 'Avatar Disc', 16, 18, 52, 52, '#593A7A'),
        libraryText('initials', 'Avatar Initials', 'AV', 16, 34, 52, 15, '#FFFFFF', { fontWeight: 800, textAlign: 'center' }),
        libraryText('name', 'Profile Name', 'Alex Rivera', 80, 23, 138, 15, '#F7F9FC', { fontWeight: 700 }),
        libraryText('handle', 'Profile Handle', '@alexmakes', 80, 46, 138, 10, '#9DAABA'),
        libraryText('stats', 'Profile Stats', '24 CUTS  ·  12K FOLLOWERS', 16, 86, 204, 9, '#AEB9C6', { fontFamily: 'JetBrains Mono', h: 16 }),
    ], ['profile', 'creator', 'avatar']),
    libraryComponent('card_stat', 'Metric Card', 'Cards', 208, 120, 'Single KPI card with label and trend.', [
        libraryRect('surface', 'Card Surface', 0, 0, 208, 120, '#151A22', { stroke: '#313B49', cornerRadius: 12 }),
        libraryText('label', 'Metric Label', 'WATCH TIME', 16, 14, 176, 9, '#96A2B1', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1 }),
        libraryText('value', 'Metric Value', '18.4K', 16, 36, 176, 31, '#F7F9FC', { fontWeight: 800 }),
        libraryText('change', 'Metric Change', '+24% THIS WEEK', 16, 83, 176, 10, '#73E4BB', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
    ], ['metric', 'kpi', 'analytics']),
    libraryComponent('social_post', 'Social Post Header', 'Social', 340, 76, 'Avatar, creator name, handle, and post context.', [
        libraryEllipse('avatar', 'Avatar Disc', 0, 6, 48, 48, '#8A2BE2'),
        libraryText('initials', 'Avatar Initials', 'AR', 0, 20, 48, 14, '#FFFFFF', { fontWeight: 800, textAlign: 'center' }),
        libraryText('name', 'Display Name', 'Alex Rivera', 62, 7, 174, 14, '#F7F9FC', { fontWeight: 700 }),
        libraryText('verified', 'Verified Mark', 'V', 144, 6, 18, 13, '#00E5FF', { fontWeight: 800, textAlign: 'center' }),
        libraryText('handle', 'Handle and Time', '@alexmakes  ·  2h', 62, 29, 210, 10, '#9BA7B6'),
        libraryEllipse('more1', 'More Menu Dot One', 308, 22, 4, 4, '#B8C2CE'),
        libraryEllipse('more2', 'More Menu Dot Two', 318, 22, 4, 4, '#B8C2CE'),
        libraryEllipse('more3', 'More Menu Dot Three', 328, 22, 4, 4, '#B8C2CE'),
    ], ['social', 'post', 'creator']),
    libraryComponent('social_stats', 'Social Engagement Row', 'Social', 260, 34, 'Reusable likes, comments, and share stats.', [
        libraryText('likes', 'Like Count', 'LIKES  2.4K', 0, 5, 82, 9, '#F28A9B', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('comments', 'Comment Count', 'COMMENTS  184', 88, 5, 84, 9, '#CBD3DD', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('shares', 'Share Count', 'SHARES  32', 182, 5, 78, 9, '#CBD3DD', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
    ], ['social', 'engagement', 'stats']),
    libraryComponent('social_creator', 'Creator Follow Card', 'Social', 252, 188, 'Creator spotlight with follow CTA.', [
        libraryRect('surface', 'Card Surface', 0, 0, 252, 188, '#171B24', { stroke: '#394453', cornerRadius: 14 }),
        libraryEllipse('avatar', 'Avatar Disc', 92, 16, 68, 68, '#264958'),
        libraryText('initials', 'Avatar Initials', 'JM', 92, 39, 68, 18, '#F7F9FC', { fontWeight: 800, textAlign: 'center' }),
        libraryText('name', 'Creator Name', 'Jordan Miles', 20, 96, 212, 16, '#F7F9FC', { fontWeight: 700, textAlign: 'center' }),
        libraryText('handle', 'Creator Handle', '@jordanmakes', 20, 121, 212, 10, '#9DAABA', { textAlign: 'center' }),
        libraryRect('follow', 'Follow Button', 52, 147, 148, 30, '#00E5FF', { cornerRadius: 15 }),
        libraryText('followLabel', 'Follow Button Label', 'FOLLOW', 52, 156, 148, 10, '#071114', { fontWeight: 800, textAlign: 'center', letterSpacing: 0.7 }),
    ], ['social', 'creator', 'follow']),
    libraryComponent('header_section', 'Section Header', 'Headers', 380, 92, 'Eyebrow, headline, and short introduction.', [
        libraryText('eyebrow', 'Eyebrow', 'THE NEXT CHAPTER', 0, 0, 380, 10, '#00E5FF', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1.2 }),
        libraryText('title', 'Section Title', 'Make the story\nmove.', 0, 19, 380, 28, '#F7F9FC', { fontFamily: 'Plus Jakarta Sans', fontWeight: 800, h: 62 }),
        libraryText('subtitle', 'Section Description', 'Tools for the moments that matter.', 0, 75, 380, 11, '#AAB4C2', { h: 16 }),
    ], ['header', 'section', 'title']),
    libraryComponent('header_profile', 'Profile Header', 'Headers', 340, 82, 'Horizontal author heading with byline.', [
        libraryEllipse('avatar', 'Avatar Disc', 0, 10, 54, 54, '#8A2BE2'),
        libraryText('initials', 'Avatar Initials', 'MK', 0, 28, 54, 15, '#FFFFFF', { fontWeight: 800, textAlign: 'center' }),
        libraryText('name', 'Profile Name', 'Morgan Kim', 70, 16, 242, 16, '#F7F9FC', { fontWeight: 700 }),
        libraryText('byline', 'Profile Byline', 'Director  ·  Los Angeles', 70, 42, 242, 10, '#AAB4C2'),
    ], ['header', 'profile', 'author']),
    libraryComponent('header_video', 'Video Title Bar', 'Headers', 360, 64, 'Compact title and metadata row for video cards.', [
        libraryText('title', 'Video Title', 'A better first frame', 0, 4, 300, 17, '#F7F9FC', { fontWeight: 700 }),
        libraryText('metadata', 'Video Metadata', 'CREATOR NOTES  ·  04:28', 0, 33, 300, 9, '#9CAABA', { fontFamily: 'JetBrains Mono', fontWeight: 600, letterSpacing: 0.6 }),
        libraryEllipse('status', 'Status Dot', 330, 20, 10, 10, '#00E5FF'),
    ], ['video', 'header', 'metadata']),
    libraryComponent('callout_notice', 'Notification Toast', 'Callouts', 300, 72, 'Success notification with editable status marker.', [
        libraryRect('surface', 'Toast Surface', 0, 0, 300, 72, '#17231F', { stroke: '#355849', cornerRadius: 10 }),
        libraryEllipse('status', 'Status Dot', 16, 18, 10, 10, '#73E4BB'),
        libraryText('title', 'Notification Title', 'Export complete', 38, 12, 244, 13, '#F2FBF6', { fontWeight: 700 }),
        libraryText('body', 'Notification Message', 'Your 4K video is ready to download.', 38, 36, 246, 10, '#B4C8BD'),
    ], ['notification', 'success', 'toast']),
    libraryComponent('callout_tip', 'Tip Callout', 'Callouts', 320, 84, 'Helpful tip with a colored edge and heading.', [
        libraryRect('surface', 'Callout Surface', 0, 0, 320, 84, '#1B2029', { stroke: '#3B4654', cornerRadius: 10 }),
        libraryRect('edge', 'Accent Edge', 0, 0, 4, 84, '#00E5FF', { cornerRadius: 2 }),
        libraryText('label', 'Tip Label', 'EDITOR TIP', 18, 12, 270, 9, '#70EAF6', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1 }),
        libraryText('body', 'Tip Message', 'Cut on motion to make the transition\nfeel natural.', 18, 32, 284, 11, '#E0E6ED', { h: 34 }),
    ], ['tip', 'helper', 'callout']),
    libraryComponent('callout_alert', 'Alert Banner', 'Callouts', 340, 56, 'Warning or announcement strip.', [
        libraryRect('surface', 'Alert Surface', 0, 0, 340, 56, '#2A2418', { stroke: '#5B4C2B', cornerRadius: 9 }),
        libraryEllipse('status', 'Alert Dot', 15, 21, 10, 10, '#F5C45E'),
        libraryText('message', 'Alert Message', 'Check your safe area before export.', 36, 18, 288, 12, '#F5E9C8', { fontWeight: 500 }),
    ], ['alert', 'warning', 'banner']),
    libraryComponent('video_lowerthird', 'Video Lower Third', 'Video', 420, 88, 'Name and role overlay for interviews and explainers.', [
        libraryRect('surface', 'Lower Third Surface', 0, 0, 420, 88, '#10151D', { stroke: '#394452', cornerRadius: 8 }),
        libraryRect('accent', 'Accent Bar', 0, 0, 5, 88, '#00E5FF', { cornerRadius: 2 }),
        libraryText('name', 'Speaker Name', 'ALEX RIVERA', 22, 17, 374, 18, '#FFFFFF', { fontWeight: 800, letterSpacing: 0.4 }),
        libraryText('role', 'Speaker Role', 'CREATIVE DIRECTOR  ·  VIBED STUDIO', 22, 49, 374, 10, '#B5C0CD', { fontFamily: 'JetBrains Mono', fontWeight: 600, letterSpacing: 0.4 }),
    ], ['video', 'interview', 'title']),
    libraryComponent('video_subtitle', 'Subtitle Block', 'Video', 420, 76, 'Two-line subtitle treatment for a video frame.', [
        libraryRect('surface', 'Subtitle Backplate', 0, 0, 420, 76, 'rgba(4, 7, 11, 0.82)', { cornerRadius: 8 }),
        libraryText('line1', 'Subtitle Line One', 'The best stories start with a clear idea.', 18, 14, 384, 17, '#FFFFFF', { fontWeight: 700, textAlign: 'center' }),
        libraryText('line2', 'Subtitle Line Two', 'Then every cut earns its place.', 18, 41, 384, 16, '#FFFFFF', { fontWeight: 600, textAlign: 'center' }),
    ], ['video', 'captions', 'subtitles']),
    libraryComponent('video_chapter', 'Video Chapter Marker', 'Video', 196, 54, 'Chapter title and timecode for video timelines.', [
        libraryRect('surface', 'Chapter Surface', 0, 0, 196, 54, '#171D27', { stroke: '#364252', cornerRadius: 7 }),
        libraryText('time', 'Chapter Timecode', '00:42', 12, 8, 54, 10, '#6FE7F2', { fontFamily: 'JetBrains Mono', fontWeight: 700 }),
        libraryText('title', 'Chapter Title', 'The reveal', 70, 7, 114, 12, '#F3F6FA', { fontWeight: 600 }),
        libraryText('detail', 'Chapter Detail', 'SCENE 03', 70, 29, 114, 8, '#8C99A9', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
    ], ['video', 'chapter', 'timeline']),
    libraryComponent('video_play', 'Play Overlay', 'Video', 64, 64, 'Simple play control overlay for video covers.', [
        libraryEllipse('surface', 'Play Disc', 0, 0, 64, 64, 'rgba(5, 7, 11, 0.76)', { stroke: 'rgba(255,255,255,0.8)', strokeWidth: 2 }),
        { id: 'play', name: 'Play Triangle', type: 'polygon', x: 21, y: 17, w: 28, h: 30, sides: 3, fill: '#FFFFFF', opacity: 100, visible: true, locked: false },
    ], ['video', 'play', 'control']),
    libraryComponent('data_progress', 'Progress Card', 'Data', 260, 104, 'Progress bar with numeric completion.', [
        libraryRect('surface', 'Card Surface', 0, 0, 260, 104, '#171B24', { stroke: '#333D4B', cornerRadius: 12 }),
        libraryText('label', 'Progress Label', 'MONTHLY GOAL', 16, 14, 164, 9, '#9BA8B7', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.8 }),
        libraryText('value', 'Progress Value', '72%', 190, 11, 54, 16, '#72EAF5', { fontWeight: 800, textAlign: 'right' }),
        libraryRect('track', 'Progress Track', 16, 48, 228, 10, '#2B3340', { cornerRadius: 5 }),
        libraryRect('fill', 'Progress Fill', 16, 48, 164, 10, '#00E5FF', { cornerRadius: 5 }),
        libraryText('detail', 'Progress Detail', '18 OF 25 EXPORTS', 16, 72, 220, 9, '#ADB8C5', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
    ], ['data', 'progress', 'goal']),
    libraryComponent('data_bars', 'Bar Chart Card', 'Data', 280, 172, 'Five-bar comparison chart with labels and value.', [
        libraryRect('surface', 'Card Surface', 0, 0, 280, 172, '#171B24', { stroke: '#333D4B', cornerRadius: 12 }),
        libraryText('title', 'Chart Title', 'VIEWS BY WEEK', 16, 13, 248, 10, '#AAB5C3', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.8 }),
        libraryRect('bar1', 'Week One Bar', 28, 91, 28, 58, '#4A6270', { cornerRadius: 4 }),
        libraryRect('bar2', 'Week Two Bar', 76, 70, 28, 79, '#4A6270', { cornerRadius: 4 }),
        libraryRect('bar3', 'Week Three Bar', 124, 48, 28, 101, '#00E5FF', { cornerRadius: 4 }),
        libraryRect('bar4', 'Week Four Bar', 172, 63, 28, 86, '#4A6270', { cornerRadius: 4 }),
        libraryRect('bar5', 'Week Five Bar', 220, 35, 28, 114, '#8A2BE2', { cornerRadius: 4 }),
        libraryText('labels', 'Chart Labels', 'W1          W2          W3          W4          W5', 20, 152, 248, 8, '#8C98A7', { fontFamily: 'JetBrains Mono', textAlign: 'center' }),
    ], ['data', 'chart', 'analytics']),
    libraryComponent('data_donut', 'Donut KPI', 'Data', 168, 168, 'Circular KPI with editable ring, value, and caption.', [
        libraryEllipse('ringBase', 'Ring Base', 18, 18, 132, 132, 'transparent', { stroke: '#303845', strokeWidth: 12 }),
        libraryEllipse('ringProgress', 'Ring Progress', 18, 18, 132, 132, 'transparent', { stroke: '#00E5FF', strokeWidth: 12 }),
        libraryText('value', 'KPI Value', '84%', 36, 57, 96, 25, '#F7F9FC', { fontWeight: 800, textAlign: 'center' }),
        libraryText('label', 'KPI Label', 'RETENTION', 36, 91, 96, 9, '#AAB5C3', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center', letterSpacing: 0.5 }),
    ], ['data', 'kpi', 'chart']),
    libraryComponent('layout_feature_row', 'Feature Row', 'Layout', 400, 74, 'Icon-style marker with heading and supporting detail.', [
        libraryEllipse('marker', 'Feature Marker', 0, 9, 42, 42, '#1A3940'),
        libraryText('number', 'Feature Number', '02', 0, 22, 42, 11, '#78EAF4', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
        libraryText('title', 'Feature Title', 'Keep every edit intentional', 62, 7, 320, 14, '#F7F9FC', { fontWeight: 700 }),
        libraryText('body', 'Feature Description', 'A clear structure makes a strong story easier to finish.', 62, 32, 326, 11, '#AAB5C3', { h: 28 }),
    ], ['layout', 'feature', 'row']),
    libraryComponent('layout_checklist', 'Checklist Block', 'Layout', 256, 132, 'Three-step checklist for a process or tutorial.', [
        libraryRect('surface', 'Checklist Surface', 0, 0, 256, 132, '#171B24', { stroke: '#333D4B', cornerRadius: 12 }),
        libraryText('title', 'Checklist Title', 'BEFORE YOU EXPORT', 16, 12, 224, 10, '#AAB5C3', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.8 }),
        libraryText('item1', 'Checklist Item One', '01  Confirm the title safe area', 16, 39, 224, 11, '#E3E9F0', { h: 17 }),
        libraryText('item2', 'Checklist Item Two', '02  Check captions and timing', 16, 65, 224, 11, '#E3E9F0', { h: 17 }),
        libraryText('item3', 'Checklist Item Three', '03  Review the final frame', 16, 91, 224, 11, '#AAB5C3', { h: 17 }),
    ], ['layout', 'checklist', 'tutorial']),
    libraryComponent('layout_brandmark', 'Wordmark Lockup', 'Brand', 260, 62, 'Brand name and short descriptor lockup.', [
        libraryEllipse('mark', 'Brand Mark', 0, 6, 48, 48, '#00E5FF'),
        libraryText('markLetter', 'Mark Letter', 'V', 0, 12, 48, 28, '#071114', { fontFamily: 'Plus Jakarta Sans', fontWeight: 800, textAlign: 'center' }),
        libraryText('name', 'Brand Name', 'VIBED', 62, 9, 184, 20, '#F7F9FC', { fontWeight: 800, letterSpacing: 1.4 }),
        libraryText('descriptor', 'Brand Descriptor', 'STORY FIRST  ·  EDIT SMARTER', 64, 37, 190, 8, '#9CAABA', { fontFamily: 'JetBrains Mono', fontWeight: 600, letterSpacing: 0.35 }),
    ], ['brand', 'logo', 'wordmark']),
    libraryComponent('social_comment', 'Comment Bubble', 'Social', 292, 86, 'Comment card with avatar, name, and message.', [
        libraryRect('surface', 'Comment Surface', 42, 0, 250, 82, '#1A2029', { stroke: '#353F4D', cornerRadius: 11 }),
        libraryEllipse('avatar', 'Avatar Disc', 0, 8, 32, 32, '#6A507B'),
        libraryText('initials', 'Avatar Initials', 'SK', 0, 17, 32, 10, '#FFFFFF', { fontWeight: 700, textAlign: 'center' }),
        libraryText('name', 'Comment Author', 'Sam K.  ·  12 min', 56, 10, 220, 9, '#AEB9C7', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('message', 'Comment Text', 'This transition is so clean.', 56, 34, 220, 12, '#F1F4F8'),
    ], ['social', 'comment', 'community']),
    libraryComponent('video_watermark', 'Corner Watermark', 'Video', 142, 34, 'Small brand lockup for video and thumbnail corners.', [
        libraryEllipse('mark', 'Watermark Mark', 0, 0, 30, 30, '#00E5FF'),
        libraryText('letter', 'Watermark Letter', 'V', 0, 7, 30, 17, '#071114', { fontWeight: 800, textAlign: 'center' }),
        libraryText('name', 'Watermark Name', 'VIBED', 40, 8, 100, 12, '#FFFFFF', { fontWeight: 800, letterSpacing: 1.2 }),
    ], ['video', 'watermark', 'brand']),
    libraryComponent('callout_quote', 'Pull Quote', 'Callouts', 340, 124, 'Large editorial quote for a hero or poster.', [
        libraryRect('rule', 'Quote Rule', 0, 0, 3, 116, '#8A2BE2', { cornerRadius: 2 }),
        libraryText('quote', 'Quote Text', '“Make room for\nthe moment.”', 22, 8, 310, 26, '#F7F9FC', { fontFamily: 'Instrument Serif', fontWeight: 400, h: 62 }),
        libraryText('attribution', 'Quote Attribution', 'A NOTE FROM THE EDITOR', 22, 88, 300, 9, '#AAB5C3', { fontFamily: 'JetBrains Mono', fontWeight: 600, letterSpacing: 0.7 }),
    ], ['quote', 'editorial', 'poster']),
    libraryComponent('card_testimonial', 'Testimonial Card', 'Cards', 280, 164, 'Customer quote with name and role.', [
        libraryRect('surface', 'Card Surface', 0, 0, 280, 164, '#F3EFE8', { stroke: '#D7D0C5', cornerRadius: 12 }),
        libraryText('stars', 'Rating', 'RATING  5/5', 18, 15, 230, 9, '#A65A31', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.6 }),
        libraryText('quote', 'Testimonial Quote', '“We went from a blank timeline\nto a finished story in an hour.”', 18, 43, 244, 15, '#25272C', { fontWeight: 600, h: 42 }),
        libraryText('name', 'Customer Name', 'Taylor Reed', 18, 111, 230, 11, '#25272C', { fontWeight: 700 }),
        libraryText('role', 'Customer Role', 'INDEPENDENT CREATOR', 18, 134, 230, 8, '#6B7078', { fontFamily: 'JetBrains Mono', fontWeight: 600, letterSpacing: 0.4 }),
    ], ['testimonial', 'review', 'quote']),
    libraryComponent('social_video_cover', 'Video Cover Card', 'Social', 208, 252, 'Vertical social video cover with title and runtime.', [
        libraryRect('cover', 'Cover Background', 0, 0, 208, 252, '#202A36', { cornerRadius: 12 }),
        libraryEllipse('play', 'Play Button', 80, 84, 48, 48, 'rgba(5, 7, 11, 0.72)', { stroke: '#FFFFFF', strokeWidth: 1 }),
        { id: 'triangle', name: 'Play Triangle', type: 'polygon', x: 96, y: 96, w: 18, h: 22, sides: 3, fill: '#FFFFFF', opacity: 100, visible: true, locked: false },
        libraryText('eyebrow', 'Cover Eyebrow', 'FIELD NOTES  /  04', 14, 166, 178, 8, '#9BEAF0', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.45 }),
        libraryText('title', 'Cover Title', 'Build a better\nopening frame', 14, 185, 180, 18, '#FFFFFF', { fontWeight: 800, h: 46 }),
        libraryText('duration', 'Runtime', '00:42', 150, 16, 44, 9, '#FFFFFF', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'right' }),
    ], ['social', 'video', 'cover']),
    libraryComponent('data_quote_stat', 'Big Number Stat', 'Data', 196, 108, 'Oversized numeric highlight with descriptor.', [
        libraryText('value', 'Statistic Value', '3.2×', 0, 0, 196, 42, '#00E5FF', { fontWeight: 800 }),
        libraryText('label', 'Statistic Label', 'MORE WATCH TIME', 2, 61, 194, 9, '#AAB5C3', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.7 }),
        libraryText('detail', 'Statistic Detail', 'after tightening the first 5 seconds', 2, 82, 194, 9, '#7F8B9A', { h: 18 }),
    ], ['data', 'statistic', 'metric']),
    libraryComponent('layout_agenda', 'Agenda List', 'Layout', 280, 164, 'Three-row agenda with time and segment title.', [
        libraryText('heading', 'Agenda Heading', 'IN THIS EPISODE', 0, 0, 280, 9, '#00E5FF', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.8 }),
        libraryRect('rule1', 'Agenda Divider One', 0, 33, 280, 1, '#343D49', { cornerRadius: 0 }),
        libraryRect('rule2', 'Agenda Divider Two', 0, 77, 280, 1, '#343D49', { cornerRadius: 0 }),
        libraryRect('rule3', 'Agenda Divider Three', 0, 121, 280, 1, '#343D49', { cornerRadius: 0 }),
        libraryText('time1', 'Agenda Time One', '00:00', 0, 13, 50, 9, '#8E9BAB', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('title1', 'Agenda Title One', 'The problem with busy edits', 62, 10, 218, 11, '#F2F5F8', { fontWeight: 600 }),
        libraryText('time2', 'Agenda Time Two', '03:12', 0, 57, 50, 9, '#8E9BAB', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('title2', 'Agenda Title Two', 'Finding the real opening', 62, 54, 218, 11, '#F2F5F8', { fontWeight: 600 }),
        libraryText('time3', 'Agenda Time Three', '08:40', 0, 101, 50, 9, '#8E9BAB', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('title3', 'Agenda Title Three', 'A final pass for clarity', 62, 98, 218, 11, '#F2F5F8', { fontWeight: 600 }),
    ], ['layout', 'agenda', 'chapters']),
);

// Lucide icons are kept in the same searchable, editable native-layer catalog.
STARTER_COMPONENTS.push(...LUCIDE_ICON_COMPONENTS);

// Landing page patterns, rebuilt from the page's own visual language as
// editable canvas layers. Photographic layers point at the same local assets
// used by the landing page; every caption, badge, panel, and action is separate.
STARTER_COMPONENTS.push(
    libraryComponent('landing_hero_copy', 'Landing Hero Copy', 'Landing Page', 440, 282, 'Landing hero headline, supporting copy, paired actions, and reassurance line.', [
        libraryText('eyebrow', 'Eyebrow', 'THE CREATIVE EDITOR', 0, 0, 420, 10, '#9BA7B6', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1.2 }),
        libraryText('headline', 'Hero Headline', 'Upload your footage.\nGet a finished edit\nback in minutes.', 0, 24, 430, 35, '#F7F9FC', { fontWeight: 800, h: 120, letterSpacing: -0.7 }),
        libraryText('body', 'Supporting Copy', 'Pick a style, press enter, and VIBED cuts it, captions it and adds the music.', 0, 158, 420, 14, '#AEB9C6', { h: 48 }),
        libraryRect('primaryButton', 'Primary CTA Surface', 0, 218, 176, 42, '#00E5FF', { cornerRadius: 12 }),
        libraryText('primaryLabel', 'Primary CTA Label', 'Start editing free  →', 14, 231, 150, 12, '#05070B', { fontWeight: 700 }),
        libraryRect('secondaryButton', 'Secondary CTA Surface', 188, 218, 166, 42, '#171B24', { stroke: '#394453', cornerRadius: 12 }),
        libraryText('secondaryLabel', 'Secondary CTA Label', '▷  Watch how it works', 201, 231, 140, 12, '#E5EAF0', { fontWeight: 600 }),
        libraryText('microcopy', 'Trust Microcopy', 'Start free · No credit card needed', 0, 270, 320, 9, '#7E8A99', { fontFamily: 'JetBrains Mono', fontWeight: 500 }),
    ], ['landing', 'hero', 'headline', 'cta']),

    libraryComponent('landing_product_preview', 'Landing Product Preview', 'Landing Page', 360, 382, 'Landing hero result panel with a real still, editable status, output badge, and edit summary.', [
        libraryRect('panel', 'Preview Panel', 0, 0, 360, 382, '#0C1017', { stroke: '#303A48', cornerRadius: 18 }),
        libraryText('filename', 'Source Filename', 'podcast_ep12.mp4', 18, 17, 190, 10, '#D6DDE6', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('runtime', 'Source Runtime', '14:02', 230, 17, 48, 10, '#8793A3', { fontFamily: 'JetBrains Mono', textAlign: 'right' }),
        libraryRect('mode', 'Auto Mode Badge', 282, 12, 62, 23, '#1B232D', { stroke: '#3B4655', cornerRadius: 12 }),
        libraryText('modeLabel', 'Mode Label', 'AUTO', 291, 18, 46, 8, '#C5D0DC', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center', letterSpacing: 0.5 }),
        libraryRect('divider', 'Header Divider', 16, 46, 328, 1, '#28313D', { cornerRadius: 0 }),
        libraryRect('statusLed', 'Render Status LED', 18, 62, 8, 8, '#28C840', { cornerRadius: 4 }),
        libraryText('status', 'Render Status', 'Rendered in 11s', 34, 59, 190, 12, '#F0F4F8', { fontWeight: 700 }),
        libraryImage('still', 'Vertical Result Still', '/landing/shot-talk-cool.png', 18, 88, 104, 184, { imageFit: 'cover', cornerRadius: 10 }),
        libraryRect('ratio', 'Aspect Ratio Badge', 25, 96, 34, 18, '#F7F9FC', { cornerRadius: 4 }),
        libraryText('ratioLabel', 'Aspect Ratio Label', '9:16', 27, 100, 30, 8, '#10151D', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
        libraryText('caption', 'Preview Caption', 'This changes\neverything', 25, 231, 90, 12, '#FFFFFF', { fontWeight: 800, textAlign: 'center', h: 32 }),
        libraryText('result1', 'Result One', '✓  2:41 silence removed', 140, 105, 200, 10, '#DCE4ED', { fontWeight: 500 }),
        libraryText('result2', 'Result Two', '✓  118 filler words cut', 140, 137, 200, 10, '#DCE4ED', { fontWeight: 500 }),
        libraryText('result3', 'Result Three', '✓  Captions timed to words', 140, 169, 200, 10, '#DCE4ED', { fontWeight: 500 }),
        libraryText('result4', 'Result Four', '✓  Reframed for Reels', 140, 201, 200, 10, '#DCE4ED', { fontWeight: 500 }),
        libraryRect('footerRule', 'Output Divider', 18, 298, 324, 1, '#28313D', { cornerRadius: 0 }),
        libraryText('output', 'Exported File', 'reel_01.mp4  ·  1:05  ·  ready to post', 18, 318, 324, 10, '#9BA7B6', { fontFamily: 'JetBrains Mono', fontWeight: 500 }),
    ], ['landing', 'product', 'preview', 'video', 'results']),

    libraryComponent('landing_workflow_step', 'Landing Workflow Step', 'Landing Page', 320, 286, 'One step card from the landing page workflow, with a number, title, explanation, and contextual footer.', [
        libraryRect('surface', 'Step Card Surface', 0, 0, 320, 286, '#11161E', { stroke: '#303A48', cornerRadius: 16 }),
        libraryText('number', 'Step Number', '01', 24, 22, 90, 34, '#00E5FF', { fontWeight: 800, h: 48 }),
        libraryText('title', 'Step Title', 'Drop your footage', 24, 84, 272, 18, '#F7F9FC', { fontWeight: 800 }),
        libraryText('body', 'Step Description', 'Camera files, a screen recording, a podcast track. Start with a clip.', 24, 116, 272, 12, '#AAB4C2', { h: 54 }),
        libraryRect('dropZone', 'Drop Zone', 24, 202, 272, 54, '#0A0E14', { stroke: '#46515F', cornerRadius: 11 }),
        libraryEllipse('dropIcon', 'Drop Zone Icon Disc', 38, 217, 24, 24, '#17343A'),
        libraryText('dropArrow', 'Drop Zone Icon', '↓', 38, 219, 24, 17, '#75EDFA', { fontWeight: 700, textAlign: 'center' }),
        libraryText('dropLabel', 'Drop Zone Label', 'Drag a file here', 72, 222, 198, 12, '#DCE4ED', { fontWeight: 600 }),
    ], ['landing', 'workflow', 'steps', 'process']),

    libraryComponent('landing_speed_proof', 'Landing Before / After Timeline', 'Landing Page', 420, 286, 'The landing page speed comparison: raw and edited timelines, cut marker, and pass checklist.', [
        libraryRect('surface', 'Timeline Card Surface', 0, 0, 420, 286, '#11161E', { stroke: '#303A48', cornerRadius: 18 }),
        libraryText('rawLabel', 'Raw Upload Label', 'RAW UPLOAD', 22, 20, 220, 9, '#8E9BAB', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.8 }),
        libraryText('rawTime', 'Raw Duration', '14:02', 342, 20, 54, 9, '#8E9BAB', { fontFamily: 'JetBrains Mono', textAlign: 'right' }),
        libraryRect('rawTrack', 'Raw Timeline Track', 22, 45, 376, 28, '#222A34', { cornerRadius: 7 }),
        ...Array.from({ length: 18 }, (_, i) => libraryRect(`rawWave${i}`, `Raw Waveform Segment ${i + 1}`, 28 + i * 20, 52 + (i % 3) * 4, 12, 4, '#46515F', { cornerRadius: 2 })),
        libraryText('editLabel', 'Auto Edit Label', 'AUTO EDIT', 22, 91, 220, 9, '#DCE4ED', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 0.8 }),
        libraryText('editTime', 'Edited Duration', '8:41', 342, 91, 54, 9, '#DCE4ED', { fontFamily: 'JetBrains Mono', textAlign: 'right' }),
        libraryRect('editTrack', 'Edited Timeline Track', 22, 116, 376, 28, '#172A30', { cornerRadius: 7 }),
        ...Array.from({ length: 14 }, (_, i) => libraryRect(`editWave${i}`, `Edited Waveform Segment ${i + 1}`, 28 + i * 26, 123 + (i % 3) * 4, 17, 4, i % 4 === 0 ? '#8A2BE2' : '#00B8CC', { cornerRadius: 2 })),
        libraryRect('cutBadge', 'Time Saved Badge', 302, 151, 96, 22, '#19383E', { stroke: '#28616A', cornerRadius: 11 }),
        libraryText('cutLabel', 'Time Saved Label', '5:21 cut', 312, 157, 76, 9, '#8DEBF3', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
        libraryRect('divider', 'Checklist Divider', 22, 187, 376, 1, '#28313D', { cornerRadius: 0 }),
        libraryText('checklist', 'Edit Pass Checklist', '✓  Silences removed     ✓  Filler words out\n✓  Captions timed         ✓  Sequence built', 24, 204, 374, 10, '#DCE4ED', { h: 48 }),
    ], ['landing', 'speed', 'timeline', 'before-after', 'video']),

    libraryComponent('landing_repurpose_showcase', 'Landing Repurpose Showcase', 'Landing Page', 540, 300, 'The landing page format fan-out: one source clip becomes three captioned vertical outputs.', [
        libraryRect('surface', 'Showcase Surface', 0, 0, 540, 300, '#0C1017', { stroke: '#303A48', cornerRadius: 18 }),
        libraryImage('source', 'Source Video Still', '/landing/shot-podcast-duo.png', 18, 22, 192, 144, { imageFit: 'cover', cornerRadius: 12 }),
        libraryRect('sourceScrim', 'Source Caption Scrim', 18, 126, 192, 40, '#080B10', { cornerRadius: 0 }),
        libraryText('sourceName', 'Source Filename', 'podcast_ep12.mp4', 28, 136, 145, 9, '#F0F4F8', { fontFamily: 'JetBrains Mono', fontWeight: 600 }),
        libraryText('sourceTime', 'Source Duration', '14:02', 162, 136, 38, 9, '#AAB4C2', { fontFamily: 'JetBrains Mono', textAlign: 'right' }),
        libraryText('arrow', 'Conversion Arrow', '→', 222, 75, 42, 28, '#8793A3', { fontWeight: 700, textAlign: 'center' }),
        libraryImage('tiktok', 'TikTok Clip Still', '/landing/shot-talk-cool.png', 280, 28, 68, 124, { imageFit: 'cover', cornerRadius: 9 }),
        libraryImage('reels', 'Instagram Reel Still', '/landing/shot-vlog-outdoor.png', 363, 18, 72, 136, { imageFit: 'cover', cornerRadius: 9 }),
        libraryImage('shorts', 'YouTube Short Still', '/landing/shot-talk-violet.png', 450, 28, 68, 124, { imageFit: 'cover', cornerRadius: 9 }),
        libraryRect('tiktokTag', 'TikTok Platform Badge', 285, 34, 42, 15, '#080B10', { cornerRadius: 5 }),
        libraryText('tiktokLabel', 'TikTok Label', 'TIKTOK', 288, 37, 36, 7, '#F7F9FC', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
        libraryRect('reelsTag', 'Reels Platform Badge', 368, 24, 48, 15, '#080B10', { cornerRadius: 5 }),
        libraryText('reelsLabel', 'Reels Label', 'IG REELS', 371, 27, 42, 7, '#F7F9FC', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
        libraryRect('shortsTag', 'Shorts Platform Badge', 455, 34, 48, 15, '#080B10', { cornerRadius: 5 }),
        libraryText('shortsLabel', 'Shorts Label', 'YT SHORTS', 458, 37, 42, 7, '#F7F9FC', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center' }),
        libraryText('caption1', 'TikTok Caption', 'This is the part\nnobody tells you', 281, 110, 66, 9, '#FFFFFF', { fontWeight: 800, textAlign: 'center', h: 24 }),
        libraryText('caption2', 'Reels Caption', 'Three minutes,\none honest take', 366, 111, 66, 9, '#FFFFFF', { fontWeight: 800, textAlign: 'center', h: 24 }),
        libraryText('caption3', 'Shorts Caption', 'The setup that\nfinally worked', 451, 110, 66, 9, '#FFFFFF', { fontWeight: 800, textAlign: 'center', h: 24 }),
        libraryRect('divider', 'Showcase Divider', 18, 184, 504, 1, '#28313D', { cornerRadius: 0 }),
        libraryText('headline', 'Showcase Heading', 'One recording. Three platform-ready cuts.', 20, 205, 500, 17, '#F7F9FC', { fontWeight: 800 }),
        libraryText('detail', 'Showcase Description', 'Captions, framing, and pacing adapted for each feed.', 20, 240, 480, 11, '#AAB4C2'),
    ], ['landing', 'repurpose', 'shorts', 'social', 'video']),

    libraryComponent('landing_pricing_tier', 'Landing Pricing Tier', 'Landing Page', 280, 410, 'A landing-page plan card with price, clear action, and included features.', [
        libraryRect('surface', 'Pricing Card Surface', 0, 0, 280, 410, '#131821', { stroke: '#3B4655', cornerRadius: 16 }),
        libraryRect('popular', 'Popular Plan Badge', 18, 14, 112, 22, '#F7F9FC', { cornerRadius: 11 }),
        libraryText('popularLabel', 'Popular Badge Label', 'MOST POPULAR', 24, 20, 100, 8, '#10151D', { fontFamily: 'JetBrains Mono', fontWeight: 700, textAlign: 'center', letterSpacing: 0.5 }),
        libraryText('plan', 'Plan Name', 'CREATOR', 20, 54, 210, 10, '#9BA7B6', { fontFamily: 'JetBrains Mono', fontWeight: 700, letterSpacing: 1.2 }),
        libraryText('price', 'Plan Price', '€15', 20, 79, 120, 36, '#F7F9FC', { fontWeight: 800 }),
        libraryText('period', 'Billing Period', '/ month', 140, 98, 110, 12, '#9BA7B6'),
        libraryText('tagline', 'Plan Description', 'Export polished videos whenever you are ready.', 20, 129, 240, 11, '#B5BFCC', { h: 34 }),
        libraryRect('cta', 'Plan CTA Surface', 20, 177, 240, 40, '#00E5FF', { cornerRadius: 10 }),
        libraryText('ctaLabel', 'Plan CTA Label', 'Get Creator', 24, 190, 232, 12, '#05070B', { fontWeight: 800, textAlign: 'center' }),
        libraryText('feature1', 'Included Feature One', '✓  Unlimited projects', 22, 238, 236, 10, '#E4EAF1'),
        libraryText('feature2', 'Included Feature Two', '✓  Videos up to 90 minutes', 22, 268, 236, 10, '#E4EAF1'),
        libraryText('feature3', 'Included Feature Three', '✓  100 AI operations / month', 22, 298, 236, 10, '#E4EAF1'),
        libraryText('feature4', 'Included Feature Four', '✓  Shorts repurposing & stock', 22, 328, 236, 10, '#E4EAF1'),
        libraryText('footnote', 'Pricing Footnote', 'Cancel at any time.', 20, 377, 240, 9, '#8793A3', { fontFamily: 'JetBrains Mono' }),
    ], ['landing', 'pricing', 'plan', 'subscription']),

    libraryComponent('landing_trust_strip', 'Landing Trust Strip', 'Landing Page', 520, 78, 'A horizontal proof strip using the landing page reassurance pattern.', [
        libraryRect('surface', 'Trust Strip Surface', 0, 0, 520, 78, '#0B0F15', { stroke: '#28313D', cornerRadius: 12 }),
        libraryEllipse('icon1', 'Proof Icon One', 18, 24, 28, 28, '#18212B'),
        libraryText('check1', 'Proof Check One', '✓', 18, 30, 28, 13, '#8DEBF3', { fontWeight: 800, textAlign: 'center' }),
        libraryText('claim1', 'Proof Claim One', '100+ creators editing on VIBED', 56, 30, 190, 10, '#DCE4ED'),
        libraryEllipse('icon2', 'Proof Icon Two', 258, 24, 28, 28, '#18212B'),
        libraryText('check2', 'Proof Check Two', '✓', 258, 30, 28, 13, '#8DEBF3', { fontWeight: 800, textAlign: 'center' }),
        libraryText('claim2', 'Proof Claim Two', 'EU-hosted footage and transcripts', 296, 30, 204, 10, '#DCE4ED'),
        libraryEllipse('icon3', 'Proof Icon Three', 18, 48, 28, 28, '#18212B'),
        libraryText('check3', 'Proof Check Three', '✓', 18, 54, 28, 13, '#8DEBF3', { fontWeight: 800, textAlign: 'center' }),
        libraryText('claim3', 'Proof Claim Three', 'Free plan · No card needed', 56, 54, 190, 10, '#DCE4ED'),
        libraryEllipse('icon4', 'Proof Icon Four', 258, 48, 28, 28, '#18212B'),
        libraryText('check4', 'Proof Check Four', '✓', 258, 54, 28, 13, '#8DEBF3', { fontWeight: 800, textAlign: 'center' }),
        libraryText('claim4', 'Proof Claim Four', 'MP4 export with no watermark', 296, 54, 204, 10, '#DCE4ED'),
    ], ['landing', 'trust', 'proof', 'benefits']),

    libraryComponent('landing_mid_cta', 'Landing Mid-page CTA', 'Landing Page', 540, 230, 'The landing page centered conversion panel with headline, short reassurance, and CTA.', [
        libraryRect('surface', 'CTA Panel Surface', 0, 0, 540, 230, '#111821', { stroke: '#35414F', cornerRadius: 20 }),
        libraryEllipse('glow', 'Cyan Accent Glow', 406, -28, 160, 150, 'rgba(0,229,255,0.08)'),
        libraryText('headline', 'CTA Headline', 'Your next edit could\nalready be done.', 34, 28, 472, 28, '#F7F9FC', { fontWeight: 800, textAlign: 'center', h: 70 }),
        libraryText('body', 'CTA Supporting Copy', 'Start free. Three AI passes a month, no card, no watermark on your export.', 42, 110, 456, 12, '#AAB4C2', { textAlign: 'center', h: 36 }),
        libraryRect('button', 'CTA Button Surface', 180, 164, 180, 40, '#00E5FF', { cornerRadius: 11 }),
        libraryText('buttonLabel', 'CTA Button Label', 'Start editing free  →', 190, 177, 160, 12, '#05070B', { fontWeight: 800, textAlign: 'center' }),
        libraryText('microcopy', 'CTA Reassurance', 'START FREE · NO CREDIT CARD NEEDED', 144, 213, 252, 8, '#8793A3', { fontFamily: 'JetBrains Mono', textAlign: 'center', letterSpacing: 0.4 }),
    ], ['landing', 'cta', 'conversion', 'banner']),

    libraryComponent('landing_faq_row', 'Landing FAQ Row', 'Landing Page', 440, 74, 'A single FAQ accordion row styled after the landing page questions section.', [
        libraryRect('surface', 'FAQ Row Surface', 0, 0, 440, 74, '#10151D', { stroke: '#2C3541', cornerRadius: 10 }),
        libraryText('question', 'FAQ Question', 'Can I still change things by hand?', 20, 26, 354, 13, '#E9EEF4', { fontWeight: 600 }),
        libraryEllipse('toggle', 'FAQ Toggle Disc', 394, 21, 32, 32, '#1A222C'),
        libraryText('toggleMark', 'FAQ Toggle Mark', '+', 394, 25, 32, 18, '#AEB9C6', { fontWeight: 500, textAlign: 'center' }),
    ], ['landing', 'faq', 'accordion', 'question']),
);

// ── Property Copy / Paste Clipboard ──────────────────────────────────────────

let styleClipboard = null;

/**
 * Copies visual styling and typography properties from a layer.
 *
 * @param {object} layer
 * @returns {object} Extracted property bag
 */
export function copyLayerProperties(layer) {
    if (!layer) return null;

    styleClipboard = {
        fill: layer.fill,
        gradient: layer.gradient ? { ...layer.gradient } : null,
        opacity: layer.opacity !== undefined ? layer.opacity : 100,
        blendMode: layer.blendMode || 'normal',
        stroke: layer.stroke,
        strokeWidth: layer.strokeWidth,
        strokeCap: layer.strokeCap,
        strokeJoin: layer.strokeJoin,
        strokeStyle: layer.strokeStyle,
        cornerRadius: layer.cornerRadius,
        dropShadow: layer.dropShadow ? { ...layer.dropShadow } : null,
        innerShadow: layer.innerShadow ? { ...layer.innerShadow } : null,
        layerBlur: layer.layerBlur,
        backdropBlur: layer.backdropBlur,
        // Typography properties
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight,
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing,
        textAlign: layer.textAlign,
        textDecoration: layer.textDecoration,
        textTransform: layer.textTransform,
    };

    return styleClipboard;
}

/**
 * Pastes clipboard properties onto a target layer.
 *
 * @param {object} targetLayer
 * @param {object|null} properties
 * @returns {object} Updated layer
 */
export function pasteLayerProperties(targetLayer, properties = null) {
    const props = properties || styleClipboard;
    if (!targetLayer || !props) return targetLayer;

    const updated = { ...targetLayer };

    if (props.fill !== undefined) updated.fill = props.fill;
    if (props.gradient !== undefined) updated.gradient = props.gradient;
    if (props.opacity !== undefined) updated.opacity = props.opacity;
    if (props.blendMode !== undefined) updated.blendMode = props.blendMode;
    if (props.stroke !== undefined) updated.stroke = props.stroke;
    if (props.strokeWidth !== undefined) updated.strokeWidth = props.strokeWidth;
    if (props.strokeCap !== undefined) updated.strokeCap = props.strokeCap;
    if (props.strokeJoin !== undefined) updated.strokeJoin = props.strokeJoin;
    if (props.strokeStyle !== undefined) updated.strokeStyle = props.strokeStyle;
    if (props.cornerRadius !== undefined) updated.cornerRadius = props.cornerRadius;
    if (props.dropShadow !== undefined) updated.dropShadow = props.dropShadow;
    if (props.innerShadow !== undefined) updated.innerShadow = props.innerShadow;
    if (props.layerBlur !== undefined) updated.layerBlur = props.layerBlur;
    if (props.backdropBlur !== undefined) updated.backdropBlur = props.backdropBlur;

    // Apply text styling only if target is a text/badge layer
    if (targetLayer.type === 'text' || targetLayer.type === 'badge') {
        if (props.fontFamily) updated.fontFamily = props.fontFamily;
        if (props.fontSize) updated.fontSize = props.fontSize;
        if (props.fontWeight) updated.fontWeight = props.fontWeight;
        if (props.lineHeight) updated.lineHeight = props.lineHeight;
        if (props.letterSpacing !== undefined) updated.letterSpacing = props.letterSpacing;
        if (props.textAlign) updated.textAlign = props.textAlign;
        if (props.textDecoration) updated.textDecoration = props.textDecoration;
        if (props.textTransform) updated.textTransform = props.textTransform;
    }

    return updated;
}
