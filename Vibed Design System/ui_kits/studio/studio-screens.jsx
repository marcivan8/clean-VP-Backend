/* Vibed Studio — conversation panel + screens. */

const VDS2 = window.VibedDesignSystem_013733;

/* ---- Conversation / edit-history panel + prompt ----------------- */
function ConversationPanel({ messages, draft, setDraft, onSubmit, busy }) {
  const { PromptBar, Icon, Avatar } = VDS2;
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  return (
    <aside style={{
      width: 372, flexShrink: 0, display: "flex", flexDirection: "column",
      borderLeft: "1px solid var(--border-hairline)", background: "rgba(18,18,20,0.45)",
      position: "relative", zIndex: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "16px 18px", borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="traffic-dot" />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-strong)" }}>Director</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-faint)" }}>{messages.filter(m=>m.role==="user").length} prompts</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.map((m, i) => <MessageBubble key={i} m={m} />)}
        {busy && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-muted)" }}>
            <span className="traffic-dot violet" style={{ animation: "vibedPulse 1.1s ease-in-out infinite" }} />
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, letterSpacing: "0.06em" }}>Applying edit…</span>
          </div>
        )}
      </div>

      <div style={{ padding: 16, borderTop: "1px solid var(--border-hairline)" }}>
        <PromptBar value={draft} onChange={setDraft} onSubmit={onSubmit} busy={busy}
          placeholder="Describe an edit…"
          suggestions={messages.length <= 2 ? ["Add captions", "Punch in on speaker", "Warm the grade"] : []} />
      </div>
      <style>{`@keyframes vibedPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </aside>
  );
}

function MessageBubble({ m }) {
  const { Icon, Tag } = VDS2;
  if (m.role === "user") {
    return (
      <div style={{ alignSelf: "flex-end", maxWidth: "86%" }}>
        <div style={{
          background: "var(--grad-accent-soft)", border: "1px solid var(--border-strong)",
          borderRadius: "14px 14px 4px 14px", padding: "10px 14px",
          fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-strong)", lineHeight: 1.45,
        }}>{m.text}</div>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: "92%", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        background: "var(--surface-card)", border: "1px solid var(--border-hairline)",
        borderRadius: "4px 14px 14px 14px", padding: "12px 14px",
        boxShadow: "var(--shadow-glass-top)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
          <Icon name="sparkles" size={14} color="var(--accent)" />
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>Vibed</span>
        </div>
        <div style={{ fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-body)", lineHeight: 1.5 }}>{m.text}</div>
        {m.edits && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {m.edits.map((e, i) => <Tag key={i} icon={<Icon name={e.icon} size={12} />}>{e.label}</Tag>)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Project picker (landing) ----------------------------------- */
function ProjectPicker({ onOpen }) {
  const { Card, Badge, Button, Icon, Avatar } = VDS2;
  const projects = [
    { name: "Founder interview", meta: "4K · 12:04 · 38 clips", status: "cyan", statusLabel: "Ready", tint: "#123042" },
    { name: "Product launch teaser", meta: "1080p · 0:48 · 14 clips", status: "violet", statusLabel: "Rendering", tint: "#2a1a42" },
    { name: "Travel recap — Lisbon", meta: "4K · 3:22 · 61 clips", status: "neutral", statusLabel: "Draft", tint: "#0f2a2e" },
  ];
  return (
    <div style={{ position: "relative", minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px", overflow: "hidden" }}>
      <div className="aurora" />
      <div className="film-grain" />
      <header style={{ position: "relative", zIndex: 2, width: "100%", maxWidth: 1080, display: "flex", alignItems: "center", gap: 12, padding: "22px 0" }}>
        <img src="../../assets/logo.png" width="30" height="30" alt="Vibed" />
        <span style={{ fontFamily: "var(--f-display)", fontSize: 24, color: "var(--text-strong)" }}>Vibed</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-muted)" }}>Projects</span>
          <Avatar name="Ana Ruiz" status="online" size={30} />
        </div>
      </header>

      <div style={{ position: "relative", zIndex: 2, width: "100%", maxWidth: 1080, marginTop: 36 }}>
        <div className="eyebrow" style={{ color: "var(--accent)" }}>● Studio</div>
        <h1 className="display" style={{ fontSize: 60, margin: "12px 0 8px", maxWidth: 740 }}>
          Edit by <em style={{ fontStyle: "italic" }}>talking</em>.
        </h1>
        <p style={{ fontFamily: "var(--f-sans)", fontSize: 17, color: "var(--text-muted)", maxWidth: 520, margin: 0 }}>
          Describe the cut you want — Vibed conforms the timeline, captions and color in real time.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
          <Button variant="primary" iconLeft={<Icon name="plus" size={15} />} onClick={() => onOpen(projects[0])}>New project</Button>
          <Button variant="glass" iconLeft={<Icon name="upload" size={15} />}>Import footage</Button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "40px 0 16px" }}>
          <span className="eyebrow">Recent</span>
          <span style={{ flex: 1, height: 1, background: "var(--border-hairline)" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, paddingBottom: 40 }}>
          {projects.map((p) => (
            <Card key={p.name} interactive onClick={() => onOpen(p)} padding={0} style={{ overflow: "hidden" }}>
              <div style={{ height: 124, position: "relative", background: `radial-gradient(110% 90% at 30% 20%, ${p.tint}, #0a0a0b 75%)` }}>
                <div style={{ position: "absolute", inset: 0, background: "radial-gradient(50% 60% at 65% 60%, rgba(0,229,255,0.14), transparent 60%)" }} />
                <div style={{ position: "absolute", top: 10, left: 10 }}>
                  <Badge tone={p.status} dot={p.status !== "neutral"}>{p.statusLabel}</Badge>
                </div>
                <div style={{ position: "absolute", right: 10, bottom: 10, width: 34, height: 34, borderRadius: "50%", background: "rgba(10,10,11,0.55)", backdropFilter: "blur(8px)", border: "1px solid var(--border-hairline)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="play" size={15} color="var(--text-strong)" />
                </div>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontFamily: "var(--f-display)", fontSize: 21, color: "var(--text-strong)" }}>{p.name}</div>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{p.meta}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ConversationPanel, MessageBubble, ProjectPicker });
