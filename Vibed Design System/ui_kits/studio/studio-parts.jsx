/* Vibed Studio — shared UI parts. Exposed on window for cross-file use. */

const VDS = window.VibedDesignSystem_013733;

function toTimecode(sec) {
  const f = Math.floor((sec % 1) * 24).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  return `${m}:${s}:${f}`;
}

/* ---- Top transport / project bar -------------------------------- */
function TopBar({ project, onBack, collaborators }) {
  const { IconButton, Icon, Badge, Avatar } = VDS;
  return (
    <header style={{
      display: "flex", alignItems: "center", gap: 16,
      height: 56, padding: "0 16px", flexShrink: 0,
      borderBottom: "1px solid var(--border-hairline)",
      background: "rgba(10,10,11,0.7)", backdropFilter: "var(--blur-glass)",
      position: "relative", zIndex: 5,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src="../../assets/logo.png" width="26" height="26" alt="Vibed" />
        <span style={{ fontFamily: "var(--f-display)", fontSize: 20, color: "var(--text-strong)" }}>Vibed</span>
      </div>
      <span style={{ width: 1, height: 22, background: "var(--border-hairline)" }} />
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 7, border: "none", background: "none", cursor: "pointer",
        fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-body)", padding: 0,
      }}>
        <Icon name="chevron-left" size={16} />
        {project}
      </button>
      <Badge tone="violet">Rendering · 38%</Badge>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {collaborators.map((c, i) => (
            <span key={c.name} style={{ marginLeft: i ? -8 : 0 }}>
              <Avatar name={c.name} status={c.status} size={28} />
            </span>
          ))}
        </div>
        <IconButton icon={<Icon name="share-2" size={18} />} label="Share" />
        <VDS.Button variant="glass" iconLeft={<Icon name="download" size={15} />}>Export</VDS.Button>
      </div>
    </header>
  );
}

/* ---- Left tool rail --------------------------------------------- */
function ToolRail({ active, onSelect }) {
  const { IconButton, Icon } = VDS;
  const tools = [
    { id: "edit", icon: "scissors", label: "Edit" },
    { id: "generate", icon: "sparkles", label: "Generate" },
    { id: "captions", icon: "captions", label: "Captions" },
    { id: "color", icon: "palette", label: "Color" },
    { id: "audio", icon: "volume-2", label: "Audio" },
    { id: "layers", icon: "layers", label: "Layers" },
  ];
  return (
    <nav style={{
      width: 60, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center",
      gap: 6, padding: "14px 0", borderRight: "1px solid var(--border-hairline)",
      background: "rgba(18,18,20,0.5)", position: "relative", zIndex: 4,
    }}>
      {tools.map((t) => (
        <IconButton key={t.id} icon={<Icon name={t.icon} size={19} />} label={t.label}
          active={active === t.id} onClick={() => onSelect(t.id)} size={40} />
      ))}
      <div style={{ marginTop: "auto" }}>
        <IconButton icon={<Icon name="settings" size={19} />} label="Settings" size={40} />
      </div>
    </nav>
  );
}

/* ---- Center preview stage --------------------------------------- */
function PreviewStage({ playing, onTogglePlay, pos, dur, onSeek }) {
  const { IconButton, Icon, Slider, Tag } = VDS;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, padding: 18, gap: 14 }}>
      {/* video frame */}
      <div style={{
        position: "relative", flex: 1, borderRadius: "var(--radius-lg)", overflow: "hidden",
        border: "1px solid var(--border-hairline)", boxShadow: "var(--shadow-lg), var(--shadow-glass-top)",
        background: "radial-gradient(120% 90% at 30% 20%, #123042, #0a0a0b 70%)",
        display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0,
      }}>
        {/* cinematic placeholder footage */}
        <div style={{ position: "absolute", inset: 0, background:
          "radial-gradient(40% 55% at 62% 58%, rgba(0,229,255,0.18), transparent 60%), radial-gradient(45% 50% at 25% 75%, rgba(138,43,226,0.16), transparent 65%)" }} />
        <div className="film-grain" style={{ position: "absolute", opacity: 0.06 }} />
        <div style={{ position: "relative", textAlign: "center", color: "var(--text-faint)" }}>
          <Icon name="clapperboard" size={34} />
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 8 }}>Scene 04 · Interview</div>
        </div>
        {/* overlay chrome */}
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
          <Tag>4K · ProRes</Tag>
          <Tag>{toTimecode(pos)}</Tag>
        </div>
        <div style={{ position: "absolute", top: 12, right: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-body)" }}>
            <span className="traffic-dot rec" />REC 00:42
          </span>
        </div>
      </div>

      {/* transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <IconButton icon={<Icon name="skip-back" size={18} />} label="Start" />
          <IconButton variant="solid" icon={<Icon name={playing ? "pause" : "play"} size={18} />} label={playing ? "Pause" : "Play"} onClick={onTogglePlay} />
          <IconButton icon={<Icon name="skip-forward" size={18} />} label="End" />
        </div>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--text-body)" }}>{toTimecode(pos)}</span>
        <div style={{ flex: 1 }}>
          <Slider value={pos} max={dur} step={0.04} onChange={onSeek} />
        </div>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--text-faint)" }}>{toTimecode(dur)}</span>
      </div>
    </div>
  );
}

/* ---- Bottom timeline -------------------------------------------- */
function Timeline({ clips, pos, dur }) {
  const { Icon } = VDS;
  const tracks = [
    { name: "V1", icon: "film", items: clips.video },
    { name: "A1", icon: "audio-lines", items: clips.audio },
    { name: "CC", icon: "captions", items: clips.captions },
  ];
  const playhead = (pos / dur) * 100;
  return (
    <div style={{
      height: 168, flexShrink: 0, borderTop: "1px solid var(--border-hairline)",
      background: "rgba(18,18,20,0.6)", padding: "10px 16px", display: "flex", flexDirection: "column", gap: 7,
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)" }}>Timeline</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text-faint)" }}>{clips.video.length + clips.audio.length} clips · {Math.round(dur/60)}m</span>
      </div>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        {/* playhead */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(34px + ${playhead}% * 0.93)`, width: 1.5, background: "var(--cyan-500)", boxShadow: "var(--glow-cyan-soft)", zIndex: 3 }}>
          <div style={{ position: "absolute", top: -2, left: -4, width: 9, height: 9, borderRadius: "50%", background: "var(--cyan-500)", boxShadow: "var(--glow-dot)" }} />
        </div>
        {tracks.map((tr) => (
          <div key={tr.name} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <span style={{ width: 26, display: "flex", alignItems: "center", gap: 0, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text-faint)" }}>{tr.name}</span>
            <div style={{ flex: 1, display: "flex", gap: 4, height: "100%" }}>
              {tr.items.map((c, i) => (
                <div key={i} style={{
                  flex: c.len, minWidth: 0, borderRadius: 5, padding: "4px 8px",
                  display: "flex", alignItems: "center", gap: 6, overflow: "hidden",
                  border: "1px solid",
                  borderColor: c.accent ? "var(--border-strong)" : "var(--border-hairline)",
                  background: c.accent ? "var(--grad-accent-soft)" : "var(--surface-card-strong)",
                  boxShadow: c.accent ? "var(--glow-cyan-soft)" : "none",
                }}>
                  <Icon name={tr.icon} size={12} color="var(--text-muted)" />
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text-body)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { TopBar, ToolRail, PreviewStage, Timeline, toTimecode });
