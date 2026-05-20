import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Wand2, Zap, ChevronRight, Scissors, Mic, Volume2, Layers } from 'lucide-react';

/* ─── Vibed SVG Logo ─── */
const VibedLogoIcon = ({ size = 40, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z" fill="none" stroke="currentColor" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="248" y1="248" x2="195" y2="268" stroke="currentColor" strokeWidth="12" strokeLinecap="round" className="text-accent" />
    </svg>
);

const FeaturePill = ({ icon: Icon, label }) => (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-muted-foreground font-medium shadow-sm">
        <Icon className="w-3 h-3 text-primary" />
        {label}
    </div>
);

const StatBox = ({ value, label }) => (
    <div className="flex flex-col items-center gap-1">
        <span className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">{value}</span>
        <span className="text-[10px] md:text-xs text-muted-foreground font-semibold uppercase tracking-widest text-center">{label}</span>
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
        <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans relative selection:bg-primary/20 selection:text-primary-foreground">
            {/* ── Background (Clean Linear/Vercel Style) ── */}
            <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-100 via-background to-background" />

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
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white shadow-sm border border-gray-200 text-primary">
                            <VibedLogoIcon size={24} />
                        </div>
                        <span className="text-xl font-extrabold tracking-tight text-foreground">Vibed</span>
                    </div>

                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => navigate('/editor')}
                            className="glass-button-pro px-6 py-2.5 text-sm font-bold flex items-center gap-2 group"
                        >
                            Open Editor
                            <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </nav>

                {/* ── HERO ── */}
                <main className="flex-1 flex flex-col items-center pt-24 pb-16 gap-8 text-center">
                    {/* Headline */}
                    <h1 className="text-6xl md:text-8xl font-extrabold tracking-tighter leading-[1.05] max-w-4xl mx-auto text-foreground">
                        Stop editing. <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                            Start creating.
                        </span>
                    </h1>

                    <p className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed mt-4">
                        Upload your footage and let the AI agent handle the heavy lifting — silence removal, filler words, smart cuts automatically, the moment you ask.
                    </p>

                    {/* CTA */}
                    <div className="flex flex-col sm:flex-row items-center gap-4 mt-8">
                        <button
                            onClick={() => navigate('/editor')}
                            className="glass-button-pro px-8 py-4 text-lg font-bold flex items-center gap-3"
                        >
                            <VibedLogoIcon size={20} />
                            Start Editing Free
                        </button>
                    </div>

                    {/* Feature Pills */}
                    <div className="flex flex-wrap justify-center gap-3 mt-8 max-w-xl">
                        <FeaturePill icon={Scissors} label="Auto-Cuts" />
                        <FeaturePill icon={Volume2} label="Silence Removal" />
                        <FeaturePill icon={Layers} label="Pro Timeline" />
                        <FeaturePill icon={Wand2} label="Virality AI" />
                    </div>

                    {/* ── EDITOR MOCKUP (Light Theme) ── */}
                    <div className="w-full mt-20 relative">
                        {/* Soft shadow instead of glow */}
                        <div className="absolute inset-20 bg-primary/5 blur-[100px] rounded-full scale-110" />
                        
                        <div className="relative bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-[0_20px_50px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
                            {/* Window Header */}
                            <div className="h-12 bg-gray-50 border-b border-gray-200 flex items-center px-4 gap-2">
                                <div className="flex gap-2">
                                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                </div>
                                <div className="mx-auto flex gap-6">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Project Assets</span>
                                    <span className="text-[10px] font-bold text-primary uppercase tracking-widest bg-primary/10 px-2 py-0.5 rounded-full">Timeline</span>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Export</span>
                                </div>
                            </div>
                            
                            {/* Window Body (Mockup content) */}
                            <div className="h-[400px] md:h-[600px] bg-background flex flex-col relative">
                                {/* Preview pane */}
                                <div className="flex-1 flex items-center justify-center border-b border-gray-200 bg-gray-50">
                                    <div className="w-full h-full max-w-4xl max-h-[80%] mx-auto bg-black rounded-lg border border-gray-300 flex items-center justify-center overflow-hidden relative shadow-xl">
                                        <Video className="w-16 h-16 text-white/20" />
                                        <div className="absolute bottom-4 left-4 flex gap-2">
                                            <div className="bg-black/50 backdrop-blur-md border border-white/10 text-white text-xs font-bold px-3 py-1 rounded-md">
                                                AI Cut: High Energy
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {/* Timeline pane */}
                                <div className="h-48 bg-white p-4 flex flex-col gap-2 relative">
                                    <div className="w-full h-6 bg-gray-100 rounded border border-gray-200 relative overflow-hidden">
                                        <div className="absolute left-10 w-32 h-full bg-primary/20 border-l-2 border-primary" />
                                        <div className="absolute left-48 w-64 h-full bg-primary/20 border-l-2 border-primary" />
                                    </div>
                                    <div className="w-full h-8 bg-gray-100 rounded border border-gray-200 relative overflow-hidden flex items-center px-2">
                                         <div className="absolute left-10 w-32 h-6 bg-accent/20 rounded-sm border border-accent/40" />
                                         <div className="absolute left-48 w-64 h-6 bg-accent/20 rounded-sm border border-accent/40" />
                                    </div>
                                    <div className="absolute bottom-0 left-1/3 w-px h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] z-10" />
                                </div>
                            </div>
                        </div>
                    </div>
                </main>

                {/* ── SECTION 1: Vibe Editing ── */}
                <section className="flex flex-col md:flex-row items-center gap-12 py-24 border-t border-gray-200 mt-12">
                    <div className="flex-1 space-y-6 text-left">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider">
                            <Wand2 className="w-3 h-3" /> Conversational AI
                        </div>
                        <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] text-foreground">
                            Edit to your <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">vibe.</span>
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                            Stop clicking and start talking. Just tell the AI what you want: "Remove all the filler words", "Make it punchier", or "Find the best 60-second hook". Vibed understands your intent and generates the perfect edit instantly.
                        </p>
                    </div>
                    <div className="flex-1 relative w-full h-[400px] flex items-center justify-center">
                        {/* Background Image (Light, abstract) */}
                        <div className="absolute inset-0 z-10 rounded-3xl overflow-hidden border border-gray-200 shadow-xl bg-white">
                            <img 
                                src="https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1000&auto=format&fit=crop" 
                                alt="Abstract light shapes" 
                                className="w-full h-full object-cover opacity-60"
                            />
                        </div>

                        {/* Foreground UI Overlay */}
                        <div className="bg-white/80 backdrop-blur-xl p-6 rounded-2xl relative z-20 space-y-4 w-[90%] max-w-md shadow-2xl border border-white">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200"><span className="text-xs font-bold text-gray-500">U</span></div>
                                <div className="bg-gray-50 px-4 py-3 rounded-2xl rounded-tl-sm text-sm border border-gray-100 shadow-sm text-foreground">Please remove all the silent parts and umms.</div>
                            </div>
                            <div className="flex items-start gap-3 flex-row-reverse">
                                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0"><VibedLogoIcon size={16} /></div>
                                <div className="bg-primary text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm shadow-md font-medium">
                                    Done! I removed 42 seconds of silence and 14 filler words.
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── SECTION 2: Massive Time Savings ── */}
                <section className="flex flex-col md:flex-row-reverse items-center gap-12 py-24 border-t border-gray-200">
                    <div className="flex-1 space-y-6 text-left md:pl-12">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-bold uppercase tracking-wider">
                            <Zap className="w-3 h-3" /> Turbocharge Workflow
                        </div>
                        <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] text-foreground">
                            Save hours on <br/>
                            long-form video.
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                            Podcasts, interviews, and streams take forever to scrub through. Vibed automatically analyzes your entire timeline, detecting silence, dead air, and boring segments, condensing a 2-hour recording into a punchy cut in seconds.
                        </p>
                    </div>
                    <div className="flex-1 relative w-full h-[400px] flex items-center justify-center md:justify-start">
                        {/* Background Image (Light blur/motion) */}
                        <div className="absolute inset-0 z-10 rounded-3xl overflow-hidden border border-gray-200 shadow-xl bg-white">
                            <img 
                                src="https://images.unsplash.com/photo-1522204523234-8729aa6e3d5f?q=80&w=1000&auto=format&fit=crop" 
                                alt="High speed light trails" 
                                className="w-full h-full object-cover opacity-20 grayscale"
                            />
                        </div>

                        {/* Foreground UI Overlay */}
                        <div className="relative w-full max-w-sm z-20 md:ml-8">
                            <div className="bg-white/90 backdrop-blur-xl p-10 rounded-3xl relative flex flex-col items-center gap-6 border border-white shadow-2xl text-center">
                                <div>
                                    <div className="text-5xl font-extrabold text-gray-800 tracking-tighter">02:14:00</div>
                                    <div className="text-xs text-muted-foreground uppercase tracking-widest font-bold mt-2">Original Footage</div>
                                </div>
                                
                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                    <div className="w-px h-6 bg-gradient-to-b from-gray-300 to-transparent rounded-full" />
                                    <Scissors className="w-5 h-5 text-accent opacity-80" />
                                    <div className="w-px h-6 bg-gradient-to-t from-accent/50 to-transparent rounded-full" />
                                </div>

                                <div>
                                    <div className="text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-primary to-accent flex items-center justify-center gap-2 tracking-tighter drop-shadow-sm">
                                        <Zap className="w-8 h-8 text-accent" fill="currentColor" /> 00:15:30
                                    </div>
                                    <div className="text-xs text-accent uppercase tracking-widest font-bold mt-2">Viral Cut Ready</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── SECTION 3: Pro NLE Export ── */}
                <section className="flex flex-col md:flex-row items-center gap-12 py-24 border-t border-gray-200">
                    <div className="flex-1 space-y-6 text-left">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-600 text-xs font-bold uppercase tracking-wider">
                            <Layers className="w-3 h-3" /> Pro Ecosystem
                        </div>
                        <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] text-foreground">
                            Finish in your <br/>
                            favorite software.
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                            Vibed isn't a walled garden. We focus on the heavy lifting of cutting and rough assembly. Once the AI finishes, export a frame-accurate XML or OTIO file directly to Premiere Pro, Final Cut Pro, or DaVinci Resolve to finish your masterpiece.
                        </p>
                    </div>
                    <div className="flex-1 relative w-full h-[400px] flex items-center justify-center md:justify-end">
                        {/* Background Image (Clean workspace) */}
                        <div className="absolute inset-0 z-10 rounded-3xl overflow-hidden border border-gray-200 shadow-xl bg-white">
                            <img 
                                src="https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1000&auto=format&fit=crop" 
                                alt="Clean desk setup" 
                                className="w-full h-full object-cover opacity-30 grayscale"
                            />
                        </div>

                        {/* Foreground UI Overlay */}
                        <div className="relative w-full max-w-md z-20 md:mr-8">
                            <div className="bg-white/90 backdrop-blur-2xl p-8 rounded-3xl relative flex flex-col gap-8 items-center border border-white shadow-2xl">
                                <div className="w-full flex justify-around items-center px-2">
                                    <div className="w-20 h-20 rounded-3xl bg-[#00003b] flex items-center justify-center text-blue-400 font-bold text-2xl shadow-lg border border-[#00003b]">Pr</div>
                                    <div className="w-20 h-20 rounded-3xl bg-black flex items-center justify-center text-white font-bold text-2xl shadow-lg border border-black">FCP</div>
                                    <div className="w-20 h-20 rounded-3xl bg-[#1a0f00] flex items-center justify-center text-orange-400 font-bold text-2xl shadow-lg border border-[#1a0f00]">Da</div>
                                </div>
                                <div className="w-full h-px bg-gray-200" />
                                <button className="glass-button-pro w-full py-4 text-sm font-bold tracking-wider uppercase flex justify-center items-center gap-2 group shadow-xl">
                                    Export OTIO / XML
                                    <ChevronRight className="w-4 h-4 text-white/70 group-hover:text-white transition-colors transform group-hover:translate-x-1" />
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── STATS ── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-16 mt-12 border-t border-gray-200">
                    <StatBox value="10×" label="Faster Editing" />
                    <StatBox value="AI" label="Copilot" />
                    <StatBox value="100%" label="Privacy First" />
                    <StatBox value="NLE" label="Export Ready" />
                </div>

                {/* ── FOOTER ── */}
                <footer className="py-8 flex flex-col sm:flex-row items-center justify-between border-t border-gray-200 gap-4">
                    <div className="flex items-center gap-2 text-primary">
                        <VibedLogoIcon size={20} />
                        <span className="text-sm font-bold text-foreground">Vibed</span>
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
