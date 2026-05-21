/* ──────────────────────────────────────────────────────────────────
   Vibed — the creative OS for modern storytellers
   Landing experience + interactive conversational-editing demo
   ────────────────────────────────────────────────────────────────── */

const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { I, Logo, ConversationalDemo, ValueProps, Workflow, Exports, Control, Testimonials, FinalCTA, Footer,
  useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSelect, TweakToggle, TweakColor } = window;

/* ─────────── Tweak defaults (host-rewritable) ─────────── */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "graphite",
  "accent": "indigo",
  "headline": "speed-of-thought",
  "showGrain": true
}/*EDITMODE-END*/;

const ACCENTS = {
  indigo: { accent: "oklch(0.66 0.16 268)", soft: "oklch(0.66 0.16 268 / 0.18)" },
  violet: { accent: "oklch(0.62 0.17 295)", soft: "oklch(0.62 0.17 295 / 0.18)" },
  coral:  { accent: "oklch(0.74 0.13 32)",  soft: "oklch(0.74 0.13 32 / 0.18)"  },
  mint:   { accent: "oklch(0.74 0.10 168)", soft: "oklch(0.74 0.10 168 / 0.18)" },
};

const HEADLINES = {
  "speed-of-thought": ["Create at the", "speed of thought."],
  "edit-create":      ["Edit with AI.", "Create like a human."],
  "storytellers":     ["A creative OS for", "modern storytellers."],
};

/* Icons / Logo live in icons.jsx (loaded first). */

/* ─────────── NAV ─────────── */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    fn();
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
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
        <div style={{ display: "flex", gap: 22, fontSize: 13.5, color: "var(--fg-2)" }} className="nav-links">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href="#exports">Exports</a>
          <a href="studio.html">Open Studio ↗</a>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn-ghost" href="studio.html" style={{ height: 36, padding: "0 16px", fontSize: 13 }}>Sign in</a>
          <a className="btn btn-primary" href="studio.html" style={{ height: 36, padding: "0 16px", fontSize: 13 }}>Start creating</a>
        </div>
      </div>
    </nav>
  );
}

/* ─────────── HERO ─────────── */
function Hero({ headline }) {
  const [l1, l2] = HEADLINES[headline] || HEADLINES["speed-of-thought"];
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
            {l1}<br />
            <em>{l2}</em>
          </h1>
          <p className="body-lg fade-up fade-up-d2" style={{ maxWidth: 620, margin: 0, fontSize: 19 }}>
            Vibed is the creative operating system for storytellers and editors.
            Edit, organize and refine your footage in conversation with an assistant that
            respects your taste — and exports anywhere you finish.
          </p>
          <div className="fade-up fade-up-d3" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <a href="studio.html" className="btn btn-primary">Start creating <I.arrow /></a>
            <button className="btn btn-ghost"><I.play /> Watch the 90-second tour</button>
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
}

/* The big hero composition — a faux studio canvas with floating panels.
   No real-app brand UI; purely original visual language. */
function HeroFrame() {
  return (
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
          {["#ff5f57","#febc2e","#28c840"].map(c => (
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
        <div style={{
          borderRight: "0.5px solid var(--line-soft)",
          padding: 16,
          background: "linear-gradient(180deg, var(--glass), transparent)",
          display: "flex", flexDirection: "column", gap: 10,
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
                background: `linear-gradient(135deg, var(--accent), var(--violet))`,
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
            {/* Faux footage placeholder */}
            <div style={{
              position: "absolute", inset: 24, borderRadius: 8,
              background: `linear-gradient(180deg, oklch(0.4 0.05 268) 0%, oklch(0.2 0.04 268) 60%, oklch(0.12 0.02 260) 100%)`,
              overflow: "hidden", border: "0.5px solid rgba(255,255,255,0.06)",
            }}>
              {/* "horizon line" */}
              <div style={{ position: "absolute", left: 0, right: 0, top: "62%", height: 1,
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)" }} />
              {/* "lighthouse" */}
              <div style={{ position: "absolute", left: "30%", top: "32%", width: 6, height: "30%",
                background: "linear-gradient(180deg, oklch(0.85 0.08 60), transparent)" }} />
              {/* timecode */}
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
                <I.spark style={{ color: "var(--accent)" }} />
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
        <div style={{
          borderLeft: "0.5px solid var(--line-soft)",
          padding: 16,
          background: "linear-gradient(180deg, var(--glass), transparent)",
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          <div className="mono" style={{ color: "var(--fg-4)" }}>INSPECTOR</div>
          <div className="card card-pad" style={{ padding: 14, gap: 10, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>Pacing</div>
            <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--bg-3)" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "62%",
                background: "linear-gradient(90deg, var(--accent), var(--violet))", borderRadius: 999 }} />
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
                <I.check style={{ color: "var(--accent)" }} /> {b}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-3)" }}>
              <I.dot style={{ color: "var(--fg-4)" }} /> Reveal · drafting
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineTracks() {
  const tracks = [
    { color: "var(--accent)", clips: [[0, 12], [14, 28], [32, 22], [58, 18], [80, 14]] },
    { color: "var(--violet)", clips: [[2, 18], [24, 34], [62, 20], [86, 10]] },
    { color: "var(--coral)",  clips: [[0, 96]] },
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
}

/* ─────────── CONVERSATIONAL EDITING (wraps demo.jsx) ─────────── */
function ConversationalSection() {
  return (
    <section id="conversational" style={{ background: "var(--bg-2)", paddingTop: 80 }}>
      <div className="wrap">
        <div className="section-head" style={{ maxWidth: 780 }}>
          <span className="eyebrow">Conversational editing</span>
          <h2 className="h-section">Edit like you’re <em>talking</em> to an assistant.</h2>
          <p className="body-lg">Natural language goes in. Real, named timeline edits come out — applied
            non-destructively, reversible to the frame. Try one of the prompts.</p>
        </div>
        <ConversationalDemo />
      </div>
    </section>
  );
}

/* ─────────── APP ─────────── */
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => {
    document.documentElement.dataset.theme = t.theme;
    const a = ACCENTS[t.accent] || ACCENTS.indigo;
    document.documentElement.style.setProperty("--accent", a.accent);
    document.documentElement.style.setProperty("--accent-soft", a.soft);
    document.body.classList.toggle("grain", !!t.showGrain);
  }, [t.theme, t.accent, t.showGrain]);

  return (
    <>
      <Nav />
      <main>
        <Hero headline={t.headline} />
        <ValueProps />
        <ConversationalSection />
        <Workflow />
        <Exports />
        <Control />
        <FinalCTA />
      </main>
      <Footer />

      <TweaksPanel title="Vibed · Tweaks">
        <TweakSection label="Theme">
          <TweakRadio label="Surface" value={t.theme}
            options={[{value:"graphite", label:"Graphite"}, {value:"warm", label:"Warm white"}]}
            onChange={(v) => setTweak("theme", v)} />
          <TweakColor label="Accent" value={ACCENTS[t.accent].accent}
            options={Object.values(ACCENTS).map(a => a.accent)}
            onChange={(v) => {
              const k = Object.entries(ACCENTS).find(([, val]) => val.accent === v)?.[0] || "indigo";
              setTweak("accent", k);
            }} />
        </TweakSection>
        <TweakSection label="Hero copy">
          <TweakSelect label="Headline" value={t.headline}
            options={[
              { value: "speed-of-thought", label: "Speed of thought" },
              { value: "edit-create", label: "Edit / Create" },
              { value: "storytellers", label: "For storytellers" },
            ]}
            onChange={(v) => setTweak("headline", v)} />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
