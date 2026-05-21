/* ──────────────────────────────────────────────────────────────────
   Vibed — supporting sections
   ────────────────────────────────────────────────────────────────── */

const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;
const { I: I_s, Logo: Logo_s } = window;
const I = I_s;
const Logo = Logo_s;

/* ─────────── VALUE PROPS ─────────── */
function ValueProps() {
  const items = [
    { tag: "01", title: "Conversational editing", body: "Tell Vibed what you want — pacing, mood, length — in plain language. Every edit lands on a real timeline you can override.", icon: I.cursor },
    { tag: "02", title: "Timeline intelligence",  body: "Beats, energy, faces, dialogue and silences are read continuously, so suggestions match the shape of your story.", icon: I.layers },
    { tag: "03", title: "Creative control",        body: "Nothing happens without an accept. Every action is a granular edit you can revert, fork, or refine.", icon: I.check },
    { tag: "04", title: "Cross-platform publish",  body: "Render verticals, horizontals and squares from a single edit. Captions, safe areas and aspect-aware reframes built in.", icon: I.grid },
    { tag: "05", title: "AI-assisted workflows",   body: "Boilerplate — relinks, conforms, multicam syncs, transcript cleanup — handled before you sit down.", icon: I.spark },
    { tag: "06", title: "Professional export",     body: "Roundtrip XML, EDL, OTIO and DRP. Pick the suite where you finish; Vibed hands the project off cleanly.", icon: I.link },
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
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 1,
          border: "0.5px solid var(--line)",
          borderRadius: 24,
          overflow: "hidden",
          background: "var(--line)",
        }}>
          {items.map((it) => (
            <ValueCard key={it.tag} {...it} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ValueCard({ tag, title, body, icon: Icon }) {
  return (
    <div style={{
      background: "var(--bg)",
      padding: 32, display: "flex", flexDirection: "column", gap: 16,
      minHeight: 240, position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "var(--bg-2)", border: "0.5px solid var(--line)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--accent)",
        }}>
          <Icon />
        </div>
        <span className="mono" style={{ color: "var(--fg-4)" }}>{tag}</span>
      </div>
      <h3 className="h-card" style={{ marginTop: "auto" }}>{title}</h3>
      <p className="body" style={{ margin: 0, fontSize: 14.5 }}>{body}</p>
    </div>
  );
}

/* ─────────── WORKFLOW ─────────── */
function Workflow() {
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
          {/* Connecting rail */}
          <div style={{
            position: "absolute", left: 24, right: 24, top: 38, height: 1,
            background: "linear-gradient(90deg, transparent, var(--line-strong), transparent)",
          }} className="workflow-rail" />
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
            gap: 16, position: "relative",
          }} className="workflow-grid">
            {steps.map((s, i) => (
              <div key={s.k} style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
                <div style={{
                  width: 76, height: 76, borderRadius: 18,
                  background: i === 2
                    ? "linear-gradient(135deg, var(--accent), var(--violet))"
                    : "var(--bg-2)",
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
        <style>{`
          @media (max-width: 900px) {
            .workflow-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 32px !important; }
            .workflow-rail { display: none; }
          }
        `}</style>
      </div>
    </section>
  );
}

/* ─────────── EXPORTS / PRO TOOLS ─────────── */
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

function Exports() {
  const tools = [
    { key: "premiere", name: "Premiere Pro",     fmt: "XML · MOGRT" },
    { key: "resolve",  name: "DaVinci Resolve",  fmt: "DRP · OFX" },
    { key: "finalcut", name: "Final Cut Pro",    fmt: "FCPXML · iCloud" },
    { key: "otio",     name: "OpenTimelineIO",   fmt: "Open standard" },
  ];
  return (
    <section id="exports" style={{ background: "var(--bg-2)" }}>
      <div className="wrap">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }} className="export-grid">
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

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12,
          }}>
            {tools.map((t) => {
              const Icon = ExportIcon[t.key];
              return (
                <div key={t.key} className="card" style={{
                  padding: 20, display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: "var(--bg-3)",
                    border: "0.5px solid var(--line)",
                    color: "var(--fg)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Icon />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</div>
                    <div className="mono" style={{ color: "var(--fg-3)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.fmt}</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "var(--fg-4)" }}><I.arrow /></div>
                </div>
              );
            })}
          </div>
        </div>
        <style>{`
          @media (max-width: 900px) {
            .export-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
          }
        `}</style>
      </div>
    </section>
  );
}

/* ─────────── CREATIVE CONTROL ─────────── */
function Control() {
  return (
    <section>
      <div className="wrap">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }} className="control-grid">
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
                  <I.check style={{ color: "var(--accent)" }} /> {t}
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
              { who: "you", t: "Trimmed cold open by 1.2s", time: "just now", accent: true },
              { who: "vibed", t: "Suggested J-cut on dialogue track 2", time: "12s", accent: false },
              { who: "you", t: "Locked Mara’s line as protected", time: "1m", accent: true },
              { who: "vibed", t: "Conformed B-roll · 4 clips relinked", time: "2m", accent: false },
              { who: "you", t: "Forked variant ‘Director’s cut’", time: "4m", accent: true },
              { who: "vibed", t: "Captured style guide from Ep. 02", time: "6m", accent: false },
            ].map((e, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                borderBottom: i === 5 ? "0" : "0.5px solid var(--line-soft)", fontSize: 13.5,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: 50,
                  background: e.accent ? "var(--accent)" : "var(--fg-4)",
                  flexShrink: 0,
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
        <style>{`
          @media (max-width: 900px) {
            .control-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>
    </section>
  );
}

/* ─────────── TESTIMONIALS ─────────── */
function Testimonials() {
  const quotes = [
    {
      quote: "Vibed feels like having a calm second editor in the room. It proposes — I accept, I reject, I refine. My footage still feels like mine.",
      who: "Anders Vahl", role: "Documentary editor", studio: "Northcape Pictures",
    },
    {
      quote: "We cut a four-part series in the time it used to take to assemble episode one. Nothing felt automated. Nothing felt cheap.",
      who: "Priya Menon", role: "Showrunner", studio: "Foreword Studio",
    },
    {
      quote: "The roundtrip into Resolve is the cleanest I have seen from any AI tool. Nodes intact. Bin metadata intact. No surprise re-encodes.",
      who: "Marco Lemaître", role: "Senior colourist", studio: "Atelier Lumière",
    },
    {
      quote: "Our agency now drafts thirty cut-downs from a single hero edit. The brand voice holds. The clients can’t tell which was the AI assist.",
      who: "Kenji Howe", role: "ECD", studio: "Field & Forest",
    },
  ];
  return (
    <section id="testimonials" style={{ background: "var(--bg-2)" }}>
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">In production</span>
          <h2 className="h-section">Trusted in <em>real</em> edit suites.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          {quotes.map((q) => (
            <div key={q.who} className="card" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20, minHeight: 240 }}>
              <p style={{
                fontFamily: "var(--f-display)", fontSize: 22, lineHeight: 1.25,
                letterSpacing: "-0.015em", margin: 0, color: "var(--fg)", textWrap: "balance",
              }}>
                <span style={{ color: "var(--accent)" }}>“</span>{q.quote}<span style={{ color: "var(--accent)" }}>”</span>
              </p>
              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 50,
                  background: `linear-gradient(135deg, var(--accent), var(--violet))`,
                  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--f-display)", fontSize: 16,
                }}>{q.who.split(" ").map(s => s[0]).join("")}</div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{q.who}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{q.role} · {q.studio}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Studio strip */}
        <div style={{
          marginTop: 64,
          display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "32px 56px",
          opacity: 0.5,
          fontFamily: "var(--f-display)", fontSize: 22, letterSpacing: "-0.02em",
        }}>
          {["Northcape", "Foreword", "Atelier Lumière", "Field & Forest", "Salt Studio", "Halcyon Pictures", "Cinéma Brut"].map(n => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────── FINAL CTA ─────────── */
function FinalCTA() {
  return (
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
          <a href="studio.html" className="btn btn-primary">Start creating <I.arrow /></a>
          <button className="btn btn-ghost">Talk to the team</button>
        </div>
        <div className="caption" style={{ marginTop: 8 }}>
          Private beta · 7-day creative trial · No credit card required
        </div>
      </div>
    </section>
  );
}

/* ─────────── FOOTER ─────────── */
function Footer() {
  const cols = {
    "Product": ["Studio", "Conversational editor", "Workflows", "Exports", "Changelog"],
    "Resources": ["Documentation", "Style guides", "Roundtrip presets", "Community", "Status"],
    "Company": ["Manifesto", "Studios", "Careers", "Press", "Contact"],
  };
  return (
    <footer style={{ borderTop: "0.5px solid var(--line)", padding: "64px 0 32px", background: "var(--bg)" }}>
      <div className="wrap" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 56 }} className="footer-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Logo size={32} />
          <p className="body" style={{ fontSize: 13.5, margin: 0, maxWidth: 280 }}>
            The creative operating system for modern storytellers, editors and studios.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <span className="tag"><span className="dot" />All systems normal</span>
          </div>
        </div>
        {Object.entries(cols).map(([k, items]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="mono" style={{ color: "var(--fg-4)" }}>{k.toUpperCase()}</div>
            {items.map(it => (
              <a key={it} href="#" style={{ fontSize: 13.5, color: "var(--fg-2)" }}>{it}</a>
            ))}
          </div>
        ))}
      </div>
      <div className="wrap" style={{ marginTop: 56, paddingTop: 24, borderTop: "0.5px solid var(--line-soft)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <span className="caption">© 2026 Vibed Studios — All footage in this page is illustrative.</span>
        <span className="caption">Made with care, for makers.</span>
      </div>
      <style>{`
        @media (max-width: 800px) {
          .footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>
    </footer>
  );
}

window.ValueProps = ValueProps;
window.Workflow = Workflow;
window.Exports = Exports;
window.Control = Control;
window.Testimonials = Testimonials;
window.FinalCTA = FinalCTA;
window.Footer = Footer;
