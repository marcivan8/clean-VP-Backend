import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Wand2, Zap, ChevronRight, Scissors, Mic, Volume2, Layers } from 'lucide-react';
import { motion, useScroll, useTransform } from 'framer-motion';

/* ─── Vibed SVG Logo ─── */
const VibedLogoIcon = ({ size = 40, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z" fill="none" stroke="currentColor" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round" />
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
        <span className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">{value}</span>
        <span className="text-[10px] md:text-xs text-muted-foreground font-semibold uppercase tracking-widest text-center">{label}</span>
    </div>
);

const HomePage = () => {
    const navigate = useNavigate();
    const [mounted, setMounted] = useState(false);
    
    // Framer Motion Scroll Hooks
    const { scrollYProgress } = useScroll();
    
    // Create immersive color transitions based on scroll position
    // Glow 1: Top Left
    const glow1Color = useTransform(scrollYProgress, 
        [0, 0.3, 0.6, 1], 
        ["rgba(100, 50, 255, 0.15)", "rgba(0, 255, 255, 0.15)", "rgba(255, 0, 255, 0.15)", "rgba(255, 100, 0, 0.15)"]
    );
    // Glow 2: Bottom Right
    const glow2Color = useTransform(scrollYProgress, 
        [0, 0.3, 0.6, 1], 
        ["rgba(0, 150, 255, 0.1)", "rgba(100, 50, 255, 0.15)", "rgba(0, 255, 255, 0.15)", "rgba(255, 0, 0, 0.15)"]
    );
    // Glow 3: Center Right
    const glow3Color = useTransform(scrollYProgress, 
        [0, 0.3, 0.6, 1], 
        ["rgba(255, 0, 100, 0.05)", "rgba(255, 150, 0, 0.1)", "rgba(100, 50, 255, 0.1)", "rgba(255, 0, 255, 0.1)"]
    );

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 50);
        return () => clearTimeout(t);
    }, []);

    return (
        <div className="min-h-screen bg-background text-foreground overflow-x-hidden font-sans relative selection:bg-primary/30">
            {/* ── Background Glows (Scroll-driven) ── */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
                <motion.div style={{ backgroundColor: glow1Color }} className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full blur-[150px] transition-colors duration-300" />
                <motion.div style={{ backgroundColor: glow2Color }} className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full blur-[150px] transition-colors duration-300" />
                <motion.div style={{ backgroundColor: glow3Color }} className="absolute top-[40%] right-[10%] w-[30vw] h-[30vw] rounded-full blur-[150px] transition-colors duration-300" />
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
                            className="glass-button-pro px-6 py-2.5 text-sm font-bold flex items-center gap-2 group"
                        >
                            Open Editor
                            <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </nav>

                {/* ── HERO ── */}
                <main className="flex-1 flex flex-col items-center pt-20 pb-16 gap-12 text-center">
                    {/* Badge */}
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }} 
                        animate={{ opacity: 1, scale: 1 }} 
                        transition={{ delay: 0.2 }}
                        className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider animate-pulse"
                    >
                        <Zap className="w-3 h-3" fill="currentColor" />
                        AI-Powered Viral Engine
                    </motion.div>

                    {/* Headline */}
                    <motion.h1 
                        initial={{ opacity: 0, y: 20 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        transition={{ delay: 0.3 }}
                        className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] max-w-4xl mx-auto"
                    >
                        Turn Long Videos Into <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                            Viral Clips Instantly
                        </span>
                    </motion.h1>

                    <motion.p 
                        initial={{ opacity: 0, y: 20 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        transition={{ delay: 0.4 }}
                        className="text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed"
                    >
                        Upload your footage and let the AI agent handle the heavy lifting — silence removal, filler words, smart cuts, and viral hooks.
                    </motion.p>

                    {/* CTA */}
                    <motion.button
                        initial={{ opacity: 0, y: 20 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        transition={{ delay: 0.5 }}
                        onClick={() => navigate('/editor')}
                        className="glass-button-pro px-8 py-4 text-lg font-bold flex items-center gap-3 mt-4"
                    >
                        <VibedLogoIcon size={20} />
                        Start Editing Free
                    </motion.button>

                    {/* Feature Pills */}
                    <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        transition={{ delay: 0.6 }}
                        className="flex flex-wrap justify-center gap-3 mt-4 max-w-xl"
                    >
                        <FeaturePill icon={Scissors} label="Auto-Cuts" />
                        <FeaturePill icon={Volume2} label="Silence Removal" />
                        <FeaturePill icon={Layers} label="Pro Timeline" />
                        <FeaturePill icon={Wand2} label="Virality AI" />
                    </motion.div>

                    {/* ── EDITOR MOCKUP ── */}
                    <motion.div 
                        initial={{ opacity: 0, y: 50 }} 
                        whileInView={{ opacity: 1, y: 0 }} 
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="w-full mt-16 relative"
                    >
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
                    </motion.div>
                </main>

                {/* ── SECTION 1: Vibe Editing ── */}
                <motion.section 
                    initial={{ opacity: 0, y: 50 }} 
                    whileInView={{ opacity: 1, y: 0 }} 
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="flex flex-col md:flex-row items-center gap-12 py-24 border-t border-white/5"
                >
                    <div className="flex-1 space-y-6 text-left">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider">
                            <Wand2 className="w-3 h-3" /> Conversational AI
                        </div>
                        <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                            Edit to your <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">vibe.</span>
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                            Stop clicking and start talking. Just tell the AI what you want: "Remove all the filler words", "Make it punchier", or "Find the best 60-second hook". Vibed understands your intent and generates the perfect edit instantly.
                        </p>
                    </div>
                    <div className="flex-1 relative w-full h-[400px] flex items-center justify-center">
                        <div className="absolute inset-0 bg-primary/20 blur-[80px] rounded-full scale-75 z-0" />
                        
                        {/* Background Image */}
                        <div className="absolute inset-0 z-10 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                            <div className="absolute inset-0 bg-gradient-to-br from-background/90 via-background/60 to-primary/20 z-10 mix-blend-multiply" />
                            <img 
                                src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop" 
                                alt="Abstract neon waveform" 
                                className="w-full h-full object-cover opacity-60"
                            />
                        </div>

                        {/* Foreground UI Overlay */}
                        <div className="glass-panel p-6 rounded-2xl relative z-20 space-y-4 w-[90%] max-w-md shadow-2xl border-white/20">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-white/5"><span className="text-xs font-bold">U</span></div>
                                <div className="bg-card px-4 py-3 rounded-2xl rounded-tl-sm text-sm border border-white/5 shadow-md">Please remove all the silent parts and umms.</div>
                            </div>
                            <div className="flex items-start gap-3 flex-row-reverse">
                                <div className="w-8 h-8 rounded-full bg-accent/20 text-accent border border-accent/20 flex items-center justify-center shrink-0"><VibedLogoIcon size={16} /></div>
                                <div className="bg-primary/20 border border-primary/30 px-4 py-3 rounded-2xl rounded-tr-sm text-sm shadow-md text-primary-foreground backdrop-blur-md">
                                    Done! I removed 42 seconds of silence and 14 filler words.
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-white/5"><span className="text-xs font-bold">U</span></div>
                                <div className="bg-card px-4 py-3 rounded-2xl rounded-tl-sm text-sm border border-white/5 shadow-md">Export it for Premiere.</div>
                            </div>
                        </div>
                    </div>
                </motion.section>

                {/* ── SECTION 2: Massive Time Savings ── */}
                <motion.section 
                    initial={{ opacity: 0, y: 50 }} 
                    whileInView={{ opacity: 1, y: 0 }} 
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="flex flex-col md:flex-row-reverse items-center gap-12 py-24 border-t border-white/5"
                >
                    <div className="flex-1 space-y-6 text-left md:pl-12">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-bold uppercase tracking-wider">
                            <Zap className="w-3 h-3" /> Turbocharge Workflow
                        </div>
                        <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                            Save hours on <br/>
                            <span className="text-white">long-form video.</span>
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                            Podcasts, interviews, and streams take forever to scrub through. Vibed automatically analyzes your entire timeline, detecting silence, dead air, and boring segments, condensing a 2-hour recording into a punchy cut in seconds.
                        </p>
                    </div>
                    <div className="flex-1 relative w-full h-[400px] flex items-center justify-center md:justify-start">
                        <div className="absolute inset-0 bg-accent/20 blur-[80px] rounded-full scale-75 z-0" />
                        
                        {/* Background Image */}
                        <div className="absolute inset-0 z-10 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                            <div className="absolute inset-0 bg-gradient-to-bl from-background/90 via-background/70 to-accent/20 z-10 mix-blend-overlay" />
                            <img 
                                src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=1000&auto=format&fit=crop" 
                                alt="High speed light trails" 
                                className="w-full h-full object-cover opacity-40 grayscale-[20%]"
                            />
                        </div>

                        {/* Foreground UI Overlay */}
                        <div className="relative w-full max-w-sm z-20 md:ml-8">
                            <div className="glass-panel p-10 rounded-3xl relative flex flex-col items-center gap-6 border-accent/30 shadow-2xl text-center">
                                <div>
                                    <div className="text-5xl font-extrabold text-white tracking-tighter">02:14:00</div>
                                    <div className="text-xs text-muted-foreground uppercase tracking-widest font-bold mt-2">Original Footage</div>
                                </div>
                                
                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                    <div className="w-0.5 h-6 bg-gradient-to-b from-white/20 to-transparent rounded-full" />
                                    <Scissors className="w-5 h-5 text-accent opacity-80" />
                                    <div className="w-0.5 h-6 bg-gradient-to-t from-accent/50 to-transparent rounded-full" />
                                </div>

                                <div>
                                    <div className="text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-accent to-primary flex items-center justify-center gap-2 tracking-tighter drop-shadow-2xl">
                                        <Zap className="w-8 h-8 text-accent" fill="currentColor" /> 00:15:30
                                    </div>
                                    <div className="text-xs text-accent uppercase tracking-widest font-bold mt-2">Viral Cut Ready</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.section>

                {/* ── SECTION 3: Pro NLE Export ── */}
                <motion.section 
                    initial={{ opacity: 0, y: 50 }} 
                    whileInView={{ opacity: 1, y: 0 }} 
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="flex flex-col md:flex-row items-center gap-12 py-24 border-t border-white/5"
                >
                    <div className="flex-1 space-y-6 text-left">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs font-bold uppercase tracking-wider">
                            <Layers className="w-3 h-3" /> Pro Ecosystem
                        </div>
                        <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                            Finish in your <br/>
                            <span className="text-white">favorite software.</span>
                        </h2>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                            Vibed isn't a walled garden. We focus on the heavy lifting of cutting and rough assembly. Once the AI finishes, export a frame-accurate XML or OTIO file directly to Premiere Pro, Final Cut Pro, or DaVinci Resolve to finish your masterpiece.
                        </p>
                    </div>
                    <div className="flex-1 relative w-full h-[400px] flex items-center justify-center md:justify-end">
                        <div className="absolute inset-0 bg-destructive/20 blur-[80px] rounded-full scale-75 z-0" />
                        
                        {/* Background Image */}
                        <div className="absolute inset-0 z-10 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-destructive/20 z-10 mix-blend-overlay" />
                            <img 
                                src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=1000&auto=format&fit=crop" 
                                alt="Cyber workstation grid" 
                                className="w-full h-full object-cover opacity-40 grayscale-[50%]"
                            />
                        </div>

                        {/* Foreground UI Overlay */}
                        <div className="relative w-full max-w-md z-20 md:mr-8">
                            <div className="glass-panel p-8 rounded-3xl relative flex flex-col gap-8 items-center border border-white/20 shadow-2xl backdrop-blur-2xl bg-card/60">
                                <div className="w-full flex justify-around items-center px-2">
                                    <div className="w-20 h-20 rounded-3xl bg-[#00003b] border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-2xl shadow-[0_0_30px_rgba(0,0,255,0.2)]">Pr</div>
                                    <div className="w-20 h-20 rounded-3xl bg-black border border-gray-600 flex items-center justify-center text-white font-bold text-2xl shadow-[0_0_30px_rgba(255,255,255,0.1)]">FCP</div>
                                    <div className="w-20 h-20 rounded-3xl bg-[#1a0f00] border border-orange-500/30 flex items-center justify-center text-orange-400 font-bold text-2xl shadow-[0_0_30px_rgba(255,100,0,0.2)]">Da</div>
                                </div>
                                <div className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                                <button className="glass-button-pro w-full py-5 text-sm font-bold tracking-wider uppercase flex justify-center items-center gap-2 group">
                                    Export OTIO / XML
                                    <ChevronRight className="w-4 h-4 text-white/50 group-hover:text-white transition-colors transform group-hover:translate-x-1" />
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.section>

                {/* ── STATS ── */}
                <motion.div 
                    initial={{ opacity: 0, y: 50 }} 
                    whileInView={{ opacity: 1, y: 0 }} 
                    viewport={{ once: true, margin: "-100px" }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="grid grid-cols-2 md:grid-cols-4 gap-8 py-16 mt-12 border-t border-white/5"
                >
                    <StatBox value="10×" label="Faster Editing" />
                    <StatBox value="AI" label="Copilot" />
                    <StatBox value="100%" label="Privacy First" />
                    <StatBox value="NLE" label="Export Ready" />
                </motion.div>

                {/* ── FOOTER ── */}
                <footer className="py-8 flex flex-col sm:flex-row items-center justify-between border-t border-white/5 gap-4">
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
