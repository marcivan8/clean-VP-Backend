/**
 * exportPresets.js — export choices shared by the desktop ExportModal and the
 * mobile export sheet (moved here unchanged from ExportModal).
 */
import { Youtube, Smartphone, Clapperboard, Tv2 } from 'lucide-react';

export const PLATFORMS = [
    { id: 'youtube', label: 'YouTube',      icon: Youtube,      ar: '16:9', fps: 30, res: '1920×1080' },
    { id: 'tiktok',  label: 'TikTok',       icon: Smartphone,   ar: '9:16', fps: 30, res: '1080×1920' },
    { id: 'reels',   label: 'IG Reels',     icon: Clapperboard, ar: '9:16', fps: 30, res: '1080×1920' },
    { id: 'shorts',  label: 'YT Shorts',    icon: Tv2,          ar: '9:16', fps: 60, res: '1080×1920' },
];

export const RESOLUTIONS = [
    { id: '720p',  label: '720p',  sub: 'HD' },
    { id: '1080p', label: '1080p', sub: 'FHD' },
    { id: '2k',    label: '2K',    sub: 'QHD' },
    { id: '4k',    label: '4K',    sub: 'UHD' },
];

export const QUALITY_PROFILES = [
    { id: 'high',   labelKey: 'exportModal.qualityPro',    bitrate: '8 Mbps',  subKey: 'exportModal.qualityMaxBitrate'  },
    { id: 'medium', labelKey: 'exportModal.qualitySocial', bitrate: '5 Mbps',  subKey: 'exportModal.qualityBalanced'     },
    { id: 'low',    labelKey: 'exportModal.qualityDraft',  bitrate: '2 Mbps',  subKey: 'exportModal.qualityFastRender'  },
];
