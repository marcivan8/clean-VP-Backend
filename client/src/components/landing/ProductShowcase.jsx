/**
 * ProductShowcase.jsx
 * Styled product screenshot components for the VIBED landing page.
 *
 * ── Screenshot file mapping ────────────────────────────────────────────────
 * Copy these files to:  client/public/screenshots/
 *
 *   editor-full.png     ← the wide desktop shot showing video preview,
 *                          timeline, AI panel on the right, media bin on left
 *
 *   ai-command.png      ← narrow AI panel with "remove silences and filler
 *                          words" typed in the input at the bottom
 *
 *   ai-result.png       ← narrow AI panel showing "Planning edits…",
 *                          "49 modifications", Accepter / Rejeter buttons
 *
 *   timeline-clean.png  ← timeline after silence removal — many short blue
 *                          segments (Segment 4, 5, 9, 14…)
 *
 *   export-modal.png    ← "Export Media — NLE Project" modal with the four
 *                          coloured NLE format cards
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Usage in HomePage.jsx:
 *   import { EditorHeroShot, CommandToEditFlow, NLEExportShowcase }
 *     from '../components/landing/ProductShowcase';
 */

import React from 'react';

// ── Screenshot paths ──────────────────────────────────────────────────────────
const S = {
  editorFull:  '/screenshots/editor-full.png',
  aiCommand:   '/screenshots/ai-command.png',
  aiResult:    '/screenshots/ai-result.png',
  timeline:    '/screenshots/timeline-clean.png',
  exportModal: '/screenshots/export-modal.png',
};

// ── Inject keyframes once (no CSS file dependency) ────────────────────────────
let _kfInjected = false;
function injectKeyframes() {
  if (_kfInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = `
    @keyframes vibed-dot-breathe {
      0%, 100% { opacity: .65; transform: scale(1); }
      50%       { opacity: 1;   transform: scale(1.35); }
    }
  `;
  document.head.appendChild(el);
  _kfInjected = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** macOS-style window chrome for desktop screenshots */
const DesktopFrame = ({ title, children, accentGlow, style = {} }) => {
  React.useEffect(injectKeyframes, []);
  return (
    <div style={{
      borderRadius: 16,
      overflow: 'hidden',
      background: '#0b0b0e',
      border: '0.5px solid rgba(255,255,255,0.09)',
      boxShadow: [
        '0 2px 4px rgba(0,0,0,.35)',
        '0 16px 48px rgba(0,0,0,.65)',
        '0 56px 96px rgba(0,0,0,.45)',
        accentGlow ? `0 0 100px ${accentGlow}1a` : '',
      ].filter(Boolean).join(', '),
      ...style,
    }}>
      {/* Title bar */}
      <div style={{
        height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 8,
        background: 'rgba(255,255,255,0.022)',
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        position: 'relative',
      }}>
        {['#FF5F57', '#FFBD2E', '#28CA41'].map((c, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
        ))}
        {title && (
          <span style={{
            position: 'absolute', left: 0, right: 0, textAlign: 'center',
            pointerEvents: 'none', userSelect: 'none',
            fontSize: 11.5, fontWeight: 500,
            color: 'rgba(255,255,255,0.28)',
            letterSpacing: '0.01em',
          }}>
            {title}
          </span>
        )}
      </div>
      {children}
    </div>
  );
};

/** Simple card frame for the narrow AI assistant panel screenshots */
const PanelFrame = ({ children, style = {} }) => (
  <div style={{
    borderRadius: 14,
    overflow: 'hidden',
    background: '#0b0b0e',
    border: '0.5px solid rgba(255,255,255,0.09)',
    boxShadow: '0 12px 40px rgba(0,0,0,.6)',
    ...style,
  }}>
    {children}
  </div>
);

/** Floating annotation pill — appears on top of screenshots */
const FloatTag = ({ children, dot = '#6b6ef9', style = {} }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 7,
    padding: '5px 13px',
    background: 'rgba(7,7,11,0.84)',
    border: '0.5px solid rgba(255,255,255,0.13)',
    borderRadius: 100,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    fontSize: 11.5, fontWeight: 500,
    color: 'rgba(255,255,255,0.82)',
    whiteSpace: 'nowrap',
    boxShadow: '0 4px 20px rgba(0,0,0,.45)',
    ...style,
  }}>
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: dot, flexShrink: 0,
      animation: 'vibed-dot-breathe 2.6s ease-in-out infinite',
    }} />
    {children}
  </div>
);

