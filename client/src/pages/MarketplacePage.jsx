/**
 * client/src/pages/MarketplacePage.jsx
 *
 * Studio & Crew Marketplace — connects production studios, camera crews,
 * motion designers, colorists, and sound engineers with Vibed users.
 * Route: /marketplace
 *
 * Exclusively designed for Pro & Business workflows with direct cloud
 * project sharing, zero platform fees, and verified credentials.
 * Strictly Vibed Design System tokens — zero emojis.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Users, Film, Camera, Palette, Headphones, Video, Sparkles,
    ShieldCheck, Star, Clock, CheckCircle2, Search, ArrowRight,
    MapPin, ExternalLink, X, Send, Filter, Check, Lock, Menu,
} from 'lucide-react';
import { Logo } from '../components/Logo.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useUserPlan } from '../hooks/useUserPlan.js';
import { listProjects } from '../lib/projectsApi.js';

const CATEGORIES = [
    { id: 'all', label: 'All Specialists' },
    { id: 'studios', label: 'Production Studios', icon: Film },
    { id: 'crews', label: 'Camera Crews', icon: Camera },
    { id: 'motion', label: 'Motion Designers', icon: Sparkles },
    { id: 'color', label: 'Colorists & DIT', icon: Palette },
    { id: 'sound', label: 'Sound Engineers', icon: Headphones },
    { id: 'editors', label: 'Finishing Editors', icon: Video },
];

const SPECIALISTS = [
    {
        id: 'apex-cinema',
        name: 'Apex Cinema Lab',
        category: 'studios',
        categoryLabel: 'Production Studio',
        location: 'Paris & London',
        verified: true,
        rating: 4.98,
        reviewsCount: 42,
        turnaround: '24-48h',
        rate: 'From €120/hr',
        tagline: 'High-end commercial & narrative production studio with complete post-finishing pipeline.',
        tags: ['Commercials', 'Documentary', 'DaVinci Resolve', 'VFX Finishing'],
        compatibility: ['Vibed Cloud Sync', 'ProRes 4444', 'OTIO / XML', 'ACEScc'],
        turnaroundBadge: 'Fast Turnaround',
    },
    {
        id: 'kroma-motion',
        name: 'Kroma Motion Collective',
        category: 'motion',
        categoryLabel: 'Motion Designer',
        location: 'Berlin, DE (Remote)',
        verified: true,
        rating: 4.95,
        reviewsCount: 68,
        turnaround: '24h',
        rate: 'From €95/hr',
        tagline: 'Figma-to-video specialists crafting kinetic typography, 3D product renders, and high-retention hooks.',
        tags: ['Kinetic Typography', '3D Product Motion', 'After Effects', 'Lottie'],
        compatibility: ['Vibed Motion Engine', 'Alpha VP9', 'WebCodecs', 'Figma Sync'],
        turnaroundBadge: 'Same-Day Preview',
    },
    {
        id: 'vanguard-camera',
        name: 'Vanguard Camera Unit',
        category: 'crews',
        categoryLabel: 'Camera Crew',
        location: 'New York & Los Angeles',
        verified: true,
        rating: 5.0,
        reviewsCount: 29,
        turnaround: 'Same-Day Rushes',
        rate: 'From €180/hr',
        tagline: 'Dual-operator cinema package. Multi-angle interview rigs, ARRI & RED cinema cameras with live cloud proxy offload.',
        tags: ['RED V-Raptor', 'Sony FX9', 'Multicam Interview', 'Sound Package'],
        compatibility: ['Direct Proxy Sync', 'Timecode Jam', '24-bit Audio', 'RAW Rushes'],
        turnaroundBadge: 'Direct Field Ingest',
    },
    {
        id: 'noir-grade',
        name: 'Noir Grade Studio',
        category: 'color',
        categoryLabel: 'Colorist & DIT',
        location: 'London, UK (Remote)',
        verified: true,
        rating: 4.99,
        reviewsCount: 38,
        turnaround: '24h',
        rate: 'From €140/hr',
        tagline: 'Feature film and luxury fashion colorist. Custom 35mm photochemical film print emulations and HDR mastering.',
        tags: ['35mm Film Print', 'ACEScc', 'Fashion & Luxury', 'HDR10'],
        compatibility: ['DRP Export', 'Cube 3D LUT', 'ProRes 4444 XQ', 'Rec.709'],
        turnaroundBadge: 'Master Grade',
    },
    {
        id: 'aura-soundworks',
        name: 'Aura Soundworks',
        category: 'sound',
        categoryLabel: 'Sound Designer',
        location: 'Montreal, CA (Remote)',
        verified: true,
        rating: 4.97,
        reviewsCount: 53,
        turnaround: '12-24h',
        rate: 'From €85/hr',
        tagline: 'Dialogue restoration, spatial audio, sub-bass impacts, and cinematic foley tuned to story rhythm.',
        tags: ['Dialogue Cleanup', 'Foley Recording', 'Dolby Atmos', 'Stem Mastering'],
        compatibility: ['5.1 Stems', '48kHz 24-bit WAV', 'Loudness Target -14 LUFS'],
        turnaroundBadge: 'Rapid Delivery',
    },
    {
        id: 'velox-finish',
        name: 'Velox Finish House',
        category: 'editors',
        categoryLabel: 'Finishing Editor',
        location: 'Amsterdam, NL (Remote)',
        verified: true,
        rating: 4.94,
        reviewsCount: 81,
        turnaround: '6-12h',
        rate: 'From €75/hr',
        tagline: 'High-velocity social finishing. Pacing optimization, dynamic captioning, and multi-aspect ratio reframes.',
        tags: ['Viral Pacing', 'Hook Optimization', '9:16 Reframes', 'Subtitles'],
        compatibility: ['Vibed Timeline Sync', 'XML Conforming', 'TikTok / Reels Safe'],
        turnaroundBadge: 'Express Turnaround',
    },
];

export default function MarketplacePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useTranslation('common');
    const { plan, loading: planLoading } = useUserPlan();

    const [user, setUser] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSpecialist, setSelectedSpecialist] = useState(null);
    const [projects, setProjects] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [bookingService, setBookingService] = useState('Full Finishing');
    const [bookingNotes, setBookingNotes] = useState('');
    const [bookingSubmitted, setBookingSubmitted] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [showPostBriefModal, setShowPostBriefModal] = useState(false);
    const [briefTitle, setBriefTitle] = useState('');
    const [briefBudget, setBriefBudget] = useState('');
    const [briefDetails, setBriefDetails] = useState('');
    const [briefSubmitted, setBriefSubmitted] = useState(false);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user) {
                navigate('/auth');
                return;
            }
            setUser(user);
        });

        listProjects().then(data => {
            if (Array.isArray(data)) {
                setProjects(data);
                if (data.length > 0) setSelectedProjectId(data[0].id);
            }
        }).catch(err => console.warn('[MarketplacePage] project load error:', err.message));
    }, [navigate]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/');
    };

    const filteredSpecialists = SPECIALISTS.filter(spec => {
        const matchesCategory = selectedCategory === 'all' || spec.category === selectedCategory;
        const matchesSearch = !searchQuery.trim() || (
            spec.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            spec.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
            spec.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())) ||
            spec.location.toLowerCase().includes(searchQuery.toLowerCase())
        );
        return matchesCategory && matchesSearch;
    });

    const isPro = plan === 'pro';

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--bg)',
            color: 'var(--fg)',
            fontFamily: 'var(--f-sans)',
            position: 'relative',
            overflowX: 'hidden',
        }}>
            {/* Ambient Aurora Glow */}
            <div className="aurora" aria-hidden="true" style={{ opacity: 0.6 }} />

            {/* ── Fixed Floating Liquid Glass Top Navigation Bar ── */}
            <nav style={{
                position: 'fixed', top: 16, left: 0, right: 0, zIndex: 100,
                display: 'flex', justifyContent: 'center', pointerEvents: 'none',
            }}>
                <div className={`nav-pill${mobileMenuOpen ? ' nav-pill-open' : ''}`} style={{
                    pointerEvents: 'auto',
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '8px 18px',
                    borderRadius: 999,
                    maxWidth: 'calc(100vw - 24px)',
                    background: 'var(--glass-2)',
                    border: '0.5px solid var(--glass-stroke)',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                    boxShadow: '0 12px 36px -6px rgba(0,0,0,0.6)',
                    transition: 'all 0.3s ease',
                }}>
                    {/* Logo & Brand */}
                    <div
                        onClick={() => navigate('/dashboard')}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}
                    >
                        <Logo size={22} variant="gradient" />
                        <span style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            Vibed
                        </span>
                    </div>

                    {/* Desktop Navigation Links */}
                    <div className="nav-only-desktop font-medium" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                            onClick={() => navigate('/dashboard')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--fg-3)',
                                fontSize: 13,
                                padding: '6px 12px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                        >
                            Projects
                        </button>

                        <button
                            onClick={() => navigate('/marketplace')}
                            style={{
                                background: 'var(--glass)',
                                border: '0.5px solid var(--glass-stroke)',
                                color: 'var(--accent)',
                                fontSize: 13,
                                fontWeight: 600,
                                padding: '6px 14px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} />
                            Marketplace
                        </button>

                        <button
                            onClick={() => navigate('/design')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--fg-3)',
                                fontSize: 13,
                                padding: '6px 12px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                        >
                            Design
                        </button>

                        <button
                            onClick={() => navigate('/style')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--fg-3)',
                                fontSize: 13,
                                padding: '6px 12px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                        >
                            Style
                        </button>
                    </div>

                    {/* Pro Status Badge & Quota Stats (Strictly NO EMOJIS) */}
                    <div className="nav-only-desktop" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        {isPro ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '4px 12px', borderRadius: 999,
                                background: 'rgba(0, 229, 255, 0.08)',
                                border: '0.5px solid rgba(0, 229, 255, 0.4)',
                                boxShadow: '0 0 14px rgba(0, 229, 255, 0.18)',
                            }}>
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700,
                                    letterSpacing: '0.12em', color: 'var(--accent)', textTransform: 'uppercase',
                                }}>PRO</span>
                                <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--accent)', opacity: 0.6 }} />
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.04em',
                                    color: 'var(--fg-2)', whiteSpace: 'nowrap',
                                }}>
                                    Unlimited AI · 4h Max Footage · Unlimited Projects
                                </span>
                            </div>
                        ) : (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '4px 10px', borderRadius: 999,
                                background: 'var(--glass)',
                                border: '0.5px solid var(--glass-stroke)',
                                fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase',
                            }}>
                                <span>{plan}</span>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                        <button
                            onClick={() => setShowPostBriefModal(true)}
                            className="btn btn-ghost"
                            style={{ height: 34, padding: '0 12px', fontSize: 12.5 }}
                        >
                            Post Brief
                        </button>

                        <button
                            onClick={() => navigate('/account')}
                            className="btn btn-ghost nav-only-desktop"
                            style={{ height: 34, padding: '0 12px', fontSize: 12.5 }}
                        >
                            Billing
                        </button>

                        {/* Avatar */}
                        <button
                            onClick={handleSignOut}
                            title="Sign out"
                            style={{
                                width: 28, height: 28, borderRadius: '50%',
                                background: 'var(--accent-soft)',
                                border: '0.5px solid var(--glass-stroke)',
                                cursor: 'pointer',
                                color: 'var(--fg-2)',
                                fontFamily: 'var(--f-mono)', fontSize: 11,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                textTransform: 'uppercase',
                            }}
                        >
                            {(user?.email?.[0] ?? 'U').toUpperCase()}
                        </button>

                        {/* Mobile Hamburger Toggle */}
                        <button
                            className="nav-only-mobile"
                            onClick={() => setMobileMenuOpen(o => !o)}
                            aria-label="Toggle menu"
                            style={{
                                background: 'none', border: 'none', color: 'var(--fg-2)',
                                cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
                            }}
                        >
                            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
                        </button>
                    </div>
                </div>
            </nav>

            {/* Mobile Expanded Menu */}
            {mobileMenuOpen && (
                <div style={{
                    position: 'fixed', top: 76, left: 16, right: 16, zIndex: 99,
                    background: 'var(--bg-2)', border: '0.5px solid var(--glass-stroke)',
                    borderRadius: 'var(--r-lg)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10,
                    boxShadow: '0 20px 48px rgba(0,0,0,0.8)',
                }}>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/dashboard'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14 }}>Projects</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/marketplace'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'var(--glass)', border: 'none', color: 'var(--accent)', fontSize: 14, fontWeight: 600, borderRadius: 8 }}>Marketplace</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/design'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14 }}>Design</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/style'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14 }}>Style</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/account'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14 }}>Billing</button>
                </div>
            )}

            {/* ── Main Content Area ── */}
            <main style={{ maxWidth: 1280, margin: '0 auto', padding: '110px 24px 80px', position: 'relative', zIndex: 2 }}>

                {/* Hero Header */}
                <div style={{ marginBottom: 36, textAlign: 'left' }}>
                    <div className="eyebrow" style={{ marginBottom: 12 }}>
                        STUDIO & CREW MARKETPLACE · PRO & BUSINESS NETWORK
                    </div>
                    <h1 className="h-section" style={{ margin: '0 0 12px', fontSize: 'clamp(32px, 4.2vw, 56px)' }}>
                        Connect with verified <em>studios and crews</em>.
                    </h1>
                    <p className="body-lg" style={{ maxWidth: 720, margin: 0 }}>
                        Directly book elite cinematography crews, post-production studios, motion designers, and color suites.
                        Instant project handoff via Vibed Cloud with zero platform commission.
                    </p>
                </div>

                {/* Pro Privilege Banner */}
                <div style={{
                    marginBottom: 36,
                    padding: '16px 22px',
                    borderRadius: 'var(--r-md)',
                    background: 'linear-gradient(90deg, rgba(0, 229, 255, 0.08), rgba(138, 43, 226, 0.08))',
                    border: '0.5px solid rgba(0, 229, 255, 0.25)',
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 34, height: 34, borderRadius: '50%',
                            background: 'rgba(0, 229, 255, 0.15)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--accent)', flexShrink: 0,
                        }}>
                            <ShieldCheck size={18} />
                        </div>
                        <div>
                            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 600 }}>
                                PRO & BUSINESS MEMBER ADVANTAGE
                            </div>
                            <div style={{ fontSize: 13.5, color: 'var(--fg-2)', marginTop: 2 }}>
                                0% platform transaction fee · 1-click cloud timeline handoff (XML / DRP / OTIO) · 24h guaranteed studio quote
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => setShowPostBriefModal(true)}
                        className="btn btn-primary"
                        style={{ height: 36, padding: '0 16px', fontSize: 13, flexShrink: 0 }}
                    >
                        Post Production Brief
                    </button>
                </div>

                {/* Category & Search Filter Bar */}
                <div style={{
                    display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32,
                }}>
                    {/* Category tabs */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto',
                        paddingBottom: 4, scrollbarWidth: 'none',
                    }}>
                        {CATEGORIES.map(cat => {
                            const active = selectedCategory === cat.id;
                            const CatIcon = cat.icon;
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setSelectedCategory(cat.id)}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 8,
                                        padding: '8px 16px', borderRadius: 999,
                                        fontSize: 13, fontWeight: active ? 600 : 400,
                                        background: active ? 'var(--fg)' : 'var(--glass)',
                                        color: active ? 'var(--bg)' : 'var(--fg-2)',
                                        border: `0.5px solid ${active ? 'var(--fg)' : 'var(--glass-stroke)'}`,
                                        cursor: 'pointer', whiteSpace: 'nowrap',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    {CatIcon && <CatIcon size={14} />}
                                    {cat.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Search Bar */}
                    <div style={{ position: 'relative', width: '100%', maxWidth: 440 }}>
                        <span style={{
                            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                            color: 'var(--fg-4)', fontSize: 14, pointerEvents: 'none',
                        }}>
                            <Search size={15} />
                        </span>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search studios by specialty, camera gear, location, or style…"
                            style={{
                                width: '100%', boxSizing: 'border-box',
                                background: 'var(--bg-2)',
                                border: '0.5px solid var(--glass-stroke)',
                                borderRadius: 999,
                                padding: '10px 16px 10px 38px',
                                color: 'var(--fg)',
                                fontFamily: 'var(--f-sans)',
                                fontSize: 13.5,
                                outline: 'none',
                                transition: 'border-color 0.15s',
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.currentTarget.style.borderColor = 'var(--glass-stroke)'}
                        />
                    </div>
                </div>

                {/* Specialists Grid */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: 22,
                }}>
                    {filteredSpecialists.map(specialist => (
                        <div
                            key={specialist.id}
                            className="card card-pad"
                            style={{
                                display: 'flex', flexDirection: 'column', gap: 16,
                                transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                                position: 'relative',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.transform = 'translateY(-3px)';
                                e.currentTarget.style.boxShadow = '0 24px 60px -16px rgba(0,0,0,0.8), 0 0 20px rgba(0,229,255,0.06)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.transform = '';
                                e.currentTarget.style.boxShadow = '';
                            }}
                        >
                            {/* Card Header */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--fg)' }}>
                                            {specialist.name}
                                        </h3>
                                        {specialist.verified && (
                                            <span title="Verified Studio / Crew Partner" style={{ color: 'var(--accent)', display: 'inline-flex' }}>
                                                <CheckCircle2 size={16} />
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--fg-3)' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <MapPin size={12} />
                                            {specialist.location}
                                        </span>
                                        <span>·</span>
                                        <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{specialist.categoryLabel}</span>
                                    </div>
                                </div>

                                <div style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600,
                                    color: 'var(--accent)', background: 'rgba(0,229,255,0.08)',
                                    padding: '4px 8px', borderRadius: 'var(--r-xs)',
                                    border: '0.5px solid rgba(0,229,255,0.2)',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {specialist.rate}
                                </div>
                            </div>

                            {/* Tagline */}
                            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--fg-2)' }}>
                                {specialist.tagline}
                            </p>

                            {/* Capability Tags */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {specialist.tags.map(tag => (
                                    <span
                                        key={tag}
                                        style={{
                                            fontFamily: 'var(--f-mono)', fontSize: 10.5,
                                            padding: '3px 8px', borderRadius: 4,
                                            background: 'var(--bg-3)', color: 'var(--fg-3)',
                                            border: '0.5px solid var(--line)',
                                        }}
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </div>

                            {/* Specs / Deliverables */}
                            <div style={{
                                padding: '10px 12px', borderRadius: 'var(--r-sm)',
                                background: 'rgba(255,255,255,0.02)',
                                border: '0.5px solid var(--line-soft)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                fontSize: 12, color: 'var(--fg-3)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Star size={13} style={{ color: 'var(--coral)' }} />
                                    <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{specialist.rating}</span>
                                    <span>({specialist.reviewsCount})</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <Clock size={13} />
                                    <span>{specialist.turnaround}</span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ marginTop: 'auto', display: 'flex', gap: 10 }}>
                                <button
                                    onClick={() => setSelectedSpecialist(specialist)}
                                    className="btn btn-primary"
                                    style={{ flex: 1, height: 38, fontSize: 13, justifyContent: 'center' }}
                                >
                                    Book Studio
                                </button>
                                <button
                                    onClick={() => setSelectedSpecialist(specialist)}
                                    className="btn btn-ghost"
                                    style={{ height: 38, padding: '0 14px', fontSize: 13 }}
                                >
                                    Scope
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </main>

            {/* ── Direct Booking Modal ── */}
            {selectedSpecialist && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 200,
                    background: 'rgba(0,0,0,0.75)',
                    backdropFilter: 'blur(10px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 16,
                }}>
                    <div className="card" style={{
                        width: '100%', maxWidth: 540,
                        background: 'var(--bg-2)',
                        border: '0.5px solid var(--glass-stroke)',
                        padding: 28, borderRadius: 'var(--r-lg)',
                        display: 'flex', flexDirection: 'column', gap: 20,
                        position: 'relative',
                    }}>
                        <button
                            onClick={() => { setSelectedSpecialist(null); setBookingSubmitted(false); }}
                            style={{
                                position: 'absolute', top: 16, right: 16,
                                background: 'none', border: 'none', color: 'var(--fg-3)',
                                cursor: 'pointer', padding: 4,
                            }}
                        >
                            <X size={18} />
                        </button>

                        {bookingSubmitted ? (
                            <div style={{ textAlign: 'center', padding: '24px 0' }}>
                                <div style={{
                                    width: 48, height: 48, borderRadius: '50%',
                                    background: 'rgba(0, 229, 255, 0.15)',
                                    color: 'var(--accent)', margin: '0 auto 16px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Check size={24} />
                                </div>
                                <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
                                    Booking Request Sent
                                </h3>
                                <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.5 }}>
                                    {selectedSpecialist.name} has received your Vibed project snapshot and brief.
                                    Guaranteed response within 24 hours directly to {user?.email}.
                                </p>
                                <button
                                    onClick={() => { setSelectedSpecialist(null); setBookingSubmitted(false); }}
                                    className="btn btn-primary"
                                    style={{ height: 40, padding: '0 24px', fontSize: 13.5 }}
                                >
                                    Back to Marketplace
                                </button>
                            </div>
                        ) : (
                            <>
                                <div>
                                    <div className="eyebrow" style={{ marginBottom: 6 }}>
                                        DIRECT PRODUCTION HANDOFF
                                    </div>
                                    <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 600, color: 'var(--fg)' }}>
                                        Book {selectedSpecialist.name}
                                    </h2>
                                    <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-3)' }}>
                                        {selectedSpecialist.location} · {selectedSpecialist.rate} · {selectedSpecialist.turnaround}
                                    </p>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    {/* Select Project to handoff */}
                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>
                                            Select Vibed Project to Share
                                        </label>
                                        <select
                                            value={selectedProjectId}
                                            onChange={e => setSelectedProjectId(e.target.value)}
                                            style={{
                                                width: '100%', height: 40,
                                                background: 'var(--bg-3)',
                                                border: '0.5px solid var(--glass-stroke)',
                                                borderRadius: 'var(--r-sm)',
                                                color: 'var(--fg)', padding: '0 12px',
                                                fontFamily: 'var(--f-sans)', fontSize: 13,
                                                outline: 'none',
                                            }}
                                        >
                                            {projects.length > 0 ? (
                                                projects.map(p => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.name} ({p.aspect_ratio || '16:9'})
                                                    </option>
                                                ))
                                            ) : (
                                                <option value="">No saved projects (New Project Handoff)</option>
                                            )}
                                        </select>
                                    </div>

                                    {/* Service scope */}
                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>
                                            Service Required
                                        </label>
                                        <select
                                            value={bookingService}
                                            onChange={e => setBookingService(e.target.value)}
                                            style={{
                                                width: '100%', height: 40,
                                                background: 'var(--bg-3)',
                                                border: '0.5px solid var(--glass-stroke)',
                                                borderRadius: 'var(--r-sm)',
                                                color: 'var(--fg)', padding: '0 12px',
                                                fontFamily: 'var(--f-sans)', fontSize: 13,
                                                outline: 'none',
                                            }}
                                        >
                                            <option value="Full Finishing">Full Finishing (Assembly + Grade + Motion + Mix)</option>
                                            <option value="Color Grading">Color Grading & Film Print Emulation</option>
                                            <option value="Motion Graphics">Figma & After Effects Motion Graphics</option>
                                            <option value="Camera Crew">On-Location Camera Crew & Direct Rushes Ingest</option>
                                            <option value="Sound Mix">Sound Design & Stem Mastering</option>
                                        </select>
                                    </div>

                                    {/* Brief instructions */}
                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>
                                            Creative Direction & Deliverable Notes
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={bookingNotes}
                                            onChange={e => setBookingNotes(e.target.value)}
                                            placeholder="Specify desired deliverables, target platform, pacing tone, references, and delivery date…"
                                            style={{
                                                width: '100%', boxSizing: 'border-box',
                                                background: 'var(--bg-3)',
                                                border: '0.5px solid var(--glass-stroke)',
                                                borderRadius: 'var(--r-sm)',
                                                color: 'var(--fg)', padding: '10px 12px',
                                                fontFamily: 'var(--f-sans)', fontSize: 13,
                                                outline: 'none', resize: 'vertical',
                                            }}
                                        />
                                    </div>
                                </div>

                                <div style={{
                                    padding: '10px 14px', borderRadius: 'var(--r-sm)',
                                    background: 'rgba(0, 229, 255, 0.05)',
                                    border: '0.5px solid rgba(0, 229, 255, 0.2)',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    fontSize: 12, color: 'var(--fg-2)',
                                }}>
                                    <ShieldCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                    <span>Pro Plan: 0% platform transaction fee applied. You pay the studio's exact rate.</span>
                                </div>

                                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                                    <button
                                        onClick={() => setSelectedSpecialist(null)}
                                        className="btn btn-ghost"
                                        style={{ flex: 1, height: 40, justifyContent: 'center' }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => setBookingSubmitted(true)}
                                        className="btn btn-primary"
                                        style={{ flex: 1, height: 40, justifyContent: 'center' }}
                                    >
                                        Send Handoff & Book
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── Post Production Brief Modal ── */}
            {showPostBriefModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 200,
                    background: 'rgba(0,0,0,0.75)',
                    backdropFilter: 'blur(10px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 16,
                }}>
                    <div className="card" style={{
                        width: '100%', maxWidth: 520,
                        background: 'var(--bg-2)',
                        border: '0.5px solid var(--glass-stroke)',
                        padding: 28, borderRadius: 'var(--r-lg)',
                        display: 'flex', flexDirection: 'column', gap: 20,
                        position: 'relative',
                    }}>
                        <button
                            onClick={() => { setShowPostBriefModal(false); setBriefSubmitted(false); }}
                            style={{
                                position: 'absolute', top: 16, right: 16,
                                background: 'none', border: 'none', color: 'var(--fg-3)',
                                cursor: 'pointer', padding: 4,
                            }}
                        >
                            <X size={18} />
                        </button>

                        {briefSubmitted ? (
                            <div style={{ textAlign: 'center', padding: '24px 0' }}>
                                <div style={{
                                    width: 48, height: 48, borderRadius: '50%',
                                    background: 'rgba(0, 229, 255, 0.15)',
                                    color: 'var(--accent)', margin: '0 auto 16px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Check size={24} />
                                </div>
                                <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
                                    Production Brief Broadcasted
                                </h3>
                                <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.5 }}>
                                    Your brief has been sent to verified studios and camera crews matching your specifications.
                                    Responses will arrive directly in your notifications and email.
                                </p>
                                <button
                                    onClick={() => { setShowPostBriefModal(false); setBriefSubmitted(false); }}
                                    className="btn btn-primary"
                                    style={{ height: 40, padding: '0 24px', fontSize: 13.5 }}
                                >
                                    Close
                                </button>
                            </div>
                        ) : (
                            <>
                                <div>
                                    <div className="eyebrow" style={{ marginBottom: 6 }}>
                                        BROADCAST PRODUCTION BRIEF
                                    </div>
                                    <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 600, color: 'var(--fg)' }}>
                                        Hire Studio or Crew
                                    </h2>
                                    <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-3)' }}>
                                        Broadcast your shoot or edit requirements to certified Vibed partners.
                                    </p>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>
                                            Brief Title / Project Type
                                        </label>
                                        <input
                                            type="text"
                                            value={briefTitle}
                                            onChange={e => setBriefTitle(e.target.value)}
                                            placeholder="e.g. 3-Camera Podcast Shoot in London, Brand Film Color Grading"
                                            style={{
                                                width: '100%', boxSizing: 'border-box', height: 40,
                                                background: 'var(--bg-3)',
                                                border: '0.5px solid var(--glass-stroke)',
                                                borderRadius: 'var(--r-sm)',
                                                color: 'var(--fg)', padding: '0 12px',
                                                fontFamily: 'var(--f-sans)', fontSize: 13,
                                                outline: 'none',
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>
                                            Estimated Budget
                                        </label>
                                        <input
                                            type="text"
                                            value={briefBudget}
                                            onChange={e => setBriefBudget(e.target.value)}
                                            placeholder="e.g. €1,500 - €3,000 or Hourly rate"
                                            style={{
                                                width: '100%', boxSizing: 'border-box', height: 40,
                                                background: 'var(--bg-3)',
                                                border: '0.5px solid var(--glass-stroke)',
                                                borderRadius: 'var(--r-sm)',
                                                color: 'var(--fg)', padding: '0 12px',
                                                fontFamily: 'var(--f-sans)', fontSize: 13,
                                                outline: 'none',
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>
                                            Production Details & Deadlines
                                        </label>
                                        <textarea
                                            rows={4}
                                            value={briefDetails}
                                            onChange={e => setBriefDetails(e.target.value)}
                                            placeholder="Describe shoot dates, locations, reference videos, camera specs, turnaround requirements…"
                                            style={{
                                                width: '100%', boxSizing: 'border-box',
                                                background: 'var(--bg-3)',
                                                border: '0.5px solid var(--glass-stroke)',
                                                borderRadius: 'var(--r-sm)',
                                                color: 'var(--fg)', padding: '10px 12px',
                                                fontFamily: 'var(--f-sans)', fontSize: 13,
                                                outline: 'none', resize: 'vertical',
                                            }}
                                        />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                                    <button
                                        onClick={() => setShowPostBriefModal(false)}
                                        className="btn btn-ghost"
                                        style={{ flex: 1, height: 40, justifyContent: 'center' }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => setBriefSubmitted(true)}
                                        className="btn btn-primary"
                                        style={{ flex: 1, height: 40, justifyContent: 'center' }}
                                    >
                                        Broadcast to Network
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
