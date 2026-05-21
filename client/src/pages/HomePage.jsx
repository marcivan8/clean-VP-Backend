import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Play, CheckCircle2 } from 'lucide-react';

const Logo = () => (
    <svg width="28" height="28" viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z" fill="none" stroke="currentColor" strokeWidth="32" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="248" y1="248" x2="195" y2="268" stroke="currentColor" strokeWidth="16" strokeLinecap="round" className="text-accent" />
    </svg>
);

const Nav = () => {
    const [scrolled, setScrolled] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 24);
        handleScroll();
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    return (
        <nav style={{
            position: "fixed", top: 16, left: 0, right: 0, zIndex: 50,
            display: "flex", justifyContent: "center", pointerEvents: "none",
        }}>
            <div style={{
                pointerEvents: "auto",
                display: "flex", alignItems: "center", gap: 28,
                padding: "10px 12px 10px 22px",
                borderRadius: 999,
                background: scrolled ? "var(--glass-2)" : "transparent",
                border: `0.5px solid ${scrolled ? "var(--glass-stroke)" : "transparent"}`,
                backdropFilter: scrolled ? "blur(20px) saturate(160%)" : "none",
                WebkitBackdropFilter: scrolled ? "blur(20px) saturate(160%)" : "none",
                transition: "all 0.3s ease",
            }}>
                <Logo />
                <div style={{ display: "flex", gap: 22, fontSize: 13.5, color: "var(--fg-2)" }} className="hidden sm:flex font-medium">
                    <a href="#product" className="hover:text-foreground transition-colors">Product</a>
                    <a href="#workflow" className="hover:text-foreground transition-colors">Workflow</a>
                    <a href="#exports" className="hover:text-foreground transition-colors">Exports</a>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/editor')}>Sign in</button>
                    <button className="btn btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/editor')}>Start creating</button>
                </div>
            </div>
        </nav>
    );
};

const TimelineTracks = () => {
    const tracks = [
        { color: "var(--accent)", clips: [[0, 12], [14, 28], [32, 22], [58, 18], [80, 14]] },
        { color: "oklch(0.6 0.16 295)", clips: [[2, 18], [24, 34], [62, 20], [86, 10]] }, // violet
        { color: "oklch(0.78 0.13 32)",  clips: [[0, 96]] }, // coral
    ];
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tracks.map((t, i) => (
                <div key={i} style={{ position: "relative", height: 18, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden" }}>
                    {t.clips.map(([x, w], j) => (
                        <div key={j} style={{
                            position: "absolute", left: `${x}%`, width: `${w}%`, top: 2, bottom: 2,
                            background: i === 2
                                ? `repeating-linear-gradient(90deg, ${t.color} 0 1px, transparent 1px 4px)`
                                : `linear-gradient(180deg, color-mix(in oklch, ${t.color} 70%, white) 0%, ${t.color} 100%)`,
                            opacity: i === 2 ? 0.6 : 0.85,
                            borderRadius: 3,
                            border: i === 2 ? "0" : `0.5px solid color-mix(in oklch, ${t.color} 60%, black)`,
                        }} />
                    ))}
                </div>
            ))}
            {/* Playhead */}
            <div style={{ position: "relative", height: 4 }}>
                <div style={{ position: "absolute", left: "38%", top: -68, height: 80, width: 1, background: "var(--fg)" }} />
                <div style={{ position: "absolute", left: "calc(38% - 5px)", top: -72,
                    width: 10, height: 10, borderRadius: 50, background: "var(--fg)" }} />
            </div>
        </div>
    );
};

