/**
 * client/src/components/StockCard.jsx
 *
 * Card component for displaying a Pexels stock video or photo in AssetPanel.
 * Complies with Pexels attribution guidelines:
 *   - Shows photographer name with link to photographer's profile
 *   - Shows link/credit to Pexels
 *   - Provides direct actions to add to timeline or media bin
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Plus, Check, ExternalLink, Film, Layers } from 'lucide-react';

function formatDuration(sec) {
    const s = Math.round(Number(sec) || 0);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
}

function formatResolution(res) {
    if (!res?.w || !res?.h) return null;
    if (res.w >= 3840 || res.h >= 2160) return '4K';
    if (res.h >= 1080 || res.w >= 1920) return '1080p';
    if (res.h >= 720 || res.w >= 1280) return '720p';
    return `${res.h}p`;
}

export default function StockCard({
    item,
    onAddToTimeline,
    onAddToBin,
    onAddAsOverlay,
    isAdded = false,
}) {
    const { t } = useTranslation('editor');
    const [isHovered, setIsHovered] = useState(false);

    const isVideo = item.type === 'video';
    const resBadge = formatResolution(item.resolution);
    const durBadge = isVideo && item.duration > 0 ? formatDuration(item.duration) : null;
    const authorName = item.attribution?.photographer || 'Pexels Creator';
    const authorUrl = item.attribution?.photographerUrl || item.attribution?.providerUrl;

    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                background: 'rgba(255,255,255,0.03)',
                border: isHovered ? '0.5px solid rgba(0,229,255,0.4)' : '0.5px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transition: 'border-color 0.15s ease, background 0.15s ease',
            }}
        >
            {/* Media thumbnail container */}
            <div
                style={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: '16/9',
                    background: '#090a0f',
                    overflow: 'hidden',
                }}
            >
                {item.thumbnail ? (
                    <img
                        src={item.thumbnail}
                        alt={item.name}
                        loading="lazy"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                            transform: isHovered ? 'scale(1.04)' : 'scale(1.0)',
                            transition: 'transform 0.25s ease',
                        }}
                    />
                ) : (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--fg-3)',
                        }}
                    >
                        <Film size={24} />
                    </div>
                )}

                {/* Duration & Resolution Badges */}
                <div
                    style={{
                        position: 'absolute',
                        bottom: 6,
                        right: 6,
                        display: 'flex',
                        gap: 4,
                        pointerEvents: 'none',
                    }}
                >
                    {resBadge && (
                        <span
                            style={{
                                background: 'rgba(0,0,0,0.75)',
                                color: 'rgba(255,255,255,0.9)',
                                fontSize: 9,
                                fontWeight: 600,
                                padding: '2px 5px',
                                borderRadius: 4,
                                fontFamily: 'var(--f-mono)',
                            }}
                        >
                            {resBadge}
                        </span>
                    )}
                    {durBadge && (
                        <span
                            style={{
                                background: 'rgba(0,0,0,0.75)',
                                color: 'rgba(255,255,255,0.9)',
                                fontSize: 9,
                                fontWeight: 600,
                                padding: '2px 5px',
                                borderRadius: 4,
                                fontFamily: 'var(--f-mono)',
                            }}
                        >
                            {durBadge}
                        </span>
                    )}
                </div>

                {/* Provider watermark badge */}
                <div
                    style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        background: 'rgba(5,160,129,0.85)',
                        color: '#fff',
                        fontSize: 8.5,
                        fontWeight: 700,
                        padding: '1.5px 5px',
                        borderRadius: 3,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        pointerEvents: 'none',
                    }}
                >
                    Pexels
                </div>
            </div>

            {/* Info and Attribution */}
            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <div
                    style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--fg-1)',
                        lineHeight: 1.3,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                    title={item.name}
                >
                    {item.name}
                </div>

                {/* Attribution link (Required by Pexels Terms) */}
                <div style={{ fontSize: 10, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span>By</span>
                    <a
                        href={authorUrl || 'https://www.pexels.com'}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            color: 'var(--accent)',
                            textDecoration: 'none',
                            maxWidth: '120px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {authorName}
                        <ExternalLink size={9} />
                    </a>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 4, marginTop: 'auto', paddingTop: 4 }}>
                    <button
                        type="button"
                        onClick={() => onAddToTimeline?.(item)}
                        style={{
                            flex: 1,
                            padding: '4px 6px',
                            background: 'var(--accent)',
                            color: '#000',
                            border: 'none',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 3,
                        }}
                        title={t('assetPanel.addToTimeline') || 'Add to timeline'}
                    >
                        <Plus size={11} strokeWidth={2.5} />
                        {t('assetPanel.timeline') || 'Timeline'}
                    </button>

                    <button
                        type="button"
                        onClick={() => onAddAsOverlay?.(item)}
                        style={{
                            padding: '4px 6px',
                            background: 'rgba(255,255,255,0.08)',
                            color: 'var(--fg-2)',
                            border: '0.5px solid rgba(255,255,255,0.12)',
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 500,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 3,
                        }}
                        title={t('assetPanel.addAsCutaway') || 'Add as cutaway / overlay'}
                    >
                        <Layers size={11} />
                        {t('assetPanel.cutaway') || 'Cutaway'}
                    </button>

                    <button
                        type="button"
                        onClick={() => onAddToBin?.(item)}
                        style={{
                            padding: '4px 6px',
                            background: isAdded ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.06)',
                            color: isAdded ? 'var(--accent)' : 'var(--fg-2)',
                            border: '0.5px solid rgba(255,255,255,0.1)',
                            borderRadius: 4,
                            fontSize: 10,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title={isAdded ? (t('assetPanel.inMediaBin') || 'In Media Bin') : (t('assetPanel.addToMediaBin') || 'Add to Media Bin')}
                    >
                        {isAdded ? <Check size={11} /> : <Plus size={11} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
