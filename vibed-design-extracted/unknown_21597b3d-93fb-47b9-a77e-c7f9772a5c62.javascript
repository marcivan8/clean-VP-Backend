/* ──────────────────────────────────────────────────────────────────
   Conversational editing — interactive demo
   The user picks (or types) a prompt; the timeline + viewer respond.
   ────────────────────────────────────────────────────────────────── */

const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;
const { I: I_d } = window;
const I = I_d; // alias for readability

// Each prompt produces a "result state" that mutates the demo viewer.
// Result shape: { title, badge, clips, beats, edits, response }
const DEMO_PRESETS = [
  {
    prompt: "Make the cold open more cinematic.",
    icon: "spark",
    state: {
      title: "Cold open · cinematic pass",
      pacing: 0.42,
      response: "Pulled wide on the harbour establishing shot, J-cut into Mara’s breath, +4 frames before her line. Added a 28 → 50mm push-in to feel the inhale.",
      edits: [
        "Hold opening frame +12f",
        "J-cut audio under 1.2s",
        "Push-in 28→50mm equivalent",
        "Lower-third disabled",
      ],
      clipsA: [[0,18],[20,22],[44,28],[74,22]],
      clipsB: [[6,22],[30,18],[50,30],[82,16]],
    },
  },
  {
    prompt: "Cut pauses longer than 1.5 seconds.",
    icon: "scissor",
    state: {
      title: "Auto-trim silences",
      pacing: 0.66,
      response: "Detected 14 dead-air gaps in the dialogue track. Trimmed 11 (kept 3 marked as ‘breath’). Net runtime change: −47 seconds.",
      edits: [
        "11 cuts proposed · 3 protected",
        "Crossfade audio 80ms",
        "Re-snap B-roll downstream",
        "−00:00:47 runtime",
      ],
      clipsA: [[0,12],[14,12],[28,12],[42,14],[58,12],[72,14],[88,10]],
      clipsB: [[2,12],[16,14],[34,12],[50,14],[68,12],[84,14]],
    },
  },
  {
    prompt: "Build 3 vertical hooks for short-form.",
    icon: "layers",
    state: {
      title: "Short-form hooks · 3 variants",
      pacing: 0.78,
      response: "Generated three :07 vertical hooks pulled from beats with the highest emotional gradient. Open in the side panel to preview.",
      edits: [
        "Variant A · curiosity gap",
        "Variant B · pattern interrupt",
        "Variant C · cold confession",
        "Auto-reframed 9:16 · safe areas locked",
      ],
      clipsA: [[0,7],[12,7],[24,7]],
      clipsB: [[0,7],[12,7],[24,7]],
    },
  },
  {
    prompt: "Caption with emotional emphasis.",
    icon: "mic",
    state: {
      title: "Emphasis-aware captions",
      pacing: 0.5,
      response: "Aligned captions to your phrasing — emphasised words bolded, soft beats lowercased. Punctuation matches your draft style guide.",
      edits: [
        "Style: editorial · sans · 64pt",
        "Emphasis bold on stressed words",
        "Pauses preserved as ellipses",
        "Reading rate: 13 chars/sec",
      ],
      clipsA: [[0,24],[28,30],[62,32]],
      clipsB: [[6,18],[28,22],[54,28],[86,12]],
    },
  },
  {
    prompt: "Match colour to the previous episode.",
    icon: "wave",
    state: {
      title: "Look match · Ep. 02 reference",
      pacing: 0.55,
      response: "Sampled grade from your prior episode. Lifted shadows +3, warmed midtones by 80K, recovered highlight roll-off. Non-destructive node added.",
      edits: [
        "LUT: Vibed · Editorial Warm",
        "Shadows +3 · Midtones +80K",
        "Skin tone preserve · on",
        "Roundtrip ready for Resolve",
      ],
      clipsA: [[0,16],[20,28],[52,22],[78,20]],
      clipsB: [[4,20],[28,24],[58,22],[84,14]],
    },
  },
];

