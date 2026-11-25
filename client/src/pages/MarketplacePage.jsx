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
    Menu, X, SlidersHorizontal, RotateCcw
} from 'lucide-react';

import { Logo } from '../components/Logo.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useUserPlan } from '../hooks/useUserPlan.js';

// R102: listings are real (GET /api/market/listings); the seed file is gone from this page.
import { fetchListings, CATEGORY_FILTERS } from '../market/marketApi.js';

import MarketplaceMap from '../components/Marketplace/MarketplaceMap.jsx';
import ProfileDetailModal from '../components/Marketplace/ProfileDetailModal.jsx';
import useMarketplaceStore from '../store/useMarketplaceStore.js';
import MarketplaceBookings from '../components/Marketplace/MarketplaceBookings.jsx';
import MarketplaceCallSheet from '../components/Marketplace/MarketplaceCallSheet.jsx';
import MarketplaceThread from '../components/Marketplace/MarketplaceThread.jsx';
import MarketplaceAssetRoom from '../components/Marketplace/MarketplaceAssetRoom.jsx';
import MarketplaceLedgerModal from '../components/Marketplace/MarketplaceLedgerModal.jsx';
import ReportProblem from '../market/ReportProblem.jsx';

/** Seed-data buyer views (bookings, call sheet, thread, asset room, ledger, report):
 *  off until they run on real bookings and payments (R102, phase 3). */
const SHOW_SEED_VIEWS = false;

