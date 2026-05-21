import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Wand2, Scissors, Layers, ChevronRight, Play, MessageSquare, SlidersHorizontal, Share2, Sparkles, Video, AlignLeft, CheckCircle2 } from 'lucide-react';

/* ─── Vibed SVG Logo ─── */
const VibedLogoIcon = ({ size = 40, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z" fill="none" stroke="currentColor" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="248" y1="248" x2="195" y2="268" stroke="currentColor" strokeWidth="12" strokeLinecap="round" className="text-accent" />
    </svg>
);

const FadeIn = ({ children, delay = 0, className = '' }) => (
    <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay }}
        className={className}
    >
        {children}
    </motion.div>
);

const HomePage = () => {
    const navigate = useNavigate();
    const [mounted, setMounted] = useState(false);
    
    // Calm, cinematic scroll-driven color shifts
    const { scrollYProgress } = useScroll();
    
    const bgGlow1 = useTransform(scrollYProgress, 
        [0, 0.5, 1], 
        ["rgba(80, 70, 150, 0.08)", "rgba(100, 90, 180, 0.05)", "rgba(60, 50, 120, 0.08)"]
    );
    const bgGlow2 = useTransform(scrollYProgress, 
        [0, 0.5, 1], 
        ["rgba(100, 110, 180, 0.05)", "rgba(80, 70, 150, 0.08)", "rgba(100, 110, 180, 0.05)"]
    );

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div className="min-h-screen bg-background text-foreground overflow-x-hidden relative selection:bg-primary/30 selection:text-white">
            
            {/* ── Subtle Cinematic Background Glows ── */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
                <motion.div style={{ backgroundColor: bgGlow1 }} className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full blur-[120px] transition-colors duration-1000" />
                <motion.div style={{ backgroundColor: bgGlow2 }} className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full blur-[120px] transition-colors duration-1000" />
            </div>

            <div
                className="relative z-10 max-w-7xl mx-auto px-6 lg:px-12 flex flex-col min-h-screen"
                style={{
                    opacity: mounted ? 1 : 0,
                    transition: 'opacity 1s ease-in-out',
                }}
            >
                {/* ── NAV ── */}
                <nav className="flex items-center justify-between py-8">
                    <div className="flex items-center gap-3">
                        <VibedLogoIcon size={28} className="text-foreground" />
                        <span className="text-xl font-bold tracking-tight">Vibed</span>
                    </div>

                    <div className="flex items-center gap-6">
                        <button className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
                            Methodology
                        </button>
                        <button className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
                            For Professionals
                        </button>
                        <button
                            onClick={() => navigate('/editor')}
                            className="glass-button-pro px-6 py-2.5 text-sm flex items-center gap-2"
                        >
                            Open Editor
                        </button>
                    </div>
                </nav>

                {/* ── 1. HERO SECTION ── */}
                <main className="flex-1 flex flex-col items-center justify-center pt-24 pb-32 text-center min-h-[80vh]">
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground text-xs font-medium tracking-wide mb-8"
                    >
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        The creative operating system for modern storytellers
                    </motion.div>

                    <motion.h1 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                        className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tighter leading-[1.05] max-w-5xl mx-auto"
                    >
                        Create at the speed <br className="hidden sm:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-white/40">
                            of thought.
                        </span>
                    </motion.h1>

                    <motion.p 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed mt-8 font-light"
                    >
                        Vibed helps creators edit, organize, optimize, and publish content faster using conversational AI and professional creative workflows.
                    </motion.p>

                    <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="flex flex-col sm:flex-row items-center gap-4 mt-12"
                    >
                        <button
                            onClick={() => navigate('/editor')}
                            className="glass-button-pro px-8 py-4 text-base flex items-center gap-2"
                        >
                            Start Creating <ChevronRight className="w-4 h-4" />
                        </button>
                        <button className="glass-button px-8 py-4 text-base rounded-full flex items-center gap-2 font-medium">
                            <Play className="w-4 h-4" /> Watch Demo
                        </button>
                    </motion.div>

                    <motion.p 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1, delay: 0.8 }}
                        className="text-xs text-muted-foreground/60 mt-12 tracking-widest uppercase font-medium"
                    >
                        Built for creators, editors, storytellers, and modern media teams.
                    </motion.p>
                </main>

                {/* ── 2. VALUE PROPOSITION SECTION ── */}
                <section className="py-32 border-t border-white/5">
                    <FadeIn>
                        <div className="text-center mb-16">
                            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">AI that works with your creativity.</h2>
                            <p className="text-muted-foreground mt-4 max-w-2xl mx-auto text-lg">We believe AI should amplify human creativity, not replace it. Vibed integrates seamlessly into professional pipelines to accelerate your process.</p>
                        </div>
                    </FadeIn>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <FadeIn delay={0.1} className="glass-panel p-8 rounded-3xl flex flex-col gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                                <MessageSquare className="w-5 h-5 text-primary" />
                            </div>
                            <h3 className="text-xl font-semibold">Conversational Editing</h3>
                            <p className="text-muted-foreground text-sm leading-relaxed">Describe the edit you want in natural language. Vibed translates your intent into precise timeline actions.</p>
                        </FadeIn>
                        <FadeIn delay={0.2} className="glass-panel p-8 rounded-3xl flex flex-col gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                                <SlidersHorizontal className="w-5 h-5 text-primary" />
                            </div>
                            <h3 className="text-xl font-semibold">Creative Control</h3>
                            <p className="text-muted-foreground text-sm leading-relaxed">AI suggests. You decide. Every automated cut or edit is completely non-destructive and adjustable on the timeline.</p>
                        </FadeIn>
                        <FadeIn delay={0.3} className="glass-panel p-8 rounded-3xl flex flex-col gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                                <Layers className="w-5 h-5 text-primary" />
                            </div>
                            <h3 className="text-xl font-semibold">Professional Export</h3>
                            <p className="text-muted-foreground text-sm leading-relaxed">Don't feel trapped. Export frame-accurate XMLs directly to Premiere Pro, DaVinci Resolve, or Final Cut.</p>
                        </FadeIn>
                    </div>
                </section>

                {/* ── 3. CONVERSATIONAL EDITING SECTION ── */}
                <section className="py-32 border-t border-white/5 flex flex-col lg:flex-row items-center gap-16">
                    <div className="flex-1 space-y-8">
                        <FadeIn>
                            <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]">
                                Edit videos like you’re talking to an assistant.
                            </h2>
                        </FadeIn>
                        <FadeIn delay={0.1}>
                            <p className="text-lg text-muted-foreground leading-relaxed max-w-lg">
                                Use natural language to accelerate editing while keeping complete creative control. Whether it's "Make this intro more cinematic" or "Cut pauses after 2 seconds", Vibed understands your creative intent.
                            </p>
                        </FadeIn>
                        <FadeIn delay={0.2}>
                            <ul className="space-y-4 text-sm text-muted-foreground font-medium">
                                <li className="flex items-center gap-3"><CheckCircle2 className="w-4 h-4 text-primary" /> Remove silences and filler words instantly.</li>
                                <li className="flex items-center gap-3"><CheckCircle2 className="w-4 h-4 text-primary" /> Auto-generate perfectly timed B-roll suggestions.</li>
                                <li className="flex items-center gap-3"><CheckCircle2 className="w-4 h-4 text-primary" /> Adjust pacing and emotional emphasis.</li>
                            </ul>
                        </FadeIn>
                    </div>

                    <div className="flex-1 w-full relative">
                        <FadeIn delay={0.3} className="glass-panel rounded-3xl overflow-hidden shadow-2xl relative border-white/10">
                            {/* Mockup Header */}
                            <div className="h-10 border-b border-white/5 flex items-center px-4 gap-2 bg-white/5">
                                <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                                <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                                <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                            </div>
                            
                            {/* Mockup Body */}
                            <div className="p-6 bg-background/50 h-[350px] flex flex-col justify-between">
                                <div className="space-y-6">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/5"><span className="text-xs font-medium">U</span></div>
                                        <div className="glass-panel px-4 py-3 rounded-2xl rounded-tl-sm text-sm border-white/5">
                                            Make this intro more cinematic and cut the dead air.
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-4 flex-row-reverse">
                                        <div className="w-8 h-8 rounded-full bg-primary/20 text-primary border border-primary/20 flex items-center justify-center shrink-0"><VibedLogoIcon size={16} /></div>
                                        <div className="bg-primary/10 border border-primary/20 px-4 py-3 rounded-2xl rounded-tr-sm text-sm text-primary-foreground shadow-lg backdrop-blur-md">
                                            <p className="mb-2">Done. I've applied the following edits:</p>
                                            <ul className="space-y-1 text-xs text-white/80 list-disc pl-4">
                                                <li>Removed 12 seconds of dead air.</li>
                                                <li>Added a subtle cinematic color grade.</li>
                                                <li>Slowed the first clip to 80% speed.</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>

                                {/* Timeline Visualizer */}
                                <div className="h-16 mt-4 border border-white/5 rounded-xl bg-black/40 flex items-center px-2 gap-1 overflow-hidden relative">
                                    <div className="h-8 w-1/4 bg-white/10 rounded-md border border-white/5" />
                                    <div className="h-8 w-1/12 bg-primary/20 rounded-md border border-primary/30" />
                                    <div className="h-8 w-1/3 bg-white/10 rounded-md border border-white/5" />
                                    <div className="absolute left-1/3 top-0 bottom-0 w-px bg-primary shadow-[0_0_10px_rgba(100,50,255,1)] z-10" />
                                </div>
                            </div>
                        </FadeIn>
                    </div>
                </section>

                {/* ── 4. PROFESSIONAL WORKFLOW SECTION ── */}
                <section className="py-32 border-t border-white/5 text-center">
                    <FadeIn>
                        <h2 className="text-3xl md:text-5xl font-bold tracking-tight">Works with your existing creative workflow.</h2>
                        <p className="text-lg text-muted-foreground mt-6 max-w-2xl mx-auto">Vibed is not a walled garden. We focus on the heavy lifting of rough assembly and pacing. Create faster here, finish anywhere.</p>
                    </FadeIn>

                    <FadeIn delay={0.2} className="mt-16 flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
                        {/* Elegant text representations of NLEs */}
                        <div className="text-2xl font-bold tracking-tighter text-white/80">Premiere Pro</div>
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                        <div className="text-2xl font-bold tracking-tighter text-white/80">DaVinci Resolve</div>
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                        <div className="text-2xl font-bold tracking-tighter text-white/80">Final Cut Pro</div>
                    </FadeIn>
                </section>

                {/* ── 5. CREATIVE CONTROL SECTION ── */}
                <section className="py-32 border-t border-white/5 flex flex-col-reverse lg:flex-row items-center gap-16">
                    <div className="flex-1 w-full">
                        <FadeIn delay={0.2} className="glass-panel p-8 rounded-3xl relative overflow-hidden h-[300px] flex items-center justify-center">
                            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                            
                            {/* Abstract timeline control visualization */}
                            <div className="relative z-10 w-full max-w-sm space-y-4">
                                <div className="flex justify-between text-xs text-muted-foreground font-medium px-2">
                                    <span>AI Suggested Cut</span>
                                    <span>Override</span>
                                </div>
                                <div className="w-full h-12 rounded-xl border border-white/10 bg-black/50 flex items-center p-1 group hover:border-primary/50 transition-colors">
                                    <div className="h-full w-[40%] bg-primary/20 rounded-lg" />
                                    <div className="h-full w-1 bg-white mx-1 cursor-ew-resize rounded-full" />
                                    <div className="h-full flex-1 bg-white/5 rounded-lg group-hover:bg-white/10 transition-colors" />
                                </div>
                            </div>
                        </FadeIn>
                    </div>

                    <div className="flex-1 space-y-8">
                        <FadeIn>
                            <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]">
                                You stay in control. <br/> <span className="text-muted-foreground font-medium">AI suggests. You decide.</span>
                            </h2>
                        </FadeIn>
                        <FadeIn delay={0.1}>
                            <p className="text-lg text-muted-foreground leading-relaxed max-w-lg">
                                We don't believe in black-box automation or faceless content farms. Vibed generates an editable plan. You maintain complete visual direction control, brand consistency, and human storytelling.
                            </p>
                        </FadeIn>
                    </div>
                </section>

                {/* ── 6. CREATOR WORKFLOW SECTION ── */}
                <section className="py-32 border-t border-white/5">
                    <FadeIn>
                        <div className="text-center mb-16">
                            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">One workspace for the entire process.</h2>
                        </div>
                    </FadeIn>

                    <div className="relative max-w-4xl mx-auto mt-16">
                        <div className="absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-y-1/2 hidden md:block" />
                        
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                            {[
                                { step: "1", title: "Idea", icon: Sparkles },
                                { step: "2", title: "Script", icon: AlignLeft },
                                { step: "3", title: "Edit", icon: Scissors },
                                { step: "4", title: "Refine", icon: SlidersHorizontal },
                                { step: "5", title: "Publish", icon: Share2 }
                            ].map((item, i) => (
                                <FadeIn key={i} delay={0.1 * i} className="relative flex flex-col items-center gap-4">
                                    <div className="w-14 h-14 rounded-2xl bg-card border border-white/5 flex items-center justify-center shadow-lg relative z-10 group hover:border-primary/50 hover:bg-white/5 transition-all">
                                        <item.icon className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                    <div className="text-sm font-medium">{item.title}</div>
                                </FadeIn>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── 7. TESTIMONIALS SECTION ── */}
                <section className="py-32 border-t border-white/5">
                    <FadeIn>
                        <h2 className="text-3xl font-bold tracking-tight text-center mb-16">Trusted by modern storytellers.</h2>
                    </FadeIn>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                        <FadeIn delay={0.1} className="glass-panel p-8 rounded-3xl">
                            <p className="text-lg font-medium leading-relaxed mb-6">"Vibed feels like the first AI tool built by people who actually understand professional editing. It saves me days of rough cutting without taking away my creative choices."</p>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-white/10" />
                                <div>
                                    <div className="text-sm font-bold">Sarah J.</div>
                                    <div className="text-xs text-muted-foreground">Documentary Filmmaker</div>
                                </div>
                            </div>
                        </FadeIn>
                        <FadeIn delay={0.2} className="glass-panel p-8 rounded-3xl">
                            <p className="text-lg font-medium leading-relaxed mb-6">"The fact that I can use conversational AI to assemble a podcast, and then immediately kick out an XML to finish the color grade in Resolve is mind-blowing."</p>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-white/10" />
                                <div>
                                    <div className="text-sm font-bold">David M.</div>
                                    <div className="text-xs text-muted-foreground">Creative Director</div>
                                </div>
                            </div>
                        </FadeIn>
                    </div>
                </section>

                {/* ── 8. FINAL CTA SECTION ── */}
                <section className="py-32 border-t border-white/5 text-center">
                    <FadeIn>
                        <h2 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[1.05]">
                            The future of editing <br/> is collaborative.
                        </h2>
                        <p className="text-xl text-muted-foreground mt-8 font-light">AI should amplify creativity — not replace it.</p>
                        
                        <button
                            onClick={() => navigate('/editor')}
                            className="glass-button-pro px-10 py-5 text-lg font-bold mt-12 mx-auto"
                        >
                            Start Creating
                        </button>
                    </FadeIn>
                </section>

                {/* ── FOOTER ── */}
                <footer className="py-12 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <VibedLogoIcon size={20} className="text-muted-foreground" />
                        <span className="text-sm font-bold text-muted-foreground">Vibed</span>
                    </div>
                    <span className="text-xs text-muted-foreground/60 font-medium tracking-wide">
                        The creative operating system. © 2026
                    </span>
                </footer>
            </div>
        </div>
    );
};

export default HomePage;