const HeroFrame = () => (
    <div style={{
        position: "relative",
        borderRadius: 28,
        overflow: "hidden",
        border: "0.5px solid var(--glass-stroke)",
        background: "linear-gradient(180deg, var(--bg-2), var(--bg-3))",
        boxShadow: "var(--shadow-card)",
        aspectRatio: "16/9",
    }}>
        {/* Window chrome */}
        <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
            borderBottom: "0.5px solid var(--line-soft)",
            background: "var(--glass)",
        }}>
            <div style={{ display: "flex", gap: 6 }}>
                {["#ff5f57", "#febc2e", "#28c840"].map(c => (
                    <div key={c} style={{ width: 11, height: 11, borderRadius: 50, background: c, opacity: 0.7 }} />
                ))}
            </div>
            <div style={{ flex: 1, textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)" }}>
                vibed/studio &nbsp;·&nbsp; <span style={{ color: "var(--fg-2)" }}>“The North Wind” — Episode 03</span> · 04:18:22
            </div>
            <div className="mono" style={{ color: "var(--fg-3)" }}>⌘K</div>
        </div>

        {/* Canvas */}
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 280px", height: "calc(100% - 44px)" }}>
            {/* Bin */}
            <div className="hidden md:flex" style={{
                borderRight: "0.5px solid var(--line-soft)",
                padding: 16,
                background: "linear-gradient(180deg, var(--glass), transparent)",
                flexDirection: "column", gap: 10,
            }}>
                <div className="mono" style={{ color: "var(--fg-4)" }}>BIN · 38 CLIPS</div>
                {["Cold open", "Interview · Mara", "B-roll · harbour", "Drone · sunrise", "Score · stems", "Voiceover v3"].map((n, i) => (
                    <div key={n} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                        borderRadius: 10, background: i === 1 ? "var(--glass-2)" : "transparent",
                        border: i === 1 ? "0.5px solid var(--glass-stroke)" : "0.5px solid transparent",
                        fontSize: 12.5,
                    }}>
                        <div style={{
                            width: 22, height: 22, borderRadius: 5,
                            background: `linear-gradient(135deg, var(--accent), oklch(0.6 0.16 295))`,
                            opacity: 0.5 + (i % 3) * 0.15,
                        }} />
                        <span>{n}</span>
                        <span style={{ marginLeft: "auto", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10 }}>
                            {`00:${20 + i * 7}`}
                        </span>
                    </div>
                ))}
            </div>

            {/* Viewer + timeline */}
            <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, position: "relative", overflow: "hidden",
                    background: "radial-gradient(60% 80% at 50% 40%, #1c1f24 0%, #0c0d10 100%)" }}>
                    <div style={{
                        position: "absolute", inset: 24, borderRadius: 8,
                        background: `linear-gradient(180deg, oklch(0.4 0.05 268) 0%, oklch(0.2 0.04 268) 60%, oklch(0.12 0.02 260) 100%)`,
                        overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.06)",
                    }}>
                        <div style={{ position: "absolute", left: 0, right: 0, top: "62%", height: 1,
                            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)" }} />
                        <div style={{ position: "absolute", left: "30%", top: "32%", width: 6, height: "30%",
                            background: "linear-gradient(180deg, oklch(0.85 0.08 60), transparent)" }} />
                        <div className="mono" style={{ position: "absolute", left: 12, top: 10, color: "rgba(255,255,255,0.7)", fontSize: 10 }}>
                            A001_C012 · 01:14:22:08
                        </div>
                        <div className="mono" style={{ position: "absolute", right: 12, top: 10, color: "rgba(255,255,255,0.5)", fontSize: 10 }}>
                            ARRI 4.6K · ProRes 422 HQ
                        </div>
                        
                        {/* floating AI suggestion */}
                        <div style={{
                            position: "absolute", right: 16, bottom: 16,
                            padding: "10px 14px", borderRadius: 14,
                            background: "rgba(20, 22, 26, 0.7)",
                            backdropFilter: "blur(20px)",
                            border: "0.5px solid rgba(255,255,255,0.12)",
                            display: "flex", alignItems: "center", gap: 10,
                            fontSize: 12,
                        }}>
                            <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} />
                            <span style={{ color: "rgba(255,255,255,0.9)" }}>Suggest a 4-frame J-cut into Mara’s line?</span>
                            <span style={{
                                fontFamily: "var(--f-mono)", fontSize: 10, color: "rgba(255,255,255,0.5)",
                                padding: "2px 6px", borderRadius: 4, border: "0.5px solid rgba(255,255,255,0.18)",
                            }}>↵ accept</span>
                        </div>
                    </div>
                </div>
                {/* Timeline */}
                <div style={{ height: 130, padding: "12px 16px", borderTop: "0.5px solid var(--line-soft)",
                    display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>
                        <span>00:00</span>
                        <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                        <span>02:30</span>
                        <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                        <span>05:00</span>
                    </div>
                    <TimelineTracks />
                </div>
            </div>

            {/* Inspector */}
            <div className="hidden lg:flex" style={{
                borderLeft: "0.5px solid var(--line-soft)",
                padding: 16,
                background: "linear-gradient(180deg, var(--glass), transparent)",
                flexDirection: "column", gap: 14,
            }}>
                <div className="mono" style={{ color: "var(--fg-4)" }}>INSPECTOR</div>
                <div className="card card-pad" style={{ padding: 14, gap: 10, display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>Pacing</div>
                    <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--bg-3)" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "62%",
                            background: "linear-gradient(90deg, var(--accent), oklch(0.6 0.16 295))", borderRadius: 999 }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>
                        <span>calm</span><span>cinematic</span><span>urgent</span>
                    </div>
                </div>
                <div className="card card-pad" style={{ padding: 14, gap: 10, display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>Story beats</div>
                        <span className="mono" style={{ color: "var(--fg-4)" }}>4 / 6</span>
                    </div>
                    {["Hook", "Setup", "Tension"].map(b => (
                        <div key={b} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} /> {b}
                        </div>
                    ))}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20" /> Reveal · drafting
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const Hero = () => {
    const navigate = useNavigate();
    return (
        <section style={{ paddingTop: 140, paddingBottom: 40, position: "relative", overflow: "hidden" }}>
            <div className="aurora" />
            <div className="wrap" style={{ position: "relative", zIndex: 2 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 28 }}>
                    <div className="tag fade-up">
                        <span className="dot" />
                        <span>Vibed Studio · Private beta</span>
                        <span style={{ color: "var(--fg-4)" }}>—</span>
                        <span>v0.6 “Cinema”</span>
                    </div>
                    <h1 className="display fade-up fade-up-d1">
                        Create at the<br />
                        <em>speed of thought.</em>
                    </h1>
                    <p className="body-lg fade-up fade-up-d2" style={{ maxWidth: 620, margin: 0, fontSize: 19 }}>
                        Vibed is the creative operating system for storytellers and editors.
                        Edit, organize and refine your footage in conversation with an assistant that
                        respects your taste — and exports anywhere you finish.
                    </p>
                    <div className="fade-up fade-up-d3" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
                        <button onClick={() => navigate('/editor')} className="btn btn-primary">Start creating <ArrowRight className="w-4 h-4 ml-1" /></button>
                        <button className="btn btn-ghost"><Play className="w-4 h-4 mr-1" /> Watch the 90-second tour</button>
                    </div>
                    <div className="fade-up fade-up-d4 caption" style={{ marginTop: 8 }}>
                        Built for creators, editors, storytellers &amp; modern media teams.
                    </div>
                </div>

                {/* Cinematic frame */}
                <div className="fade-up fade-up-d4" style={{ marginTop: 72 }}>
                    <HeroFrame />
                </div>
            </div>
        </section>
    );
};

const ConversationalSection = () => (
    <section id="conversational" style={{ background: "var(--bg-2)", paddingTop: 80 }}>
        <div className="wrap pb-32">
            <div className="section-head mx-auto text-center" style={{ maxWidth: 780 }}>
                <span className="eyebrow mx-auto justify-center">Conversational editing</span>
                <h2 className="h-section mt-4">Edit like you’re <em>talking</em> to an assistant.</h2>
                <p className="body-lg mt-6">Natural language goes in. Real, named timeline edits come out — applied
                    non-destructively, reversible to the frame. Try one of the prompts.</p>
            </div>
            
            {/* Minimal mockup of conversational UI */}
            <div className="card mx-auto max-w-3xl overflow-hidden mt-12 relative border-white/10 shadow-2xl">
                 <div className="h-10 border-b border-white/5 flex items-center px-4 gap-2 bg-white/5">
                    <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                </div>
                <div className="p-8 h-[350px] flex flex-col justify-between">
                    <div className="space-y-6">
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/5"><span className="text-xs font-medium">U</span></div>
                            <div className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm border border-white/10 bg-white/5 shadow-sm">
                                Make this intro more cinematic and cut the dead air.
                            </div>
                        </div>
                        <div className="flex items-start gap-4 flex-row-reverse">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border border-white/10 text-accent"><Logo /></div>
                            <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm border shadow-lg backdrop-blur-md" style={{ background: "color-mix(in oklch, var(--accent) 15%, transparent)", borderColor: "color-mix(in oklch, var(--accent) 30%, transparent)", color: "#fff" }}>
                                <p className="mb-2 font-medium">Done. I've applied the following edits:</p>
                                <ul className="space-y-1.5 text-xs text-white/80 list-disc pl-4 mt-2">
                                    <li>Removed 12 seconds of dead air.</li>
                                    <li>Added a subtle cinematic color grade.</li>
                                    <li>Slowed the first clip to 80% speed.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
);

const ValueProps = () => (
    <section className="py-32 border-t border-white/5 bg-background">
        <div className="wrap">
            <div className="text-center mb-20">
                <h2 className="text-3xl md:text-5xl font-bold tracking-tight font-display italic">AI that works with your creativity.</h2>
                <p className="text-muted-foreground mt-6 max-w-2xl mx-auto text-lg font-light">We believe AI should amplify human creativity, not replace it. Vibed integrates seamlessly into professional pipelines to accelerate your process.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="card card-pad flex flex-col gap-5 text-center items-center">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 text-accent">
                        <Sparkles className="w-6 h-6" />
                    </div>
                    <h3 className="h-card">Conversational Editing</h3>
                    <p className="body">Describe the edit you want in natural language. Vibed translates your intent into precise timeline actions.</p>
                </div>
                <div className="card card-pad flex flex-col gap-5 text-center items-center">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 text-accent">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
                    </div>
                    <h3 className="h-card">Creative Control</h3>
                    <p className="body">AI suggests. You decide. Every automated cut or edit is completely non-destructive and adjustable on the timeline.</p>
                </div>
                <div className="card card-pad flex flex-col gap-5 text-center items-center">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 text-accent">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </div>
                    <h3 className="h-card">Professional Export</h3>
                    <p className="body">Don't feel trapped. Export frame-accurate XMLs directly to Premiere Pro, DaVinci Resolve, or Final Cut.</p>
                </div>
            </div>
        </div>
    </section>
);

const HomePage = () => {
    return (
        <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans selection:bg-accent selection:text-white">
            <Nav />
            <main>
                <Hero />
                <ValueProps />
                <ConversationalSection />
            </main>
            
            <footer className="py-12 border-t border-white/5 text-center mt-20 text-[var(--fg-3)] text-sm">
                <div className="wrap flex flex-col items-center gap-4">
                    <Logo />
                    <p>© 2026 Vibed Inc. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
};

export default HomePage;
