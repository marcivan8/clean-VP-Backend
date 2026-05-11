import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Wand2, Zap, ChevronRight, Scissors, Mic, Volume2, Layers } from 'lucide-react';

/* ─── Brand colors (matches CSS vars in index.css) ─── */
const BRAND = {
    blue:   '#1a3fa8',
    gold:   '#FFB800',
    dark:   '#080c18',
    card:   '#0d1120',
    border: 'rgba(255,255,255,0.07)',
};

/* ─── Vibed SVG Logo (inline — no network request, no Three.js) ─── */
const VibedLogoIcon = ({ size = 40, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 500 500"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
    >
        <path
            d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z"
            fill="none"
            stroke="#1a3fa8"
            strokeWidth="18"
            strokeLinejoin="round"
            strokeLinecap="round"
        />
        <line x1="248" y1="248" x2="195" y2="268" stroke="#FFB800" strokeWidth="8" strokeLinecap="round" />
    </svg>
);

/* ─── Feature pill ─── */
const FeaturePill = ({ icon: Icon, label }) => (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/8 text-xs text-white/50 font-medium">
        <Icon className="w-3 h-3 text-[#FFB800]" />
        {label}
    </div>
);

/* ─── Main card that navigates to editor ─── */
const LaunchCard = ({ onClick }) => (
    <div
        onClick={onClick}
        id="launch-editor-card"
        className="group relative cursor-pointer rounded-2xl overflow-hidden border border-white/8 hover:border-[#1a3fa8]/60 transition-all duration-500 hover:shadow-2xl"
        style={{ background: BRAND.card, boxShadow: '0 0 0 0 transparent' }}
    >
        {/* Blue glow on hover */}
        <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
            style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(26,63,168,0.15) 0%, transparent 70%)' }}
        />

        <div className="relative z-10 p-10 flex flex-col gap-8">
            {/* Icon + badge */}
            <div className="flex items-start justify-between">
                <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: 'rgba(26,63,168,0.15)', border: '1px solid rgba(26,63,168,0.3)' }}
                >
                    <VibedLogoIcon size={34} />
                </div>
                <span
                    className="text-xs font-semibold px-3 py-1 rounded-full"
                    style={{ background: 'rgba(255,184,0,0.12)', color: '#FFB800', border: '1px solid rgba(255,184,0,0.25)' }}
                >
                    AI-Powered
                </span>
            </div>

            {/* Copy */}
            <div>
                <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">
                    Open the Editor
                </h2>
                <p className="text-white/45 leading-relaxed text-sm max-w-sm">
                    Upload your footage and let the AI agent handle the heavy lifting — silence removal, filler words, color grading, and more.
                </p>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2">
                <FeaturePill icon={Scissors} label="Filler removal" />
                <FeaturePill icon={Volume2} label="Audio cleanup" />
                <FeaturePill icon={Layers} label="Timeline editor" />
                <FeaturePill icon={Mic} label="Auto-captions" />
            </div>

            {/* CTA */}
            <div className="flex items-center gap-2 text-sm font-semibold text-[#1a3fa8] group-hover:text-white transition-colors duration-300">
                Launch Editor
                <ChevronRight
                    className="w-4 h-4 transform group-hover:translate-x-1 transition-transform duration-300"
                />
            </div>
        </div>
    </div>
);

/* ─── Stat box ─── */
const StatBox = ({ value, label }) => (
    <div className="flex flex-col items-center gap-1">
        <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
        <span className="text-xs text-white/35 font-medium uppercase tracking-wider">{label}</span>
    </div>
);

