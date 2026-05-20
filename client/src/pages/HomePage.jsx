import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Wand2, Zap, ChevronRight, Scissors, Mic, Volume2, Layers } from 'lucide-react';

/* ─── Vibed SVG Logo ─── */
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
            stroke="currentColor"
            strokeWidth="24"
            strokeLinejoin="round"
            strokeLinecap="round"
        />
        <line x1="248" y1="248" x2="195" y2="268" stroke="currentColor" strokeWidth="12" strokeLinecap="round" className="text-accent" />
    </svg>
);

const FeaturePill = ({ icon: Icon, label }) => (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/60 border border-white/5 text-xs text-muted-foreground font-medium backdrop-blur-sm">
        <Icon className="w-3 h-3 text-primary" />
        {label}
    </div>
);

const StatBox = ({ value, label }) => (
    <div className="flex flex-col items-center gap-1">
        <span className="text-2xl font-extrabold text-foreground tracking-tight">{value}</span>
        <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">{label}</span>
    </div>
);

const HomePage = () => {
    const navigate = useNavigate();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 50);
        return () => clearTimeout(t);
    }, []);

    return (
        <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans relative selection:bg-primary/30">
            {/* ── Background Glows (Cyber-Cinematic) ── */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
                <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-primary/10 blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-accent/5 blur-[120px]" />
            </div>

            <div
                className="relative z-10 max-w-6xl mx-auto px-6 flex flex-col min-h-screen"
                style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(20px)',
                    transition: 'opacity 0.7s ease-out, transform 0.7s ease-out',
                }}
            >
                {/* ── NAV ── */}
                <nav className="flex items-center justify-between py-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-card border border-white/5 text-primary">
                            <VibedLogoIcon size={24} />
                        </div>
                        <span className="text-xl font-extrabold tracking-tight text-foreground">Vibed</span>
                    </div>

                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => navigate('/editor')}
                            className="glass-button px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 group"
                        >
                            Open Editor
                            <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </nav>

                {/* ── HERO ── */}
                <main className="flex-1 flex flex-col items-center pt-20 pb-16 gap-12 text-center">
                    {/* Badge */}
                    <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider animate-pulse">
                        <Zap className="w-3 h-3" fill="currentColor" />
                        AI-Powered Viral Engine
                    </div>

                    {/* Headline */}
                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] max-w-4xl mx-auto">
                        Turn Long Videos Into <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                            Viral Clips Instantly
                        </span>
                    </h1>

                    <p className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
                        Upload your footage and let the AI agent handle the heavy lifting — silence removal, filler words, smart cuts, and viral hooks.
                    </p>

                    {/* CTA */}
                    <button
                        onClick={() => navigate('/editor')}
                        className="glass-button px-8 py-4 rounded-2xl text-lg font-bold flex items-center gap-3 mt-4"
                    >
                        <VibedLogoIcon size={20} />
                        Start Editing Free
                    </button>

                    {/* Feature Pills */}
                    <div className="flex flex-wrap justify-center gap-3 mt-4 max-w-xl">
                        <FeaturePill icon={Scissors} label="Auto-Cuts" />
                        <FeaturePill icon={Volume2} label="Silence Removal" />
                        <FeaturePill icon={Layers} label="Pro Timeline" />
                        <FeaturePill icon={Wand2} label="Virality AI" />
                    </div>

                    {/* ── EDITOR MOCKUP ── */}
                    <div className="w-full mt-16 relative">
                        {/* Huge glow behind mockup */}
                        <div className="absolute inset-0 bg-primary/15 blur-[100px] rounded-full scale-90" />
                        
                        <div className="relative glass-panel rounded-2xl overflow-hidden border border-primary/20 shadow-2xl">
                            {/* Window Header */}
                            <div className="h-12 bg-secondary border-b border-primary/20 flex items-center px-4 gap-2">
                                <div className="flex gap-2">
                                    <div className="w-3 h-3 rounded-full bg-destructive/80"></div>
                                    <div className="w-3 h-3 rounded-full bg-accent/80"></div>
                                    <div className="w-3 h-3 rounded-full bg-primary/80"></div>
                                </div>
                                <div className="mx-auto flex gap-4">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Project Assets</span>
                                    <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Timeline</span>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Export</span>
                                </div>
                            </div>
                            
                            {/* Window Body (Mockup content) */}
                            <div className="h-[400px] md:h-[600px] bg-background/90 flex flex-col relative">
                                {/* Preview pane */}
                                <div className="flex-1 flex items-center justify-center border-b border-primary/10">
                                    <div className="w-full h-full max-w-4xl max-h-[80%] mx-auto bg-card rounded-lg border border-white/5 flex items-center justify-center overflow-hidden relative shadow-lg">
                                        <Video className="w-16 h-16 text-primary/20" />
                                        <div className="absolute bottom-4 left-4 flex gap-2">
                                            <div className="bg-primary/20 backdrop-blur-md border border-primary/30 text-primary text-xs font-bold px-3 py-1 rounded-md">
                                                AI Cut: High Energy
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {/* Timeline pane */}
                                <div className="h-48 bg-secondary/50 p-4 flex flex-col gap-2">
                                    <div className="w-full h-6 bg-card rounded border border-white/5 relative overflow-hidden">
                                        <div className="absolute left-10 w-32 h-full bg-primary/30 border-l-2 border-primary" />
                                        <div className="absolute left-48 w-64 h-full bg-primary/30 border-l-2 border-primary" />
                                    </div>
                                    <div className="w-full h-8 bg-card rounded border border-white/5 relative overflow-hidden flex items-center px-2">
                                         <div className="absolute left-10 w-32 h-6 bg-accent/20 rounded-sm border border-accent/40" />
                                         <div className="absolute left-48 w-64 h-6 bg-accent/20 rounded-sm border border-accent/40" />
                                    </div>
                                    <div className="w-full h-8 bg-card rounded border border-white/5 relative overflow-hidden flex items-center px-2">
                                         <div className="absolute left-10 w-[400px] h-4 bg-muted rounded-sm" />
                                    </div>
                                    <div className="absolute bottom-0 left-1/3 w-0.5 h-full bg-destructive shadow-[0_0_10px_red]" />
                                </div>
                            </div>
                        </div>
                    </div>
                </main>

                {/* ── STATS ── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-12 mb-12 border-t border-white/5">
                    <StatBox value="10×" label="Faster Editing" />
                    <StatBox value="AI" label="Copilot" />
                    <StatBox value="100%" label="Privacy First" />
                    <StatBox value="NLE" label="Export Ready" />
                </div>

                {/* ── FOOTER ── */}
                <footer className="py-6 flex flex-col sm:flex-row items-center justify-between border-t border-white/5 gap-4">
                    <div className="flex items-center gap-2 text-primary">
                        <VibedLogoIcon size={20} />
                        <span className="text-sm font-bold">Vibed</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-medium tracking-wide">
                        The ultimate AI video editing platform. © 2026
                    </span>
                </footer>
            </div>
        </div>
    );
};

export default HomePage;
