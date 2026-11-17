/**
 * client/src/pages/MarketplacePage.jsx
 *
 * VIBED Market — Surface A (Book a shoot: Studios, Crews, Operators, Sound).
 * Recreates the complete design system from "VIBED Market — marketplace design"
 * (screens 00, 01, 02, 03, 04, 05, 06).
 *
 * Light-first architecture with landing-page inspired aesthetic (liquid glass top nav,
 * subtle aurora ambient glow, Plus Jakarta Sans display typography, Geist UI, JetBrains Mono data).
 *
 * Strictly zero emojis.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Search, Filter, MapPin, Star, ShieldCheck, CheckCircle2,
    Calendar, Clock, Check, ChevronDown, ChevronLeft, ArrowRight, Lock, Users, Sparkles,
    Menu, X
} from 'lucide-react';

import { Logo } from '../components/Logo.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useUserPlan } from '../hooks/useUserPlan.js';
import { listProjects } from '../lib/projectsApi.js';
import useTimelineStore from '../store/useTimelineStore.js';

import {
    MARKET_CATEGORIES,
    INITIAL_LOCATION,
    LISTINGS,
    MOCK_SCOUT_PROJECT
} from '../data/marketplaceSeedData.js';

import MarketplaceMap from '../components/Marketplace/MarketplaceMap.jsx';
import ProfileDetailModal from '../components/Marketplace/ProfileDetailModal.jsx';
import BookingEscrowModal from '../components/Marketplace/BookingEscrowModal.jsx';
import useMarketplaceStore from '../store/useMarketplaceStore.js';
import MarketplaceBookings from '../components/Marketplace/MarketplaceBookings.jsx';
import MarketplaceCallSheet from '../components/Marketplace/MarketplaceCallSheet.jsx';
import MarketplaceThread from '../components/Marketplace/MarketplaceThread.jsx';
import MarketplaceAssetRoom from '../components/Marketplace/MarketplaceAssetRoom.jsx';
import MarketplaceLedgerModal from '../components/Marketplace/MarketplaceLedgerModal.jsx';

export default function MarketplacePage() {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboard');
    const { plan, isPro } = useUserPlan();

    // Central marketplace store
    const { activeTab, setActiveTab, metrics, setActiveThreadId } = useMarketplaceStore();
    const [ledgerOpen, setLedgerOpen] = useState(false);

    // Active project metadata from useTimelineStore (or fallback)
    const { projectName, projectId } = useTimelineStore();

    // Local user projects for attaching to booking
    const [userProjects, setUserProjects] = useState([]);
    useEffect(() => {
        listProjects().then(res => {
            const list = res?.projects || res || [];
            setUserProjects(Array.isArray(list) ? list : []);
        }).catch(err => console.warn('[MarketplacePage] projects load error:', err.message));
    }, []);

    // Filter states
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDate, setSelectedDate] = useState('Thu 19 Nov · half-day');
    const [radiusKm, setRadiusKm] = useState(25);
    const [maxBudget, setMaxBudget] = useState(600);
    const [onlyCertified, setOnlyCertified] = useState(false);
    const [onlyInstantBook, setOnlyInstantBook] = useState(false);
    const [userLocation, setUserLocation] = useState(INITIAL_LOCATION.city);

    // Selected listing for drawer/modal & map synchronization
    const [selectedListingId, setSelectedListingId] = useState(null);
    const [activeDetailItem, setActiveDetailItem] = useState(null);
    const [bookingItemData, setBookingItemData] = useState(null);

    // Mobile nav state
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Filtered listings
    const filteredListings = useMemo(() => {
        return LISTINGS.filter(item => {
            // Category filter
            if (selectedCategory !== 'all' && item.category !== selectedCategory) {
                return false;
            }
            // Search query filter
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchName = item.name.toLowerCase().includes(q);
                const matchSubtitle = (item.subtitle || '').toLowerCase().includes(q);
                const matchLocation = item.location.toLowerCase().includes(q);
                const matchFeatures = (item.features || []).some(f => f.toLowerCase().includes(q));
                const matchKit = (item.kit || []).some(k => k.toLowerCase().includes(q));
                if (!matchName && !matchSubtitle && !matchLocation && !matchFeatures && !matchKit) {
                    return false;
                }
            }
            // Budget filter
            if (item.priceHalfDay > maxBudget) {
                return false;
            }
            // Certified filter
            if (onlyCertified && !(item.badges || []).some(b => b.includes('certified') || b.includes('Certified'))) {
                return false;
            }
            // Instant book filter
            if (onlyInstantBook && !(item.badges || []).includes('Instant book')) {
                return false;
            }
            return true;
        });
    }, [selectedCategory, searchQuery, maxBudget, onlyCertified, onlyInstantBook]);

    // Active scout project summary
    const scoutProject = useMemo(() => {
        if (projectName && projectName.trim()) {
            return {
                name: projectName,
                tagline: `Active project · ${projectName} · needs a quiet room with controllable light.`,
            };
        }
        return MOCK_SCOUT_PROJECT;
    }, [projectName]);

    // Top Scout recommendations (sorted by scoutScore)
    const scoutMatches = useMemo(() => {
        return [...LISTINGS].sort((a, b) => (b.scoutScore || 0) - (a.scoutScore || 0)).slice(0, 3);
    }, []);

    const handleSelectListing = (id) => {
        setSelectedListingId(id);
        const found = LISTINGS.find(l => l.id === id);
        if (found) {
            setActiveDetailItem(found);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: '#EDEAE3',
            color: '#10151D',
            fontFamily: 'var(--f-sans, "Geist", -apple-system, sans-serif)',
            position: 'relative',
            overflowX: 'hidden',
        }}>
            {/* Soft Ambient Aurora Glows (Landing-page inspired, warm light canvas) */}
            <div style={{
                position: 'fixed',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100vw',
                height: 480,
                background: 'radial-gradient(ellipse 70% 35% at 50% -10%, rgba(11, 124, 145, 0.08), transparent 75%)',
                pointerEvents: 'none',
                zIndex: 0,
            }} />
            <div style={{
                position: 'fixed',
                bottom: 0,
                right: '10%',
                width: 600,
                height: 380,
                background: 'radial-gradient(ellipse 60% 40% at 50% 100%, rgba(11, 124, 145, 0.04), transparent 70%)',
                pointerEvents: 'none',
                zIndex: 0,
            }} />

            {/* Floating Liquid Glass Top Navigation Bar */}
            <div style={{
                position: 'sticky',
                top: 14,
                zIndex: 50,
                display: 'flex',
                justifyContent: 'center',
                padding: '0 20px',
                pointerEvents: 'none',
            }}>
                <header style={{
                    pointerEvents: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    maxWidth: 1240,
                    height: 52,
                    padding: '0 20px',
                    borderRadius: 999,
                    background: 'rgba(255, 255, 255, 0.88)',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                    border: '1px solid rgba(16, 21, 29, 0.1)',
                    boxShadow: '0 12px 36px -6px rgba(16, 21, 29, 0.09), 0 2px 8px -2px rgba(16, 21, 29, 0.04)',
                }}>
                    {/* Left: Brand Logo & Wordmark + Quick Back to Projects */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                            onClick={() => navigate('/dashboard')}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                        >
                            <Logo size={24} />
                            <span style={{
                                fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                fontSize: 17,
                                fontWeight: 800,
                                color: '#10151D',
                                letterSpacing: '-0.025em',
                            }}>
                                VIBED
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/dashboard')}
                            title="Return to Projects"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: '#F4F6F8',
                                border: '1px solid rgba(16, 21, 29, 0.08)',
                                borderRadius: 999,
                                padding: '3px 10px',
                                fontSize: 11.5,
                                fontWeight: 600,
                                color: '#5F6876',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <ChevronLeft size={13} />
                            <span>Projects</span>
                        </button>
                    </div>

                    {/* Center: Primary Marketplace Tabs (Discover, Bookings, Call Sheet, Messages, Asset Room) */}
                    <nav className="hidden md:flex" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {[
                            { id: 'discover', label: 'Discover' },
                            { id: 'bookings', label: 'Bookings', badge: metrics.needsYou > 0 ? metrics.needsYou : null },
                            { id: 'callsheet', label: 'Call Sheet' },
                            { id: 'messages', label: 'Messages', badge: '3' },
                            { id: 'assetroom', label: 'Asset Room' },
                        ].map(tab => {
                            const isSel = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    style={{
                                        background: isSel ? '#10151D' : 'transparent',
                                        color: isSel ? '#FFFFFF' : '#5F6876',
                                        border: isSel ? '1px solid #10151D' : 'none',
                                        padding: isSel ? '6px 14px' : '6px 12px',
                                        borderRadius: 999,
                                        fontSize: 13,
                                        fontWeight: isSel ? 700 : 500,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        transition: 'all 0.15s ease',
                                        boxShadow: isSel ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                                    }}
                                >
                                    <span>{tab.label}</span>
                                    {tab.badge && (
                                        <span style={{
                                            background: isSel ? '#00E5FF' : 'rgba(11, 124, 145, 0.12)',
                                            color: isSel ? '#10151D' : '#0B7C91',
                                            fontSize: 10,
                                            fontWeight: 800,
                                            padding: '1px 6px',
                                            borderRadius: 999,
                                        }}>
                                            {tab.badge}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    {/* Right: Escrow & Ledger + Pro Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                            type="button"
                            onClick={() => setLedgerOpen(true)}
                            className="hidden sm:flex"
                            style={{
                                background: '#FAF9F6',
                                border: '1px solid rgba(26, 28, 34, 0.12)',
                                color: '#10151D',
                                padding: '5px 12px',
                                borderRadius: 999,
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <ShieldCheck size={13} color="#0B7C91" />
                            <span>Escrow & Ledger</span>
                        </button>

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            borderRadius: 999,
                            background: '#F0F9FB',
                            border: '1px solid #D4EFF6',
                            color: '#0B7C91',
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 11,
                            fontWeight: 600,
                        }}>
                            <span>PRO</span>
                            <span style={{ color: 'rgba(11, 124, 145, 0.4)' }}>·</span>
                            <span>Unlimited AI</span>
                        </div>

                        {/* Mobile hamburger */}
                        <button
                            type="button"
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden"
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#10151D',
                                cursor: 'pointer',
                                padding: 4,
                            }}
                        >
                            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </header>
            </div>

            {/* Mobile Dropdown Menu */}
            {mobileMenuOpen && (
                <div style={{
                    position: 'fixed',
                    top: 72,
                    left: 20,
                    right: 20,
                    zIndex: 49,
                    background: '#FFFFFF',
                    borderRadius: 16,
                    padding: 16,
                    border: '1px solid rgba(16, 21, 29, 0.1)',
                    boxShadow: '0 16px 36px rgba(0,0,0,0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                }}>
                    {[
                        { id: 'discover', label: 'Discover' },
                        { id: 'bookings', label: 'Bookings' },
                        { id: 'callsheet', label: 'Call Sheet' },
                        { id: 'messages', label: 'Messages' },
                        { id: 'assetroom', label: 'Asset Room' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); }}
                            style={{
                                textAlign: 'left',
                                padding: '10px 14px',
                                background: activeTab === tab.id ? '#10151D' : 'none',
                                border: 'none',
                                color: activeTab === tab.id ? '#FFFFFF' : '#10151D',
                                fontSize: 14,
                                fontWeight: activeTab === tab.id ? 700 : 500,
                                borderRadius: 8,
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                    <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)', margin: '6px 0' }} />
                    <button onClick={() => { setMobileMenuOpen(false); setLedgerOpen(true); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: '#0B7C91', fontSize: 14, fontWeight: 600 }}>Escrow & Ledger</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/dashboard'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: '#5F6876', fontSize: 13 }}>← Back to Projects</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/design'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: '#5F6876', fontSize: 13 }}>Design Studio</button>
                </div>
            )}

            {/* Main Market Hub Page Body */}
            <main style={{
                maxWidth: 1240,
                margin: '0 auto',
                padding: '24px 20px 80px',
                position: 'relative',
                zIndex: 1,
            }}>
                {/* Sub-view switcher */}
                {activeTab === 'bookings' && <MarketplaceBookings />}
                {activeTab === 'callsheet' && <MarketplaceCallSheet />}
                {activeTab === 'messages' && <MarketplaceThread />}
                {activeTab === 'assetroom' && <MarketplaceAssetRoom />}

                {activeTab === 'discover' && (
                    <>
                        {/* Surface Switcher Pills (Surface A: Book a shoot) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <div style={{
                        padding: '6px 16px',
                        borderRadius: 999,
                        background: '#FFFFFF',
                        border: '1.5px solid #0B7C91',
                        color: '#0B7C91',
                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                        fontSize: 13,
                        fontWeight: 600,
                        boxShadow: '0 2px 8px rgba(11, 124, 145, 0.12)',
                    }}>
                        Book a shoot
                    </div>
                </div>

                {/* Screen 03 Main Header */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                    <h1 style={{
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", -apple-system, sans-serif)',
                        fontSize: 'clamp(28px, 4vw, 42px)',
                        fontWeight: 800,
                        color: '#10151D',
                        margin: 0,
                        letterSpacing: '-0.025em',
                        lineHeight: 1.12,
                    }}>
                        Studios and crew near {userLocation}
                    </h1>
                    <p style={{
                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                        fontSize: 14,
                        color: '#5F6876',
                        margin: 0,
                    }}>
                        {filteredListings.length} of {LISTINGS.length} listings, filtered by your brief · prices include the 5% service fee and VAT · <span style={{ color: '#0B7C91', cursor: 'pointer', textDecoration: 'underline' }}>edit the brief</span>
                    </p>
                </div>

                {/* Filter Chips Bar */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    marginBottom: 24,
                }}>
                    {/* Live Search input */}
                    <div style={{
                        position: 'relative',
                        minWidth: 280,
                        flex: '1 1 320px',
                    }}>
                        <Search
                            size={16}
                            color="#5F6876"
                            style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }}
                        />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="studio with cyclorama, Paris sud, sound op..."
                            style={{
                                width: '100%',
                                height: 40,
                                paddingLeft: 40,
                                paddingRight: 16,
                                borderRadius: 999,
                                background: '#FFFFFF',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                color: '#10151D',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 13,
                                boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                                outline: 'none',
                            }}
                        />
                    </div>

                    {/* Quick Filter Pills */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => {}}
                            style={{
                                padding: '6px 14px',
                                borderRadius: 999,
                                background: '#FFFFFF',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                color: '#10151D',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            {selectedDate}
                        </button>
                        <button
                            type="button"
                            onClick={() => setRadiusKm(r => r === 25 ? 50 : 25)}
                            style={{
                                padding: '6px 14px',
                                borderRadius: 999,
                                background: '#FFFFFF',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                color: '#10151D',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            {radiusKm} km
                        </button>
                        <button
                            type="button"
                            onClick={() => setMaxBudget(b => b === 600 ? 1000 : 600)}
                            style={{
                                padding: '6px 14px',
                                borderRadius: 999,
                                background: maxBudget === 600 ? '#EDF0F4' : '#FFFFFF',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                color: '#10151D',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            Under €{maxBudget}
                        </button>
                        <button
                            type="button"
                            onClick={() => setOnlyCertified(c => !c)}
                            style={{
                                padding: '6px 14px',
                                borderRadius: 999,
                                background: onlyCertified ? '#10151D' : '#FFFFFF',
                                color: onlyCertified ? '#FFFFFF' : '#10151D',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            Certified +
                        </button>
                        <button
                            type="button"
                            onClick={() => setOnlyInstantBook(b => !b)}
                            style={{
                                padding: '6px 14px',
                                borderRadius: 999,
                                background: onlyInstantBook ? '#0B7C91' : '#FFFFFF',
                                color: onlyInstantBook ? '#FFFFFF' : '#10151D',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            Instant book
                        </button>
                    </div>
                </div>

                {/* Category Rail (Surface A) */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    overflowX: 'auto',
                    paddingBottom: 4,
                    marginBottom: 24,
                }}>
                    {MARKET_CATEGORIES.map(cat => {
                        const isActive = selectedCategory === cat.id;
                        return (
                            <button
                                key={cat.id}
                                type="button"
                                onClick={() => setSelectedCategory(cat.id)}
                                style={{
                                    padding: '7px 16px',
                                    borderRadius: 999,
                                    background: isActive ? '#10151D' : '#FFFFFF',
                                    color: isActive ? '#FFFFFF' : '#5F6876',
                                    border: '1px solid rgba(16, 21, 29, 0.08)',
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 13,
                                    fontWeight: isActive ? 600 : 500,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    transition: 'all 0.15s ease',
                                    boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                                }}
                            >
                                {cat.label}
                            </button>
                        );
                    })}
                </div>

                {/* SCOUT · MATCHED TO AN OPEN PROJECT STRIP */}
                <section style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(16, 21, 29, 0.08)',
                    borderRadius: 16,
                    padding: '20px 24px',
                    marginBottom: 32,
                    boxShadow: '0 4px 16px -4px rgba(16, 21, 29, 0.04)',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                        marginBottom: 16,
                    }}>
                        <div>
                            <span style={{
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.08em',
                                color: '#0B7C91',
                                textTransform: 'uppercase',
                                display: 'block',
                                marginBottom: 4,
                            }}>
                                SCOUT · MATCHED TO AN OPEN PROJECT
                            </span>
                            <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 14, color: '#10151D' }}>
                                From <strong style={{ fontWeight: 600 }}>"{scoutProject.name}"</strong>: {scoutProject.tagline}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => {}}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#5F6876',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 12,
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                padding: 0,
                            }}
                        >
                            How the score is built
                        </button>
                    </div>

                    {/* Three Scout Match Cards */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: 16,
                    }}>
                        {scoutMatches.map(match => (
                            <div
                                key={match.id}
                                onClick={() => handleSelectListing(match.id)}
                                style={{
                                    background: '#F8F9FA',
                                    border: '1px solid rgba(16, 21, 29, 0.08)',
                                    borderRadius: 12,
                                    padding: '16px 18px',
                                    cursor: 'pointer',
                                    transition: 'all 0.18s ease',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between',
                                    boxShadow: '0 2px 6px rgba(16, 21, 29, 0.02)',
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = 'rgba(11, 124, 145, 0.4)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = 'rgba(16, 21, 29, 0.08)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <div>
                                        <div style={{
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 14,
                                            fontWeight: 600,
                                            color: '#10151D',
                                        }}>
                                            {match.name}
                                        </div>
                                        <div style={{
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 12,
                                            color: '#5F6876',
                                        }}>
                                            {match.kind} · {match.location}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                        fontSize: 20,
                                        fontWeight: 600,
                                        color: match.scoutScore >= 90 ? '#0B7C91' : '#10151D',
                                    }}>
                                        {match.scoutScore}
                                    </span>
                                </div>
                                <p style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 12,
                                    color: '#5F6876',
                                    margin: 0,
                                    lineHeight: 1.45,
                                }}>
                                    {match.scoutReason}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Main 2-Column Layout: Left Listings & Right Interactive Map */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr minmax(360px, 480px)',
                    gap: 32,
                    alignItems: 'start',
                }}>
                    {/* Left Column: Listings */}
                    <div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 16,
                            paddingBottom: 8,
                            borderBottom: '1px solid #EDF0F4',
                        }}>
                            <span style={{
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: '0.08em',
                                color: '#5F6876',
                                textTransform: 'uppercase',
                            }}>
                                RESULTS · SORTED BY MATCH
                            </span>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 12,
                                color: '#10151D',
                                cursor: 'pointer',
                            }}>
                                <span>Sort: match</span>
                                <ChevronDown size={14} color="#5F6876" />
                            </div>
                        </div>

                        {/* Listing Cards List */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {filteredListings.map(item => {
                                const isSelected = selectedListingId === item.id;
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => handleSelectListing(item.id)}
                                        style={{
                                            background: '#FFFFFF',
                                            borderRadius: 16,
                                            border: isSelected ? '1.5px solid #0B7C91' : '1px solid rgba(16, 21, 29, 0.08)',
                                            padding: 20,
                                            display: 'grid',
                                            gridTemplateColumns: '110px 1fr auto',
                                            gap: 20,
                                            alignItems: 'center',
                                            cursor: 'pointer',
                                            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                                            boxShadow: isSelected
                                                ? '0 8px 24px -4px rgba(11, 124, 145, 0.16)'
                                                : '0 2px 8px rgba(16, 21, 29, 0.03)',
                                        }}
                                    >
                                        {/* Thumbnail / Media Box */}
                                        <div style={{
                                            width: 110,
                                            height: 90,
                                            borderRadius: 10,
                                            background: '#E9EFF5',
                                            position: 'relative',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                        }}>
                                            <span style={{
                                                position: 'absolute',
                                                top: 6,
                                                left: 6,
                                                padding: '2px 6px',
                                                borderRadius: 4,
                                                background: 'rgba(255, 255, 255, 0.85)',
                                                color: '#10151D',
                                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                fontSize: 10,
                                                fontWeight: 600,
                                            }}>
                                                {item.type === 'studio' ? `${item.roomsCount || 4} rooms` : 'Verified work'}
                                            </span>
                                        </div>

                                        {/* Listing Meta */}
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                <h3 style={{
                                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                    fontSize: 16,
                                                    fontWeight: 600,
                                                    color: '#10151D',
                                                    margin: 0,
                                                }}>
                                                    {item.name}
                                                </h3>
                                            </div>
                                            <p style={{
                                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                fontSize: 13,
                                                color: '#5F6876',
                                                margin: '0 0 10px 0',
                                            }}>
                                                {item.subtitle}
                                            </p>

                                            {/* Badges Row */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                                                {(item.badges || []).slice(0, 4).map((b, idx) => (
                                                    <span
                                                        key={idx}
                                                        style={{
                                                            padding: '2px 8px',
                                                            borderRadius: 999,
                                                            background: b === 'Pro' ? '#EDF0F4' : b.includes('verified') || b.includes('Certified') ? '#E6F4EA' : '#F6F7F9',
                                                            color: b === 'Pro' ? '#10151D' : b.includes('verified') || b.includes('Certified') ? '#0F7A52' : '#5F6876',
                                                            border: '1px solid rgba(16, 21, 29, 0.06)',
                                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                            fontSize: 11,
                                                            fontWeight: 500,
                                                        }}
                                                    >
                                                        {b}
                                                    </span>
                                                ))}
                                            </div>

                                            {/* Rating & reply metric */}
                                            <div style={{
                                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                fontSize: 12,
                                                color: '#5F6876',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                            }}>
                                                <span style={{ fontWeight: 600, color: '#10151D' }}>{item.rating.toFixed(2)}</span>
                                                <span>·</span>
                                                <span>{item.jobsCount} jobs</span>
                                                <span>·</span>
                                                <span>{item.replyTime}</span>
                                            </div>
                                        </div>

                                        {/* Pricing & CTA Column */}
                                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                                            <div style={{
                                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                fontSize: 22,
                                                fontWeight: 600,
                                                color: '#10151D',
                                                lineHeight: 1,
                                            }}>
                                                €{item.priceHalfDay}
                                            </div>
                                            <div style={{
                                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                fontSize: 11,
                                                color: '#5F6876',
                                            }}>
                                                half-day, all in
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSelectListing(item.id);
                                                }}
                                                style={{
                                                    marginTop: 8,
                                                    padding: '6px 12px',
                                                    borderRadius: 8,
                                                    background: '#EDF0F4',
                                                    color: '#10151D',
                                                    border: 'none',
                                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                    fontSize: 12,
                                                    fontWeight: 500,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {item.type === 'studio' ? 'View listing' : 'View profile'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right Column: Interactive Map */}
                    <div style={{ position: 'sticky', top: 80 }}>
                        <MarketplaceMap
                            listings={filteredListings}
                            selectedId={selectedListingId}
                            onSelectListing={handleSelectListing}
                            radiusKm={radiusKm}
                            userLocation={userLocation}
                            onChangeLocation={() => {
                                const newLoc = window.prompt('Enter city or postcode (e.g. Montreuil 93100):', userLocation);
                                if (newLoc && newLoc.trim()) {
                                    setUserLocation(newLoc.trim());
                                }
                            }}
                            onQuickBook={(item) => {
                                setBookingItemData({
                                    listing: item,
                                    serviceType: item.type === 'studio' ? 'Studio half-day hire' : 'Half-day operator session',
                                    date: requestedDate,
                                    timeSlot: 'Morning (09:00 - 13:00)',
                                    totalPrice: item.priceHalfDay,
                                });
                            }}
                        />
                    </div>
                </div>
                </>
            )}
            </main>

            {/* Profile Detail Drawer / Modal (Screen 04) */}
            {activeDetailItem && (
                <ProfileDetailModal
                    item={activeDetailItem}
                    onClose={() => setActiveDetailItem(null)}
                    onRequestBooking={(bookingData) => {
                        setActiveDetailItem(null);
                        setBookingItemData(bookingData);
                    }}
                    onMessage={(item) => {
                        setActiveDetailItem(null);
                        setActiveThreadId('thread-nour');
                        setActiveTab('messages');
                    }}
                />
            )}

            {/* Booking & Escrow Hold Modal (Screen 06) */}
            {bookingItemData && (
                <BookingEscrowModal
                    bookingData={bookingItemData}
                    userProjects={userProjects}
                    onClose={() => setBookingItemData(null)}
                    onConfirmSuccess={(res) => {
                        console.log('[MarketplacePage] Booking created successfully:', res);
                    }}
                />
            )}

            {/* Financial Ledger & Escrow Modal (Screen 15) */}
            <MarketplaceLedgerModal
                isOpen={ledgerOpen}
                onClose={() => setLedgerOpen(false)}
            />
        </div>
    );
}
