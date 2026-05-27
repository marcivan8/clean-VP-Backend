import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Play, CheckCircle2, MousePointerClick, Layers, LayoutGrid, Link as LinkIcon } from 'lucide-react';

const Logo = ({ size = 28 }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                    </div>
                    <div className="fade-up fade-up-d4 caption" style={{ marginTop: 8 }}>
                        Built for creators, editors, storytellers &amp; modern media teams.
                    </div>
                </div>
                <div className="fade-up fade-up-d4" style={{ marginTop: 72 }}>
                    <HeroFrame />
                </div>
            </div>
        </section>
    );
};

const ValueCard = ({ tag, title, body, icon: Icon }) => (
    <div style={{
      background: "var(--bg)", padding: 32, display: "flex", flexDirection: "column", gap: 16,
      minHeight: 240, position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: "var(--bg-2)", border: "0.5px solid var(--line)",
          display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)",
        }}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="mono" style={{ color: "var(--fg-4)" }}>{tag}</span>
      </div>
      <h3 className="h-card" style={{ marginTop: "auto" }}>{title}</h3>
      <p className="body" style={{ margin: 0, fontSize: 14.5 }}>{body}</p>
    </div>
);

const ValueProps = () => {
    const items = [
      { tag: "01", title: "Conversational editing", body: "Tell Vibed what you want — pacing, mood, length — in plain language. Every edit lands on a real timeline you can override.", icon: MousePointerClick },
      { tag: "02", title: "Timeline intelligence",  body: "Beats, energy, faces, dialogue and silences are read continuously, so suggestions match the shape of your story.", icon: Layers },
      { tag: "03", title: "Creative control",        body: "Nothing happens without an accept. Every action is a granular edit you can revert, fork, or refine.", icon: CheckCircle2 },
      { tag: "04", title: "Cross-platform publish",  body: "Render verticals, horizontals and squares from a single edit. Captions, safe areas and aspect-aware reframes built in.", icon: LayoutGrid },
      { tag: "05", title: "AI-assisted workflows",   body: "Boilerplate — relinks, conforms, multicam syncs, transcript cleanup — handled before you sit down.", icon: Sparkles },
      { tag: "06", title: "Professional export",     body: "Roundtrip XML, EDL, OTIO and DRP. Pick the suite where you finish; Vibed hands the project off cleanly.", icon: LinkIcon },
    ];
    return (
      <section id="product">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">The platform</span>
            <h2 className="h-section">AI that works <em>with</em> your creativity — never around it.</h2>
            <p className="body-lg">Six surfaces, one mental model. Vibed never disappears your decisions
              inside a black box; every move is visible, named, and reversible.</p>
          </div>
  
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 1,
            border: "0.5px solid var(--line)", borderRadius: 24, overflow: "hidden", background: "var(--line)",
          }}>
            {items.map((it) => (
              <ValueCard key={it.tag} {...it} />
            ))}
          </div>
        </div>
      </section>
    );
};

