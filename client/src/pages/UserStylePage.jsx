/**
 * client/src/pages/UserStylePage.jsx
 *
 * "Your Style" — shows the user what the Editorial Brain has learned about them.
 *
 * Data source: GET /api/brain/profile
 *
 * Surfaces:
 *   - Pace preference (derived from avg_cut_rate)
 *   - Typical platform
 *   - Common workflow (top commands)
 *   - Preferred sounds
 *   - Favorite LUT (most-applied color grade)
 *   - Favorite preset
 *   - Skill level
 *   - Pattern flags (removes silences, adds captions, adds music)
 *
 * Controls:
 *   - "Reset my style data" → DELETE /api/brain/profile/reset
 *   - "Export my data"      → GET /api/brain/profile/export (download JSON)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../utils/authFetch.js';

// ── Design tokens ─────────────────────────────────────────────────────────────

const S = {
    page: {
        minHeight:  '100vh',
        background: 'var(--bg, #09090d)',
        color:      'var(--fg, #f0f0f5)',
        fontFamily: 'var(--f-sans, Geist, system-ui, sans-serif)',
        padding:    '48px 24px 80px',
        boxSizing:  'border-box',
    },
    inner: {
        maxWidth:  680,
        margin:    '0 auto',
    },
    accentBar: {
        height:     1,
        background: 'linear-gradient(90deg, var(--accent, #00e5ff), var(--violet, #8a2be2))',
        marginBottom: 32,
        borderRadius: 1,
    },
    heading: {
        fontSize:   24,
        fontWeight: 700,
        letterSpacing: '-0.03em',
        marginBottom: 4,
        color:      'var(--fg, #f0f0f5)',
    },
    subheading: {
        fontSize:   13,
        color:      'var(--fg-3, #666)',
        marginBottom: 36,
        lineHeight: 1.5,
    },
    card: {
        background:   'rgba(255,255,255,0.035)',
        border:       '0.5px solid rgba(255,255,255,0.09)',
        borderRadius: 10,
        padding:      '20px 22px',
        marginBottom: 14,
    },
    cardTitle: {
        fontSize:     10,
        fontWeight:   700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color:         'var(--fg-3, #666)',
        marginBottom:  14,
    },
    row: {
        display:       'flex',
        justifyContent: 'space-between',
        alignItems:    'center',
        paddingBottom: 10,
        borderBottom:  '0.5px solid rgba(255,255,255,0.06)',
        marginBottom:  10,
    },
    rowLast: {
        display:       'flex',
        justifyContent: 'space-between',
        alignItems:    'center',
    },
    rowLabel: {
        fontSize:  12,
        color:     'var(--fg-3, #888)',
        minWidth:  140,
    },
    rowValue: {
        fontSize:  13,
        fontWeight: 500,
        color:     'var(--fg, #f0f0f5)',
        textAlign: 'right',
    },
    badge: {
        display:      'inline-block',
        padding:      '2px 8px',
        borderRadius: 4,
        fontSize:     11,
        fontWeight:   600,
        background:   'color-mix(in oklch, var(--accent, #00e5ff) 14%, transparent)',
        border:       '0.5px solid color-mix(in oklch, var(--accent, #00e5ff) 28%, transparent)',
        color:        'var(--accent, #00e5ff)',
    },
    pill: {
        display:      'inline-flex',
        alignItems:   'center',
        gap:          5,
        padding:      '3px 10px',
        borderRadius: 20,
        fontSize:     11,
        fontWeight:   500,
        marginRight:  6,
        marginBottom: 4,
    },
    pillOn: {
        background: 'color-mix(in oklch, #00e5ff 12%, transparent)',
        border:     '0.5px solid color-mix(in oklch, #00e5ff 30%, transparent)',
        color:      '#00e5ff',
    },
    pillOff: {
        background: 'rgba(255,255,255,0.04)',
        border:     '0.5px solid rgba(255,255,255,0.08)',
        color:      'var(--fg-3, #666)',
    },
    emptyState: {
        padding:   '28px 0',
        textAlign: 'center',
        fontSize:  13,
        color:     'var(--fg-3, #666)',
        lineHeight: 1.7,
    },
    btnDanger: {
        padding:      '8px 16px',
        borderRadius: 7,
        border:       '0.5px solid rgba(255,60,60,0.35)',
        background:   'rgba(255,60,60,0.08)',
        color:        '#ff6b6b',
        fontSize:     12,
        fontWeight:   600,
        cursor:       'pointer',
        fontFamily:   'var(--f-sans)',
    },
    btnSecondary: {
        padding:      '8px 16px',
        borderRadius: 7,
        border:       '0.5px solid rgba(255,255,255,0.14)',
        background:   'rgba(255,255,255,0.05)',
        color:        'var(--fg, #f0f0f5)',
        fontSize:     12,
        fontWeight:   600,
        cursor:       'pointer',
        fontFamily:   'var(--f-sans)',
    },
    divider: {
        height:  '0.5px',
        background: 'rgba(255,255,255,0.06)',
        margin:  '28px 0',
    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function skillLabel(level) {
    const map = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
    return map[level] || level;
}

function platformLabel(p) {
    const map = {
        tiktok:           'TikTok',
        youtube_long:     'YouTube Long-form',
        youtube_shorts:   'YouTube Shorts',
        instagram_reels:  'Instagram Reels',
        linkedin:         'LinkedIn',
        podcast:          'Podcast',
    };
    return map[p] || p;
}

function workflowLabel(cmd) {
    // Prettify raw command strings
    return cmd
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function UserStylePage() {
    const [profile,   setProfile]   = useState(null);
    const [loading,   setLoading]   = useState(true);
    const [error,     setError]     = useState(null);
    const [resetting, setResetting] = useState(false);
    const [resetDone, setResetDone] = useState(false);
    const [exporting, setExporting] = useState(false);

    const loadProfile = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res  = await authFetch('/api/brain/profile');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load profile');
            setProfile(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadProfile(); }, [loadProfile]);

    const handleReset = useCallback(async () => {
        if (!window.confirm('This will permanently delete your learned style data. Your projects will not be affected. Continue?')) return;
        setResetting(true);
        try {
            const res = await authFetch('/api/brain/profile/reset', { method: 'DELETE' });
            if (!res.ok) throw new Error('Reset failed');
            setResetDone(true);
            setProfile(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setResetting(false);
        }
    }, []);

    const handleExport = useCallback(async () => {
        setExporting(true);
        try {
            const res  = await authFetch('/api/brain/profile/export');
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'vibed-style-data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (err) {
            setError(err.message);
        } finally {
            setExporting(false);
        }
    }, []);

    // ── Render states ─────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div style={S.page}>
                <div style={S.inner}>
                    <div style={S.accentBar} />
                    <div style={{ ...S.emptyState, paddingTop: 60 }}>Loading your style data…</div>
                </div>
            </div>
        );
    }

    if (resetDone) {
        return (
            <div style={S.page}>
                <div style={S.inner}>
                    <div style={S.accentBar} />
                    <h1 style={S.heading}>Your Style</h1>
                    <div style={S.emptyState}>
                        Your style data has been deleted.<br />
                        Vibed will start learning your preferences again from your next edit.
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={S.page}>
                <div style={S.inner}>
                    <div style={S.accentBar} />
                    <h1 style={S.heading}>Your Style</h1>
                    <div style={{ ...S.emptyState, color: '#ff8faa' }}>{error}</div>
                </div>
            </div>
        );
    }

    const hasData = profile?.dataAvailable;

    return (
        <div style={S.page}>
            <div style={S.inner}>
                {/* Top accent bar */}
                <div style={S.accentBar} />

                {/* Page heading */}
                <h1 style={S.heading}>Your Style</h1>
                <p style={S.subheading}>
                    Vibed learns your editing preferences over time and uses them to give
                    you better suggestions. Here's what it knows about you.
                </p>

                {!hasData ? (
                    <div style={{ ...S.card, ...S.emptyState }}>
                        No data yet — your style will appear here after a few editing sessions.
                    </div>
                ) : (
                    <>
                        {/* ── Editing style ───────────────────────────────── */}
                        <div style={S.card}>
                            <div style={S.cardTitle}>Editing Style</div>

                            <div style={S.row}>
                                <span style={S.rowLabel}>Pace preference</span>
                                <span style={S.rowValue}>{profile.pacePreference}</span>
                            </div>

                            <div style={S.row}>
                                <span style={S.rowLabel}>Typical platform</span>
                                <span style={S.rowValue}>{platformLabel(profile.typicalPlatform)}</span>
                            </div>

                            <div style={S.row}>
                                <span style={S.rowLabel}>Skill level</span>
                                <span style={{ ...S.rowValue }}>
                                    <span style={S.badge}>{skillLabel(profile.skillLevel)}</span>
                                </span>
                            </div>

                            <div style={S.rowLast}>
                                <span style={S.rowLabel}>Content type</span>
                                <span style={S.rowValue}>
                                    {profile.contentType?.replace(/_/g, ' ') || 'Unknown'}
                                </span>
                            </div>
                        </div>

                        {/* ── Common workflow ─────────────────────────────── */}
                        {profile.commonWorkflow?.length > 0 && (
                            <div style={S.card}>
                                <div style={S.cardTitle}>Common Workflow</div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {profile.commonWorkflow.map((cmd, i) => (
                                        <span key={i} style={{ ...S.pill, ...S.pillOn }}>
                                            {i + 1}. {workflowLabel(cmd)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Pattern flags ────────────────────────────────── */}
                        <div style={S.card}>
                            <div style={S.cardTitle}>Editing Patterns</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {[
                                    { label: 'Removes silences', on: profile.patterns?.removeSilences },
                                    { label: 'Adds captions',    on: profile.patterns?.addsCaptions },
                                    { label: 'Adds music',       on: profile.patterns?.addsMusic },
                                ].map(p => (
                                    <span
                                        key={p.label}
                                        style={{ ...S.pill, ...(p.on ? S.pillOn : S.pillOff) }}
                                    >
                                        {p.on ? '✓' : '—'} {p.label}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* ── Favorites ────────────────────────────────────── */}
                        {(profile.favoriteLUT || profile.favoritePreset || profile.preferredSounds?.length > 0) && (
                            <div style={S.card}>
                                <div style={S.cardTitle}>Favorites</div>

                                {profile.favoriteLUT && (
                                    <div style={S.row}>
                                        <span style={S.rowLabel}>Preferred LUT</span>
                                        <span style={S.rowValue}>
                                            {profile.favoriteLUT.name}{' '}
                                            <span style={{ color: 'var(--fg-3)', fontWeight: 400, fontSize: 11 }}>
                                                (used {profile.favoriteLUT.useCount}×)
                                            </span>
                                        </span>
                                    </div>
                                )}

                                {profile.favoritePreset && (
                                    <div style={profile.preferredSounds?.length ? S.row : S.rowLast}>
                                        <span style={S.rowLabel}>Favorite preset</span>
                                        <span style={S.rowValue}>
                                            {profile.favoritePreset.name}{' '}
                                            <span style={{ color: 'var(--fg-3)', fontWeight: 400, fontSize: 11 }}>
                                                (used {profile.favoritePreset.useCount}×)
                                            </span>
                                        </span>
                                    </div>
                                )}

                                {profile.preferredSounds?.length > 0 && (
                                    <div style={S.rowLast}>
                                        <span style={S.rowLabel}>Favorite sounds</span>
                                        <span style={S.rowValue}>
                                            {profile.preferredSounds.join(', ')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* ── Controls ──────────────────────────────────────────────── */}
                <div style={S.divider} />

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                        style={S.btnDanger}
                        onClick={handleReset}
                        disabled={resetting}
                    >
                        {resetting ? 'Deleting…' : 'Reset my style data'}
                    </button>
                    <button
                        style={S.btnSecondary}
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        {exporting ? 'Exporting…' : 'Export my data'}
                    </button>
                </div>

                <p style={{ marginTop: 12, fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                    Resetting deletes your learned preferences and suggestion history.
                    Your projects and uploaded assets are not affected.
                    Export gives you a copy of all stored data (GDPR Article 20).
                </p>
            </div>
        </div>
    );
}