export default function MarketplacePage() {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboard');
    const { plan, isPro } = useUserPlan();

    // Central marketplace store
    const { activeTab, setActiveTab, metrics, setActiveThreadId } = useMarketplaceStore();
    const [ledgerOpen, setLedgerOpen] = useState(false);



    // Filter states
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    // No availability data yet: a booking request carries the date the buyer picks.
    const selectedDate = null;
    const [radiusKm, setRadiusKm] = useState(25);
    const [maxBudget, setMaxBudget] = useState(2000); // 2000 = any
    const [selectedFeature, setSelectedFeature] = useState('all'); // 'all' | 'cyclorama' | 'daylight' | 'drivein' | 'soundstage' | 'greenkey'
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    // Search centre: Paris until the buyer picks an address (Île-de-France launch area).
    const [center, setCenter] = useState({ lat: 48.8566, lng: 2.3522, label: 'Paris' });
    const userLocation = center.label;

    // Real listings, filtered by the server on distance, category and half-day budget.
    const [listings, setListings] = useState([]);
    const [listingsState, setListingsState] = useState('loading'); // 'loading' | 'ok' | 'error'
    const [reloadKey, setReloadKey] = useState(0);
    useEffect(() => {
        let cancelled = false;
        const server = CATEGORY_FILTERS.find((c) => c.id === selectedCategory)?.server || null;
        fetchListings({ lat: center.lat, lng: center.lng, radiusKm, category: server, maxPrice: maxBudget >= 2000 ? null : maxBudget })
            .then((r) => {
                if (cancelled) return;
                if (r.ok) { setListings(r.listings || []); setListingsState('ok'); }
                else { setListingsState('error'); }
            });
        return () => { cancelled = true; };
    }, [center.lat, center.lng, radiusKm, selectedCategory, maxBudget, reloadKey]);

    // Selected listing for drawer/modal & map synchronization
    const [selectedListingId, setSelectedListingId] = useState(null);
    const [activeDetailItem, setActiveDetailItem] = useState(null);
    const [bookingItemData, setBookingItemData] = useState(null);

    // Mobile nav state
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Filtered listings
    // Distance, category and budget are applied by the server; text and studio
    // features are refined here over the listings it returned.
    const filteredListings = useMemo(() => {
        return listings.filter(item => {
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const blob = `${item.name} ${item.subtitle || ''} ${item.location || ''} ${item.address || ''} ${(item.features || []).join(' ')}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            if (selectedFeature !== 'all') {
                const itemBlob = `${(item.features || []).join(' ')} ${item.description || ''}`.toLowerCase();
                if (selectedFeature === 'cyclorama' && !itemBlob.includes('cyclorama')) return false;
                if (selectedFeature === 'daylight' && !itemBlob.includes('daylight') && !itemBlob.includes('natural light')) return false;
                if (selectedFeature === 'drivein' && !itemBlob.includes('drive-in') && !itemBlob.includes('vehicle')) return false;
                if (selectedFeature === 'soundstage' && !itemBlob.includes('soundstage') && !itemBlob.includes('acoustic')) return false;
                if (selectedFeature === 'greenkey' && !itemBlob.includes('green') && !itemBlob.includes('chroma')) return false;
            }
            return true;
        });
    }, [listings, searchQuery, selectedFeature]);

    const handleSelectListing = (id) => {
        setSelectedListingId(id);
        const found = listings.find(l => l.id === id);
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
                            ...(SHOW_SEED_VIEWS ? [
                                { id: 'bookings', label: 'Bookings', badge: metrics.needsYou > 0 ? metrics.needsYou : null },
                                { id: 'callsheet', label: 'Call Sheet' },
                                { id: 'messages', label: 'Messages', badge: '3' },
                                { id: 'assetroom', label: 'Asset Room' },
                                { id: 'report', label: 'Report a problem' },
                            ] : []),
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
                        {SHOW_SEED_VIEWS && <button
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
                        </button>}

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
                            {/* R102: the real plan, not a hard-coded "PRO · Unlimited AI". */}
                            <span>{String(plan || 'free').toUpperCase()}</span>
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
                        ...(SHOW_SEED_VIEWS ? [
                            { id: 'bookings', label: 'Bookings' },
                            { id: 'callsheet', label: 'Call Sheet' },
                            { id: 'messages', label: 'Messages' },
                            { id: 'assetroom', label: 'Asset Room' },
                            { id: 'report', label: 'Report a problem' },
                        ] : []),
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
                    {SHOW_SEED_VIEWS && <button onClick={() => { setMobileMenuOpen(false); setLedgerOpen(true); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: '#0B7C91', fontSize: 14, fontWeight: 600 }}>Escrow & Ledger</button>}
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
                {/* Seed-data views stay unreachable until bookings run on real data (R102, phase 3). */}
                {SHOW_SEED_VIEWS && activeTab === 'bookings' && <MarketplaceBookings />}
                {SHOW_SEED_VIEWS && activeTab === 'callsheet' && <MarketplaceCallSheet />}
                {SHOW_SEED_VIEWS && activeTab === 'messages' && <MarketplaceThread />}
                {SHOW_SEED_VIEWS && activeTab === 'assetroom' && <MarketplaceAssetRoom />}
                {/* Screen 29 — same screen and clock as the talent side (R100). The
                    .mk wrapper carries the market-ops tokens ReportProblem's styles use. */}
                {SHOW_SEED_VIEWS && activeTab === 'report' && (
                    <div className="mk" style={{ minHeight: 'auto', background: 'transparent' }}>
                        <ReportProblem side="buyer" onBack={() => setActiveTab('bookings')} onOpenThread={() => setActiveTab('messages')} />
                    </div>
                )}

                {(activeTab === 'discover' || !SHOW_SEED_VIEWS) && (
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
                        {listingsState === 'loading' ? 'Loading live listings…'
                            : listingsState === 'error' ? <>Could not load listings. <button type="button" onClick={() => { setListingsState('loading'); setReloadKey(k => k + 1); }} style={{ background: 'none', border: 'none', color: '#0B7C91', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>Try again</button></>
                            : <>{filteredListings.length} live {filteredListings.length === 1 ? 'listing' : 'listings'} within {radiusKm} km · half-day prices set by each talent, before the buyer service fee</>}
                    </p>
                </div>

                {/* Filter Chips & Preferences Bar */}
                <div style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    marginBottom: 20,
                }}>
                    {/* Live Search input + Clear button */}
                    <div style={{
                        position: 'relative',
                        minWidth: 280,
                        flex: '1 1 340px',
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
                            placeholder="Search studios (Kremlin, daylight loft, cyclorama, soundproof, 63A...)"
                            style={{
                                width: '100%',
                                height: 42,
                                paddingLeft: 40,
                                paddingRight: searchQuery ? 38 : 16,
                                borderRadius: 999,
                                background: '#FFFFFF',
                                border: '1px solid rgba(16, 21, 29, 0.14)',
                                color: '#10151D',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 13,
                                boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                style={{
                                    position: 'absolute',
                                    right: 12,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: '#EDF0F4',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: 20,
                                    height: 20,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: '#5F6876',
                                }}
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    {/* Preferences & Quick Filters */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        {/* Primary Preferences Filter Button */}
                        <button
                            type="button"
                            onClick={() => setPreferencesOpen(o => !o)}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 7,
                                padding: '8px 16px',
                                borderRadius: 999,
                                background: preferencesOpen ? '#10151D' : '#FFFFFF',
                                color: preferencesOpen ? '#FFFFFF' : '#10151D',
                                border: preferencesOpen ? '1px solid #10151D' : '1px solid rgba(16, 21, 29, 0.16)',
                                fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                fontSize: 12.5,
                                fontWeight: 700,
                                cursor: 'pointer',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <SlidersHorizontal size={14} color={preferencesOpen ? '#00E5FF' : '#0B7C91'} />
                            <span>Preferences</span>
                            {(radiusKm !== 25 || maxBudget !== 2000 || selectedFeature !== 'all') && (
                                <span style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: '50%',
                                    background: '#00E5FF',
                                }} />
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setRadiusKm(r => r === 25 ? 50 : r === 50 ? 80 : 25)}
                            style={{
                                padding: '7px 14px',
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
                            onClick={() => setMaxBudget(b => b === 600 ? 1000 : b === 1000 ? 2000 : 600)}
                            style={{
                                padding: '7px 14px',
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
                            {maxBudget >= 2000 ? 'Any budget' : `Under €${maxBudget}`}
                        </button>
                    </div>

                    {/* Preferences Dropdown Panel */}
                    {preferencesOpen && (
                        <div style={{
                            position: 'absolute',
                            top: 52,
                            right: 0,
                            zIndex: 45,
                            width: 380,
                            maxWidth: 'calc(100vw - 40px)',
                            background: '#FFFFFF',
                            borderRadius: 18,
                            padding: 20,
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            boxShadow: '0 20px 48px -10px rgba(16, 21, 29, 0.22), 0 4px 14px rgba(0,0,0,0.06)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 16,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #EDF0F4', paddingBottom: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <SlidersHorizontal size={15} color="#0B7C91" />
                                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#10151D', fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)' }}>
                                        Search Preferences & Specs
                                    </h4>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPreferencesOpen(false)}
                                    style={{ background: 'none', border: 'none', color: '#8E95A2', cursor: 'pointer', padding: 2 }}
                                >
                                    <X size={15} />
                                </button>
                            </div>

                            {/* Radius Slider / Pills */}
                            <div>
                                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#5F6876', marginBottom: 6, fontFamily: 'var(--f-sans, "Geist", sans-serif)' }}>
                                    Search Radius ({radiusKm} km from {userLocation})
                                </label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {[15, 25, 50, 80].map(km => (
                                        <button
                                            key={km}
                                            type="button"
                                            onClick={() => setRadiusKm(km)}
                                            style={{
                                                flex: 1,
                                                padding: '6px 0',
                                                borderRadius: 8,
                                                background: radiusKm === km ? '#10151D' : '#F4F6F8',
                                                color: radiusKm === km ? '#FFFFFF' : '#10151D',
                                                border: 'none',
                                                fontSize: 12,
                                                fontWeight: radiusKm === km ? 700 : 500,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {km} km
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Max Budget */}
                            <div>
                                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#5F6876', marginBottom: 6, fontFamily: 'var(--f-sans, "Geist", sans-serif)' }}>
                                    Max Budget (Half-Day)
                                </label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {[400, 600, 1000, 2000].map(budget => (
                                        <button
                                            key={budget}
                                            type="button"
                                            onClick={() => setMaxBudget(budget)}
                                            style={{
                                                flex: 1,
                                                padding: '6px 0',
                                                borderRadius: 8,
                                                background: maxBudget === budget ? '#10151D' : '#F4F6F8',
                                                color: maxBudget === budget ? '#FFFFFF' : '#10151D',
                                                border: 'none',
                                                fontSize: 12,
                                                fontWeight: maxBudget === budget ? 700 : 500,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {budget === 2000 ? 'Any' : `€${budget}`}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Studio Specifications & Facilities */}
                            <div>
                                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#5F6876', marginBottom: 6, fontFamily: 'var(--f-sans, "Geist", sans-serif)' }}>
                                    Studio Features
                                </label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {[
                                        { id: 'all', label: 'All features' },
                                        { id: 'cyclorama', label: '3-Wall Cyclorama' },
                                        { id: 'daylight', label: 'Natural Daylight' },
                                        { id: 'drivein', label: 'Drive-in Access' },
                                        { id: 'soundstage', label: 'Soundstage / NC-25' },
                                        { id: 'greenkey', label: 'Chroma Green' },
                                    ].map(spec => (
                                        <button
                                            key={spec.id}
                                            type="button"
                                            onClick={() => setSelectedFeature(spec.id)}
                                            style={{
                                                padding: '5px 10px',
                                                borderRadius: 8,
                                                background: selectedFeature === spec.id ? '#0B7C91' : '#F4F6F8',
                                                color: selectedFeature === spec.id ? '#FFFFFF' : '#10151D',
                                                border: 'none',
                                                fontSize: 11.5,
                                                fontWeight: selectedFeature === spec.id ? 600 : 500,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {spec.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Footer Actions */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #EDF0F4', paddingTop: 12, marginTop: 4 }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRadiusKm(25);
                                        setMaxBudget(2000);
                                        setSelectedFeature('all');
                                        setSearchQuery('');
                                    }}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#5F6876',
                                        fontSize: 12,
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                    }}
                                >
                                    <RotateCcw size={13} />
                                    <span>Reset filters</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPreferencesOpen(false)}
                                    style={{
                                        padding: '6px 16px',
                                        borderRadius: 999,
                                        background: '#10151D',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    )}
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
                    {CATEGORY_FILTERS.map(cat => {
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

                {/* R102: the Scout match strip is hidden until scores come from real
                    matching. It used to rank the seed listings by an invented score. */}

                {/* Full-Width Interactive Map (Covering full width) */}
                <div style={{ width: '100%', marginBottom: 40 }}>
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
                            MAP · {filteredListings.length} {filteredListings.length === 1 ? 'LISTING' : 'LISTINGS'}
                        </span>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                            fontSize: 12,
                            color: '#5F6876',
                        }}>
                            <span>Scroll or pinch to zoom · People are shown within about 1 km, studios at their address</span>
                        </div>
                    </div>

                    <MarketplaceMap
                        listings={filteredListings}
                        selectedId={selectedListingId}
                        onSelectListing={handleSelectListing}
                        radiusKm={radiusKm}
                        center={center}
                        onChangeLocation={(place) => setCenter({ lat: place.lat, lng: place.lng, label: place.city || place.label })}
                        onQuickBook={(item) => {
                            setBookingItemData({
                                listing: item,
                                serviceType: item.type === 'studio' ? 'Studio half-day hire' : 'Half-day operator session',
                                // was `requestedDate`, which does not exist: quick-book from the map threw a ReferenceError.
                                date: selectedDate,
                                timeSlot: 'Morning (09:00 - 13:00)',
                                totalPrice: item.priceHalfDay,
                            });
                        }}
                    />
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

            {/* R102: booking needs real payments (Stripe Connect, phase 3). The old
                escrow modal simulated a hold on seed data; against REAL listings
                it would have "booked" a real person with pretend money, so it is
                replaced by an honest notice until bookings exist. The modal stays
                in the repo as the design reference for phase 3. */}
            {bookingItemData && (
                <div role="dialog" aria-modal="true" aria-labelledby="mk-booking-soon" onClick={() => setBookingItemData(null)}
                    style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(16,21,29,0.35)', display: 'grid', placeItems: 'center', padding: 20 }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, padding: '26px 28px', maxWidth: 440, boxShadow: '0 24px 60px rgba(16,21,29,0.25)' }}>
                        <h2 id="mk-booking-soon" style={{ margin: '0 0 8px', fontSize: 20, color: '#10151D' }}>Booking opens with payments</h2>
                        <p style={{ margin: 0, color: '#5F6876', lineHeight: 1.55 }}>
                            {bookingItemData.listing?.name || 'This listing'} is live, but requests can only be sent once escrow payments are switched on. Nothing was requested and nothing was charged.
                        </p>
                        <button type="button" onClick={() => setBookingItemData(null)} style={{ marginTop: 18, padding: '9px 18px', borderRadius: 10, border: '1px solid #10151D', background: '#10151D', color: '#fff', cursor: 'pointer' }}>OK</button>
                    </div>
                </div>
            )}

            {/* Financial Ledger & Escrow Modal (Screen 15) */}
            <MarketplaceLedgerModal
                isOpen={ledgerOpen}
                onClose={() => setLedgerOpen(false)}
            />
        </div>
    );
}