const Workflow = () => {
    const steps = [
      { k: "Idea",    body: "Drop a script, prompt, voice memo or rough cut. Vibed indexes everything in seconds." },
      { k: "Script",  body: "Outline beats, hooks and pacing. The script and timeline stay in lockstep." },
      { k: "Edit",    body: "Conversational cuts, smart trims, multicam sync — without leaving the canvas." },
      { k: "Refine",  body: "Captions, colour, sound design, motion polish. Each refinement is a clear, named edit." },
      { k: "Export",  body: "Render flat, or roundtrip to Premiere · Resolve · Final Cut · After Effects · CapCut." },
      { k: "Publish", body: "Schedule, ship and monitor across vertical and horizontal destinations." },
    ];
    return (
      <section id="workflow">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">The workflow</span>
            <h2 className="h-section">One workspace for the <em>entire</em> creative process.</h2>
            <p className="body-lg">A single project graph, from the first voice memo to the final
              delivery — no exports between thinking and shipping.</p>
          </div>
  
          <div style={{ position: "relative" }}>
            <div style={{
              position: "absolute", left: 24, right: 24, top: 38, height: 1,
              background: "linear-gradient(90deg, transparent, var(--line-strong), transparent)",
            }} className="hidden md:block" />
            <div style={{
              display: "grid", gap: 16, position: "relative",
            }} className="grid-cols-2 md:grid-cols-6 md:gap-4">
              {steps.map((s, i) => (
                <div key={s.k} style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
                  <div style={{
                    width: 76, height: 76, borderRadius: 18,
                    background: i === 2 ? "linear-gradient(135deg, var(--accent), oklch(0.6 0.16 295))" : "var(--bg-2)",
                    border: i === 2 ? "0" : "0.5px solid var(--line)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--f-display)", fontSize: 32,
                    color: i === 2 ? "#fff" : "var(--fg)",
                    position: "relative", zIndex: 1,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontFamily: "var(--f-display)", fontSize: 22, letterSpacing: "-0.02em" }}>
                      {s.k}
                    </div>
                    <p className="body" style={{ margin: 0, fontSize: 13.5 }}>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
};
  
const ExportIcon = {
    premiere: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="6" width="26" height="20" rx="2" />
        <path d="M3 11h26M3 21h26" />
        <path d="M7 6v-2M11 6v-2M15 6v-2M19 6v-2M23 6v-2M27 6v-2" />
        <path d="M7 28v-2M11 28v-2M15 28v-2M19 28v-2M23 28v-2M27 28v-2" />
        <path d="M13 14l6 2-6 2v-4z" fill="currentColor" stroke="none" />
      </svg>
    ),
    resolve: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="16" cy="16" r="10" />
        <circle cx="16" cy="16" r="3" />
        <path d="M16 6v4M16 22v4M6 16h4M22 16h4M9 9l2.8 2.8M20.2 20.2L23 23M9 23l2.8-2.8M20.2 11.8L23 9" strokeLinecap="round" />
      </svg>
    ),
    finalcut: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <rect x="4" y="4" width="24" height="24" rx="5" />
        <path d="M12 11v10l9-5-9-5z" fill="currentColor" stroke="none" />
      </svg>
    ),
    otio: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="7" cy="9" r="2.5" />
        <circle cx="25" cy="9" r="2.5" />
        <circle cx="16" cy="23" r="2.5" />
        <path d="M9 10.5l5.5 10M23 10.5l-5.5 10M9.5 9h13" strokeLinecap="round" />
      </svg>
    ),
};
  
