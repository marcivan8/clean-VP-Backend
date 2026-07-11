/* Vibed Studio — app state machine wiring screens together. */

const VDS3 = window.VibedDesignSystem_013733;

const SCRIPTED = [
  {
    match: /caption/i,
    text: "Added burned-in captions across the interview track, synced to the dialogue. Styled with the studio preset.",
    edits: [{ icon: "captions", label: "Captions" }, { icon: "wand-2", label: "Auto-sync" }],
    clip: { track: "captions", label: "CC · synced", accent: true },
  },
  {
    match: /(warm|grade|color|colour)/i,
    text: "Applied a warm grade — lifted shadows toward amber and pulled +6 on temperature. Preview updated.",
    edits: [{ icon: "palette", label: "Warm LUT" }, { icon: "sun", label: "+6 temp" }],
    clip: { track: "video", label: "Grade", accent: true },
  },
  {
    match: /(punch|speaker|zoom|close)/i,
    text: "Punched in on the speaker for the 00:18–00:31 range with a slow push. Reframed to a medium close-up.",
    edits: [{ icon: "crop", label: "Reframe" }, { icon: "move", label: "Slow push" }],
    clip: { track: "video", label: "Push-in", accent: true },
  },
  {
    match: /(tighten|trim|cut|beat|short)/i,
    text: "Tightened the opening — removed 4.2s of dead air before the first line and trimmed two filler pauses.",
    edits: [{ icon: "scissors", label: "−4.2s" }, { icon: "git-merge", label: "2 cuts" }],
    clip: { track: "video", label: "Tightened", accent: true },
  },
];

function StudioApp() {
  const [screen, setScreen] = React.useState("picker");
  const [project, setProject] = React.useState(null);
  const [tool, setTool] = React.useState("edit");
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(18.4);
  const dur = 132;

  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [messages, setMessages] = React.useState([
    { role: "assistant", text: "Imported 38 clips and built a rough cut. What would you like to change first?" },
  ]);
  const [clips, setClips] = React.useState({
    video: [
      { label: "Establishing", len: 2 },
      { label: "Interview A", len: 4, accent: true },
      { label: "B-roll", len: 2 },
      { label: "Interview B", len: 3 },
    ],
    audio: [
      { label: "Room tone", len: 5 },
      { label: "Score", len: 6, accent: false },
    ],
    captions: [
      { label: "CC · auto", len: 7 },
    ],
  });

  // playback tick
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPos((p) => (p >= dur ? 0 : p + 0.25)), 100);
    return () => clearInterval(id);
  }, [playing]);

  const openProject = (p) => { setProject(p); setScreen("editor"); };

  const submit = (text) => {
    const value = (text || draft).trim();
    if (!value) return;
    setMessages((m) => [...m, { role: "user", text: value }]);
    setDraft("");
    setBusy(true);
    setTimeout(() => {
      const rule = SCRIPTED.find((r) => r.match.test(value)) || {
        text: "Done — applied that change and re-conformed the timeline. Take a look at the preview.",
        edits: [{ icon: "check", label: "Applied" }],
        clip: { track: "video", label: "Edit", accent: true },
      };
      setMessages((m) => [...m, { role: "assistant", text: rule.text, edits: rule.edits }]);
      if (rule.clip) {
        setClips((c) => {
          const next = { ...c, video: [...c.video], audio: [...c.audio], captions: [...c.captions] };
          next[rule.clip.track] = [...next[rule.clip.track], { label: rule.clip.label, len: 2, accent: rule.clip.accent }];
          return next;
        });
      }
      setBusy(false);
    }, 1400);
  };

  if (screen === "picker") {
    return <window.ProjectPicker onOpen={openProject} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div className="film-grain" />
      <window.TopBar project={project ? project.name : "Untitled"} onBack={() => setScreen("picker")}
        collaborators={[{ name: "Ana Ruiz", status: "online" }, { name: "Theo Vance", status: "render" }]} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <window.ToolRail active={tool} onSelect={setTool} />
        <window.PreviewStage playing={playing} onTogglePlay={() => setPlaying((p) => !p)}
          pos={pos} dur={dur} onSeek={setPos} />
        <window.ConversationPanel messages={messages} draft={draft} setDraft={setDraft} onSubmit={submit} busy={busy} />
      </div>
      <window.Timeline clips={clips} pos={pos} dur={dur} />
    </div>
  );
}

Object.assign(window, { StudioApp });