/* ── Component ── */
function ConversationalDemo() {
  const [activeIdx, setActiveIdx] = useStateD(0);
  const [thinking, setThinking] = useStateD(false);
  const [draftText, setDraftText] = useStateD("");
  const [history, setHistory] = useStateD([
    { role: "assistant", text: "Hey — I’ve scanned the rough cut. What should we sharpen first?" },
  ]);
  const scrollRef = useRefD(null);

  const cur = DEMO_PRESETS[activeIdx];

  // animated "thinking" then reveal
  const trigger = (idx) => {
    setActiveIdx(idx);
    setThinking(true);
    setHistory((h) => [
      ...h,
      { role: "user", text: DEMO_PRESETS[idx].prompt },
    ]);
    setTimeout(() => {
      setThinking(false);
      setHistory((h) => [
        ...h,
        { role: "assistant", text: DEMO_PRESETS[idx].state.response },
      ]);
    }, 950);
  };

  useEffectD(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history.length, thinking]);

  const submitDraft = () => {
    if (!draftText.trim()) return;
    setHistory((h) => [...h, { role: "user", text: draftText.trim() }]);
    setThinking(true);
    setDraftText("");
    setTimeout(() => {
      setThinking(false);
      setHistory((h) => [
        ...h,
        { role: "assistant", text: "Got it. I’ll roll these through the timeline — you can revert any edit with ⌥ Z." },
      ]);
    }, 900);
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 380px",
      gap: 20,
      borderRadius: 24,
      padding: 0,
    }}>
      {/* LEFT — viewer + timeline */}
      <div className="card" style={{ overflow: "hidden", padding: 0, position: "relative" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "0.5px solid var(--line-soft)",
          fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)",
        }}>
          <span>{cur.state.title}</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 6, height: 6, borderRadius: 50, background: "var(--accent)", animation: "pulse-soft 2s infinite" }} />
            live
          </span>
        </div>

        {/* Viewer */}
        <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden",
          background: "radial-gradient(70% 90% at 50% 40%, #1a1d22 0%, #0a0b0d 100%)" }}>
          <ViewerArt key={activeIdx} preset={cur} />
          {thinking && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.4))",
              display: "flex", alignItems: "flex-end", padding: 20,
            }}>
              <div style={{
                padding: "10px 14px", borderRadius: 14,
                background: "rgba(20,22,26,0.7)",
                backdropFilter: "blur(20px)",
                border: "0.5px solid rgba(255,255,255,0.12)",
                display: "flex", alignItems: "center", gap: 10,
                color: "rgba(255,255,255,0.9)", fontSize: 12.5,
              }}>
                <DotsLoader /> Rewriting the timeline…
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div style={{ padding: 16, borderTop: "0.5px solid var(--line-soft)",
          display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 11,
            color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>
            <span style={{ color: "var(--fg-2)" }}>before</span>
            <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            <span style={{ color: "var(--accent)" }}>after Vibed</span>
          </div>
          <DemoTrack clips={cur.state.clipsA} color="var(--fg-3)" muted />
          <DemoTrack clips={cur.state.clipsB} color="var(--accent)" />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {cur.state.edits.map((e) => (
                <span key={e} style={{
                  padding: "5px 9px", borderRadius: 999, fontSize: 11.5,
                  border: "0.5px solid var(--line)", background: "var(--bg-2)",
                  color: "var(--fg-2)",
                }}>{e}</span>
              )).slice(0, 3)}
              {cur.state.edits.length > 3 && (
                <span style={{ padding: "5px 9px", borderRadius: 999, fontSize: 11.5,
                  color: "var(--fg-3)" }}>+{cur.state.edits.length - 3} more</span>
              )}
            </div>
            <button className="btn btn-ghost" style={{ height: 30, padding: "0 12px", fontSize: 12 }}>
              Accept · ↵
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT — chat */}
      <div className="card" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{
          padding: "14px 18px", borderBottom: "0.5px solid var(--line-soft)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 auto", minWidth: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, var(--accent), var(--violet))",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", flexShrink: 0,
            }}><I.spark /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>Editing assistant</div>
              <div className="mono" style={{ color: "var(--fg-4)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>respects your taste</div>
            </div>
          </div>
          <span className="mono" style={{ color: "var(--fg-4)" }}>⌘ /</span>
        </div>

        {/* messages */}
        <div ref={scrollRef} style={{
          flex: 1, padding: 18, display: "flex", flexDirection: "column", gap: 12,
          overflowY: "auto", maxHeight: 360,
        }}>
          {history.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              padding: "10px 14px",
              borderRadius: 14,
              fontSize: 13.5,
              lineHeight: 1.45,
              background: m.role === "user"
                ? "linear-gradient(135deg, var(--accent), var(--violet))"
                : "var(--bg-2)",
              color: m.role === "user" ? "#fff" : "var(--fg)",
              border: m.role === "user" ? "0" : "0.5px solid var(--line)",
              animation: "fadeUp 0.45s cubic-bezier(0.2,0.7,0.2,1) both",
            }}>
              {m.text}
            </div>
          ))}
          {thinking && (
            <div style={{
              alignSelf: "flex-start",
              padding: "10px 14px", borderRadius: 14,
              background: "var(--bg-2)", border: "0.5px solid var(--line)",
              display: "flex", alignItems: "center", gap: 8, color: "var(--fg-3)",
            }}>
              <DotsLoader />
            </div>
          )}
        </div>

        {/* Prompt suggestions */}
        <div style={{ padding: "10px 14px 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DEMO_PRESETS.map((p, i) => (
            <button key={i} onClick={() => trigger(i)}
              style={{
                padding: "6px 10px", fontSize: 11.5, borderRadius: 999,
                border: "0.5px solid var(--line)",
                background: activeIdx === i ? "var(--accent-soft)" : "var(--bg-2)",
                color: activeIdx === i ? "var(--fg)" : "var(--fg-2)",
                cursor: "pointer",
              }}>
              {p.prompt.length > 32 ? p.prompt.slice(0, 30) + "…" : p.prompt}
            </button>
          ))}
        </div>

        {/* Composer */}
        <div style={{ padding: 14, borderTop: "0.5px solid var(--line-soft)", marginTop: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 14,
            border: "0.5px solid var(--line)", background: "var(--bg-2)",
          }}>
            <input
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitDraft(); }}
              placeholder="Ask the assistant to edit…"
              style={{
                flex: 1, background: "transparent", border: 0, outline: 0,
                color: "var(--fg)", fontSize: 13.5, fontFamily: "var(--f-sans)",
              }}
            />
            <button onClick={submitDraft} style={{
              width: 30, height: 30, borderRadius: 8, border: 0,
              background: draftText.trim() ? "var(--accent)" : "var(--bg-3)",
              color: "#fff", cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              <I.send />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .demo-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function DemoTrack({ clips, color, muted }) {
  return (
    <div style={{
      position: "relative", height: 22, borderRadius: 5,
      background: "var(--bg-2)", overflow: "hidden",
      opacity: muted ? 0.55 : 1,
    }}>
      {clips.map(([x, w], i) => (
        <div key={i} style={{
          position: "absolute", left: `${x}%`, width: `${w}%`,
          top: 2, bottom: 2, borderRadius: 3,
          background: muted ? color : `linear-gradient(180deg, color-mix(in oklch, ${color} 75%, white) 0%, ${color} 100%)`,
          border: muted ? "0" : `0.5px solid color-mix(in oklch, ${color} 50%, black)`,
          opacity: muted ? 0.7 : 0.92,
          transition: "all 0.5s cubic-bezier(0.2,0.7,0.2,1)",
        }} />
      ))}
    </div>
  );
}

function DotsLoader() {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: 50, background: "currentColor",
          animation: `pulse-soft 1s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
    </span>
  );
}

/* Per-preset viewer art — abstract "footage" placeholders that change with prompt.
   Original visual language; no third-party UI replication. */
function ViewerArt({ preset }) {
  const i = DEMO_PRESETS.indexOf(preset);
  const looks = [
    // 0 — cold open: harbour + lighthouse
    <div key="0" style={{ position: "absolute", inset: 0,
      background: `linear-gradient(180deg, oklch(0.45 0.05 250) 0%, oklch(0.22 0.04 250) 55%, oklch(0.12 0.02 240) 100%)` }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: "58%", height: 1,
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)" }} />
      <div style={{ position: "absolute", left: "25%", top: "30%", width: 5, height: "30%",
        background: "linear-gradient(180deg, oklch(0.88 0.1 60), transparent)", filter: "blur(0.4px)" }} />
      <div style={{ position: "absolute", left: "24.7%", top: "23%", width: 10, height: 10, borderRadius: 50,
        background: "oklch(0.95 0.13 70)", boxShadow: "0 0 24px oklch(0.95 0.13 70)" }} />
    </div>,
    // 1 — silences cut: waveform
    <div key="1" style={{ position: "absolute", inset: 0,
      background: "radial-gradient(60% 80% at 50% 50%, oklch(0.2 0.04 270) 0%, oklch(0.1 0.02 270) 100%)",
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg viewBox="0 0 400 100" style={{ width: "76%", height: "60%" }} preserveAspectRatio="none">
        {Array.from({ length: 80 }).map((_, j) => {
          const h = 8 + Math.abs(Math.sin(j * 0.7) * 40) + (j % 7 === 0 ? 30 : 0);
          return <rect key={j} x={j * 5} y={50 - h / 2} width="2" height={h}
            fill={j % 7 === 0 ? "var(--accent)" : "rgba(255,255,255,0.55)"} />;
        })}
      </svg>
    </div>,
    // 2 — three vertical hooks
    <div key="2" style={{ position: "absolute", inset: 0, padding: 24, display: "flex",
      gap: 12, alignItems: "center", justifyContent: "center",
      background: "radial-gradient(70% 90% at 50% 50%, oklch(0.2 0.05 295) 0%, oklch(0.08 0.02 295) 100%)" }}>
      {["A", "B", "C"].map((k, j) => (
        <div key={k} style={{
          width: "18%", aspectRatio: "9/16", borderRadius: 10,
          background: `linear-gradient(160deg, oklch(${0.55 - j * 0.08} 0.13 ${250 + j * 30}) 0%, oklch(0.15 0.04 ${250 + j * 30}) 100%)`,
          border: "0.5px solid rgba(255,255,255,0.12)",
          display: "flex", alignItems: "flex-end", padding: 10, justifyContent: "space-between",
          fontFamily: "var(--f-mono)", fontSize: 10, color: "rgba(255,255,255,0.7)",
          position: "relative",
        }}>
          <span style={{
            position: "absolute", top: 8, left: 10, color: "rgba(255,255,255,0.9)",
            fontFamily: "var(--f-display)", fontSize: 20,
          }}>{k}</span>
          <span>:07</span>
          <span>9:16</span>
        </div>
      ))}
    </div>,
    // 3 — caption
    <div key="3" style={{ position: "absolute", inset: 0,
      background: "radial-gradient(70% 90% at 30% 40%, oklch(0.3 0.04 30) 0%, oklch(0.1 0.02 30) 100%)" }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: "20%",
        display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: "76%", textAlign: "center", color: "#fff", fontFamily: "var(--f-display)", lineHeight: 1.1 }}>
          <span style={{ fontSize: 30, opacity: 0.7 }}>i thought i was </span>
          <span style={{ fontSize: 36, fontWeight: 500 }}>done</span>
          <span style={{ fontSize: 30, opacity: 0.7 }}> with the sea.</span>
        </div>
      </div>
    </div>,
    // 4 — colour match split
    <div key="4" style={{ position: "absolute", inset: 0, display: "flex" }}>
      <div style={{ flex: 1, background: "linear-gradient(180deg, oklch(0.5 0.05 260), oklch(0.2 0.03 260))" }} />
      <div style={{ width: 1, background: "rgba(255,255,255,0.3)" }} />
      <div style={{ flex: 1, background: "linear-gradient(180deg, oklch(0.55 0.09 60), oklch(0.22 0.05 40))" }} />
      <div className="mono" style={{ position: "absolute", left: 14, top: 12, fontSize: 10, color: "rgba(255,255,255,0.7)" }}>BEFORE</div>
      <div className="mono" style={{ position: "absolute", right: 14, top: 12, fontSize: 10, color: "rgba(255,255,255,0.85)" }}>AFTER · WARM</div>
    </div>,
  ];
  return (
    <div style={{ position: "absolute", inset: 16, borderRadius: 8, overflow: "hidden",
      border: "0.5px solid rgba(255,255,255,0.06)",
      animation: "fadeUp 0.6s cubic-bezier(0.2,0.7,0.2,1) both" }}>
      {looks[i]}
      <div className="mono" style={{ position: "absolute", left: 12, top: 10, fontSize: 10,
        color: "rgba(255,255,255,0.6)", zIndex: 2 }}>
        A001_C0{12 + i} · 01:14:22:08
      </div>
    </div>
  );
}

window.ConversationalDemo = ConversationalDemo;