const Exports = () => {
    const tools = [
      { key: "premiere", name: "Premiere Pro",     fmt: "XML · MOGRT" },
      { key: "resolve",  name: "DaVinci Resolve",  fmt: "DRP · OFX" },
      { key: "finalcut", name: "Final Cut Pro",    fmt: "FCPXML · iCloud" },
      { key: "otio",     name: "OpenTimelineIO",   fmt: "Open standard" },
    ];
    return (
      <section id="exports" style={{ background: "var(--bg-2)" }}>
        <div className="wrap">
          <div style={{ display: "grid", gap: 80, alignItems: "center" }} className="grid-cols-1 md:grid-cols-2">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <span className="eyebrow">Roundtrip-ready</span>
              <h2 className="h-section">Works with the suite you <em>already</em> finish in.</h2>
              <p className="body-lg">Vibed isn’t the last app you’ll ever open — it’s the first.
                Hand off cleanly to professional editing tools the moment you’re ready to polish.</p>
              <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                <span className="tag"><span className="dot" />XML · FCPXML · EDL · OTIO</span>
                <span className="tag">Bin metadata preserved</span>
                <span className="tag">Non-destructive</span>
              </div>
            </div>
  
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {tools.map((t) => {
                const Icon = ExportIcon[t.key];
                return (
                  <div key={t.key} className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12, background: "var(--bg-3)",
                      border: "0.5px solid var(--line)", color: "var(--fg)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <Icon />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</div>
                      <div className="mono" style={{ color: "var(--fg-3)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.fmt}</div>
                    </div>
                    <div style={{ marginLeft: "auto", color: "var(--fg-4)" }}><ArrowRight className="w-4 h-4" /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
};
  
const Control = () => (
    <section>
      <div className="wrap">
        <div style={{ display: "grid", gap: 64, alignItems: "center" }} className="grid-cols-1 md:grid-cols-2">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <span className="eyebrow">Creative control</span>
            <h2 className="h-section">You stay in <em>control.</em><br />The AI suggests. You decide.</h2>
            <p className="body-lg">No silent rewrites. Every edit lands as a named, reversible action — and
              your draft style, brand voice and visual direction travel with the project.</p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              {[
                "Every AI action is logged as a discrete edit",
                "Style guides travel with each project",
                "Brand kits lock typography, palette and motion",
                "Variants live side-by-side — never overwritten",
              ].map(t => (
                <li key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: "var(--fg-2)" }}>
                  <CheckCircle2 className="w-4 h-4 text-accent" /> {t}
                </li>
              ))}
            </ul>
          </div>
  
          {/* Edit-log card */}
          <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: "0.5px solid var(--line-soft)" }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>Edit history</div>
              <span className="mono" style={{ color: "var(--fg-4)" }}>v.143 · auto-saved</span>
            </div>
            {[
              { who: "you", t: "cut_segment: 00:04:12 to 00:05:01", time: "just now", accent: true },
              { who: "vibed", t: "remove_silences: Applied to 12 clips", time: "12s", accent: false },
              { who: "you", t: "split_clip: Track 1 at 00:02:14", time: "1m", accent: true },
              { who: "vibed", t: "remove_repetition: 4 segments removed", time: "2m", accent: false },
              { who: "you", t: "move_clip: B-roll to 00:01:00", time: "4m", accent: true },
              { who: "vibed", t: "add_transitions: Crossfade (1s)", time: "6m", accent: false },
            ].map((e, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                borderBottom: i === 5 ? "0" : "0.5px solid var(--line-soft)", fontSize: 13.5,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: 50,
                  background: e.accent ? "var(--accent)" : "var(--fg-4)", flexShrink: 0,
                }} />
                <span className="mono" style={{ width: 50, color: "var(--fg-3)", fontSize: 10.5, textTransform: "uppercase" }}>
                  {e.who}
                </span>
                <span style={{ color: "var(--fg)" }}>{e.t}</span>
                <span style={{ marginLeft: "auto", color: "var(--fg-4)", fontSize: 12 }}>{e.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
);
  

const FinalCTA = () => (
    <section style={{ position: "relative", overflow: "hidden", paddingTop: 140, paddingBottom: 140 }}>
      <div className="aurora" />
      <div className="wrap" style={{ position: "relative", zIndex: 2, textAlign: "center", display: "flex", flexDirection: "column", gap: 28, alignItems: "center" }}>
        <span className="eyebrow">What comes next</span>
        <h2 className="display" style={{ fontSize: "clamp(48px, 6.4vw, 96px)" }}>
          The future of editing<br /><em>is collaborative.</em>
        </h2>
        <p className="body-lg" style={{ maxWidth: 580, margin: 0 }}>
          AI should amplify the artist — not replace them. Start editing with a partner
          that takes its cues from you.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={() => navigate('/editor')} className="btn btn-primary">Start creating <ArrowRight className="w-4 h-4 ml-1" /></button>
        </div>
        <div className="caption" style={{ marginTop: 8 }}>
          Private beta · 30-day storage · No credit card required
        </div>
      </div>
    </section>
);
  
const Footer = () => {
    const cols = {
      "Legal": ["Your data"],
    };
    return (
      <footer style={{ borderTop: "0.5px solid var(--line)", padding: "64px 0 32px", background: "var(--bg)" }}>
        <div className="wrap grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]" style={{ display: "grid", gap: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Logo size={32} />
            <p className="body" style={{ fontSize: 13.5, margin: 0, maxWidth: 280 }}>
              The creative operating system for modern storytellers, editors and studios.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <div style={{ display: "flex" }}>
                <span className="tag"><span className="dot" />All systems normal</span>
              </div>
              <div style={{ display: "flex" }}>
                <a href="/gdpr" style={{ textDecoration: 'none' }}>
                  <span className="tag" style={{ border: "0.5px solid var(--line-strong)", background: "var(--bg-2)", cursor: "pointer" }}>GDPR Compliant · GCS Data Processor · 30-Day Retention</span>
                </a>
              </div>
            </div>
          </div>
          {Object.entries(cols).map(([k, items]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="mono" style={{ color: "var(--fg-4)" }}>{k.toUpperCase()}</div>
              {items.map(it => (
                <a key={it} href={it === 'Your data' ? '/data' : '#'} style={{ fontSize: 13.5, color: "var(--fg-2)" }} className="hover:text-foreground transition-colors">{it}</a>
              ))}
            </div>
          ))}
        </div>
        <div className="wrap" style={{ marginTop: 56, paddingTop: 24, borderTop: "0.5px solid var(--line-soft)",
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <span className="caption">© 2026 Vibed Studios — All footage in this page is illustrative.</span>
          <span className="caption">Made with care, for makers.</span>
        </div>
      </footer>
    );
};

const HomePage = () => {
    return (
        <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans selection:bg-accent selection:text-white">
            <Nav />
            <main>
                <Hero />
                <ValueProps />
                <Workflow />
                <Exports />
                <Control />
                <FinalCTA />
            </main>
            <Footer />
        </div>
    );
};

export default HomePage;