/* ─── HomePage ─── */
const HomePage = () => {
    const navigate = useNavigate();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // Simple fade-in — no Three.js, no heavy libs
        const t = setTimeout(() => setMounted(true), 30);
        return () => clearTimeout(t);
    }, []);

    return (
        <div
            className="min-h-screen text-white overflow-hidden relative"
            style={{ background: BRAND.dark, fontFamily: "'Outfit', sans-serif" }}
        >
            {/* ── Subtle static gradient blobs (CSS only — zero JS overhead) ── */}
            <div
                className="pointer-events-none absolute inset-0 overflow-hidden"
                aria-hidden="true"
            >
                {/* Top-left blue glow */}
                <div
                    style={{
                        position: 'absolute', top: '-15%', left: '-10%',
                        width: '55vw', height: '55vw', borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(26,63,168,0.18) 0%, transparent 65%)',
                        filter: 'blur(40px)',
                    }}
                />
                {/* Bottom-right gold accent */}
                <div
                    style={{
                        position: 'absolute', bottom: '-10%', right: '-8%',
                        width: '40vw', height: '40vw', borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(255,184,0,0.08) 0%, transparent 65%)',
                        filter: 'blur(50px)',
                    }}
                />
            </div>

            {/* ── CONTENT ── */}
            <div
                className="relative z-10 max-w-5xl mx-auto px-6 flex flex-col min-h-screen"
                style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(12px)',
                    transition: 'opacity 0.5s ease, transform 0.5s ease',
                }}
            >
                {/* ── NAV ── */}
                <nav className="flex items-center justify-between py-7">
                    <div className="flex items-center gap-3">
                        <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center"
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                        >
                            <VibedLogoIcon size={22} />
                        </div>
                        <span className="text-lg font-bold tracking-tight text-white">Vibed</span>
                        <span
                            className="hidden sm:block text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-widest"
                            style={{ background: 'rgba(26,63,168,0.18)', color: '#7ba3ff', border: '1px solid rgba(26,63,168,0.3)' }}
                        >
                            Beta
                        </span>
                    </div>

                    <div className="flex items-center gap-5">
                        <span className="hidden md:block text-sm text-white/35 font-medium">Vibe Editing</span>
                        <button
                            id="nav-open-editor"
                            onClick={() => navigate('/editor')}
                            className="text-sm font-semibold px-5 py-2 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95"
                            style={{
                                background: 'linear-gradient(135deg, #1a3fa8 0%, #2952d4 100%)',
                                boxShadow: '0 0 20px rgba(26,63,168,0.35)',
                            }}
                        >
                            Open Editor
                        </button>
                    </div>
                </nav>

                {/* ── HERO ── */}
                <main className="flex-1 flex flex-col justify-center py-12 gap-14">
                    {/* Headline */}
                    <div className="text-center flex flex-col items-center gap-5">
                        {/* Tag */}
                        <div
                            className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-widest"
                            style={{ background: 'rgba(255,184,0,0.08)', color: '#FFB800', border: '1px solid rgba(255,184,0,0.2)' }}
                        >
                            <Zap className="w-3 h-3" />
                            AI-Powered Video Editing
                        </div>

                        <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] max-w-3xl">
                            <span className="text-white">Edit to your</span>
                            <br />
                            <span style={{
                                background: 'linear-gradient(135deg, #1a3fa8 0%, #4a7aff 50%, #FFB800 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}>
                                vibe.
                            </span>
                        </h1>

                        <p className="text-base md:text-lg text-white/45 max-w-lg leading-relaxed">
                            Vibed is an AI video editor that removes silence, filler words, and noise — so you can focus on the content, not the cuts.
                        </p>

                        {/* Primary CTA */}
                        <button
                            id="hero-launch-editor"
                            onClick={() => navigate('/editor')}
                            className="flex items-center gap-2 text-sm font-bold px-8 py-3.5 rounded-2xl mt-2 transition-all duration-200 hover:scale-105 active:scale-95 hover:shadow-2xl"
                            style={{
                                background: 'linear-gradient(135deg, #1a3fa8 0%, #2952d4 100%)',
                                boxShadow: '0 8px 32px rgba(26,63,168,0.4)',
                            }}
                        >
                            <VibedLogoIcon size={18} />
                            Start Editing Free
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    {/* ── Main Card ── */}
                    <LaunchCard onClick={() => navigate('/editor')} />

                    {/* ── Stats bar ── */}
                    <div
                        className="flex items-center justify-center gap-10 md:gap-16 py-6 rounded-2xl"
                        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                        <StatBox value="10×" label="Faster editing" />
                        <div className="w-px h-8 bg-white/8" />
                        <StatBox value="AI" label="Co-pilot" />
                        <div className="w-px h-8 bg-white/8" />
                        <StatBox value="100%" label="Privacy first" />
                        <div className="w-px h-8 bg-white/8" />
                        <StatBox value="NLE" label="Export ready" />
                    </div>
                </main>

                {/* ── FOOTER ── */}
                <footer className="py-6 flex items-center justify-between border-t border-white/5">
                    <div className="flex items-center gap-2">
                        <VibedLogoIcon size={16} />
                        <span className="text-xs text-white/25 font-medium">Vibed — Vibe Editing</span>
                    </div>
                    <span className="text-xs text-white/20">© 2025</span>
                </footer>
            </div>
        </div>
    );
};

export default HomePage;