/** Numbered step label above each panel */
const Step = ({ n, text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
    <div style={{
      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
      background: 'rgba(107,110,249,0.12)',
      border: '0.5px solid rgba(107,110,249,0.32)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700,
      color: 'var(--accent, #6b6ef9)',
    }}>
      {n}
    </div>
    <span style={{
      fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em',
      color: 'rgba(255,255,255,0.38)',
      textTransform: 'uppercase',
    }}>
      {text}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 1 — EditorHeroShot
// Full desktop editor in a mac frame with floating annotation tags.
// Replaces the static <HeroFrame /> / editor-preview.png in the Hero section.
// ─────────────────────────────────────────────────────────────────────────────
export const EditorHeroShot = ({ style = {} }) => (
  <div style={{ position: 'relative', ...style }}>

    {/* Ambient purple glow behind the frame */}
    <div style={{
      position: 'absolute',
      top: '18%', left: '6%', right: '6%', bottom: '-10%',
      background: 'radial-gradient(ellipse at 50% 42%, rgba(107,110,249,0.17) 0%, transparent 65%)',
      pointerEvents: 'none',
    }} />

    <DesktopFrame title="VIBED Studio" accentGlow="#6b6ef9">
      <img
        src={S.editorFull}
        alt="VIBED Studio — full editor"
        style={{ width: '100%', display: 'block' }}
      />
    </DesktopFrame>

    {/* Floating labels — adjust % positions to match your screenshot */}
    <div style={{ position: 'absolute', top: '13%', left: '1.5%', zIndex: 10 }}>
      <FloatTag dot="#6b6ef9">Media bin</FloatTag>
    </div>
    <div style={{ position: 'absolute', top: '9%', right: '2%', zIndex: 10 }}>
      <FloatTag dot="#6b6ef9">AI Assistant</FloatTag>
    </div>
    <div style={{
      position: 'absolute', bottom: '8%',
      left: '50%', transform: 'translateX(-50%)',
      zIndex: 10,
    }}>
      <FloatTag dot="#f97316">Timeline</FloatTag>
    </div>

  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 2 — CommandToEditFlow
// 3-step sequence: type command → AI executes → timeline updated.
// Use this in the "type what to cut" feature section of the landing page.
// ─────────────────────────────────────────────────────────────────────────────
export const CommandToEditFlow = ({ style = {} }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 24, ...style }}>

    {/* Steps 1 + 2: AI panels, side by side */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16,
      alignItems: 'end',
    }}>
      <div>
        <Step n="1" text="Type the command" />
        <PanelFrame>
          <img src={S.aiCommand} alt="Type command" style={{ width: '100%', display: 'block' }} />
        </PanelFrame>
      </div>
      <div>
        <Step n="2" text="VIBED plans &amp; executes" />
        <PanelFrame>
          <img src={S.aiResult} alt="AI executing edit" style={{ width: '100%', display: 'block' }} />
        </PanelFrame>
      </div>
    </div>

    {/* Connector: "49 modifications applied" */}
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{
        flex: 1, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(107,110,249,0.22))',
      }} />
      <div style={{
        padding: '7px 20px', flexShrink: 0,
        borderRadius: 100,
        background: 'rgba(107,110,249,0.08)',
        border: '0.5px solid rgba(107,110,249,0.2)',
        fontSize: 12.5, color: 'rgba(255,255,255,0.48)',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <span style={{ color: 'var(--accent, #6b6ef9)', fontWeight: 700 }}>49</span>
        modifications applied
      </div>
      <div style={{
        flex: 1, height: 1,
        background: 'linear-gradient(90deg, rgba(107,110,249,0.22), transparent)',
      }} />
    </div>

    {/* Step 3: timeline result */}
    <div>
      <Step n="3" text="Accept or reject — timeline updated" />
      <DesktopFrame title="Timeline" accentGlow="#28CA41">
        <div style={{ position: 'relative' }}>
          <img
            src={S.timeline}
            alt="Timeline after silence removal"
            style={{ width: '100%', display: 'block' }}
          />
          <div style={{ position: 'absolute', top: '20%', left: '1.5%', zIndex: 10 }}>
            <FloatTag dot="#28CA41">Silences removed</FloatTag>
          </div>
          <div style={{ position: 'absolute', top: '20%', right: '1.5%', zIndex: 10 }}>
            <FloatTag dot="#28CA41">Non-destructive</FloatTag>
          </div>
        </div>
      </DesktopFrame>
    </div>

  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 3 — NLEExportShowcase
// Export modal in a desktop frame with a green accent glow.
// Slot this into the Exports section of the landing page.
// ─────────────────────────────────────────────────────────────────────────────
export const NLEExportShowcase = ({ style = {} }) => (
  <div style={{ position: 'relative', ...style }}>

    {/* Ambient green glow */}
    <div style={{
      position: 'absolute',
      top: '8%', left: '18%', right: '18%', bottom: '-8%',
      background: 'radial-gradient(ellipse at 50% 50%, rgba(40,202,65,0.11) 0%, transparent 65%)',
      pointerEvents: 'none',
    }} />

    <DesktopFrame title="Export Media — NLE Project" accentGlow="#28CA41" style={{ position: 'relative' }}>
      <img
        src={S.exportModal}
        alt="NLE export options — Premiere Pro, Final Cut Pro, DaVinci Resolve, OpenTimelineIO"
        style={{ width: '100%', display: 'block' }}
      />
    </DesktopFrame>

  </div>
);
