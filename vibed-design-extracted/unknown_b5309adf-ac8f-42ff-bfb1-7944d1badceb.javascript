/* Shared icons + Logo — load BEFORE other component files */

const I = {
  arrow: (p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  play:  (p) => <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" {...p}><path d="M4 3l9 5-9 5z"/></svg>,
  spark: (p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1"/></svg>,
  wave:  (p) => <svg viewBox="0 0 24 16" width="20" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}><path d="M1 8c2-6 4 6 6 0s4 6 6 0 4 6 6 0 4 6 4 0"/></svg>,
  layers:(p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}><path d="M8 1.5L1.5 5 8 8.5 14.5 5 8 1.5zM2 9.5L8 13l6-3.5M2 12l6 3.5L14 12"/></svg>,
  cursor:(p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}><path d="M3 2.5l5 11 1.6-4.4L14 7.5 3 2.5z"/></svg>,
  link:  (p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M6 10l4-4M5 6.5a3 3 0 014.2 0M11 9.5a3 3 0 01-4.2 0" strokeLinecap="round"/></svg>,
  grid:  (p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}><rect x="1.5" y="1.5" width="5" height="5"/><rect x="9.5" y="1.5" width="5" height="5"/><rect x="1.5" y="9.5" width="5" height="5"/><rect x="9.5" y="9.5" width="5" height="5"/></svg>,
  scissor:(p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><path d="M14 2L5.5 5.5M14 14L5.5 10.5"/></svg>,
  mic:   (p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" {...p}><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14M5.5 14h5"/></svg>,
  send:  (p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M2 8l12-6-4 14-2.5-5.5L2 8z" strokeLinejoin="round"/></svg>,
  check: (p) => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M3 8.5L6.5 12l7-8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  pause: (p) => <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" {...p}><rect x="3" y="3" width="3.5" height="10"/><rect x="9.5" y="3" width="3.5" height="10"/></svg>,
  dot:   (p) => <svg viewBox="0 0 8 8" width="8" height="8" fill="currentColor" {...p}><circle cx="4" cy="4" r="3"/></svg>,
};

const Logo = ({ size = 32 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`vg-${size}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--violet)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill={`url(#vg-${size})`} />
      <path d="M9 11l4.6 11 2.4-5.6 2.4 5.6L23 11"
        stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
    <span style={{
      fontFamily: "var(--f-display)",
      fontSize: Math.round(size * 0.78),
      letterSpacing: "-0.02em",
      lineHeight: 1,
      fontWeight: 400,
    }}>
      Vibed<span style={{ color: "var(--accent)" }}>.</span>
    </span>
  </div>
);

Object.assign(window, { I, Logo });
