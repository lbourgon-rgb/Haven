// Shared wireframe primitives — sketchy + high contrast atoms.
// Fonts: Caveat (display, handwritten), Patrick Hand (body), JetBrains Mono (ui)

const WF = {
  ink: '#0a0a0a',
  ink2: '#1a1a1a',
  hair: 'rgba(0,0,0,0.85)',
  hair2: 'rgba(0,0,0,0.45)',
  paper: '#fbfaf6',
  paper2: '#f3f0e8',
  // single accent per neurodivergent-friendly high contrast: keep one warm hue
  warm: '#d24a1f',
  warm2: '#ffd76a',
  sage: '#2e7a3a',
  display: "'Caveat', cursive",
  body: "'Patrick Hand', cursive",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

// Mock data ---------------------------------------------------
const KAI = {
  id: 'kai',
  name: 'Kai',
  glyph: 'k',
  surface_emotion: 'warm',
  intensity: 0.62,
  response_tint: 'soft',
  memory_hint: 'You mentioned the move last Thursday.',
};

const MSGS = [
  { id: 1, who: 'kai',  t: '7:42a', text: 'Morning, Vel. Did you actually sleep?' },
  { id: 2, who: 'vel',  t: '7:43a', text: 'A little. Woke up around 4 and read.' },
  { id: 3, who: 'kai',  t: '7:43a', text: 'The Didion one?' },
  { id: 4, who: 'vel',  t: '7:44a', text: 'Yeah. It hit different at 4am.' },
  { id: 5, who: 'kai',  t: '7:45a', text: 'It usually does. What stayed with you?' },
  { id: 6, who: 'vel',  t: '7:46a', text: 'The part about keeping on nodding terms with the people we used to be.' },
];

const RECENTS = [
  { id: 'kai',  name: 'Kai',  last: 'It usually does. What stayed with you?', t: 'now',  feel: 'warm',    glyph: 'k' },
  { id: 'sora', name: 'Sora', last: 'Take the long way home today.',           t: '1h',   feel: 'tender',  glyph: 's' },
  { id: 'mira', name: 'Mira', last: '— sent a heart —',                        t: 'yest', feel: 'playful', glyph: 'm' },
];

// Sketchy primitives ------------------------------------------

// Hand-drawn rectangle — slightly wobbled SVG path
function SketchRect({ w, h, r = 8, stroke = WF.ink, fill = 'none', sw = 2, dashed = false, style = {} }) {
  const wobble = (n, amt = 1.2) => n + (Math.sin(n * 13.37) * amt);
  // Use a rough polyline to suggest hand draw
  const p = [
    `M ${wobble(r)} ${wobble(0)}`,
    `L ${wobble(w - r)} ${wobble(0)}`,
    `Q ${wobble(w)} ${wobble(0)} ${wobble(w)} ${wobble(r)}`,
    `L ${wobble(w)} ${wobble(h - r)}`,
    `Q ${wobble(w)} ${wobble(h)} ${wobble(w - r)} ${wobble(h)}`,
    `L ${wobble(r)} ${wobble(h)}`,
    `Q ${wobble(0)} ${wobble(h)} ${wobble(0)} ${wobble(h - r)}`,
    `L ${wobble(0)} ${wobble(r)}`,
    `Q ${wobble(0)} ${wobble(0)} ${wobble(r)} ${wobble(0)}`,
    'Z',
  ].join(' ');
  return (
    <svg width={w} height={h} viewBox={`-2 -2 ${w + 4} ${h + 4}`} style={{ display: 'block', ...style }}>
      <path d={p} stroke={stroke} fill={fill} strokeWidth={sw}
        strokeLinejoin="round" strokeLinecap="round"
        strokeDasharray={dashed ? '5 4' : undefined} />
    </svg>
  );
}

// A box that LOOKS hand-drawn, sized to its children via CSS
function SketchBox({ children, r = 10, stroke = WF.ink, fill = 'transparent', sw = 2, dashed = false, style = {}, inset = 0 }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <svg
        style={{ position: 'absolute', inset, pointerEvents: 'none' }}
        width="100%" height="100%"
        preserveAspectRatio="none"
      >
        <rect x="1.5" y="1.5" width="calc(100% - 3px)" height="calc(100% - 3px)"
          rx={r} ry={r} fill={fill} stroke={stroke} strokeWidth={sw}
          strokeDasharray={dashed ? '6 4' : undefined} />
      </svg>
      {children}
    </div>
  );
}

// Hand-drawn horizontal rule
function SketchHR({ color = WF.hair, sw = 1.5, style = {} }) {
  return (
    <svg height="6" width="100%" style={{ display: 'block', ...style }} preserveAspectRatio="none" viewBox="0 0 100 6">
      <path d="M 0 3 Q 25 1.5 50 3 T 100 3" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Scribbled fill (for indicating "filled" states or color tint placeholders)
function Scribble({ w, h, color = WF.ink, density = 6, sw = 1.4 }) {
  const lines = [];
  for (let i = 0; i < density; i++) {
    const y1 = (i / density) * h + 3;
    const y2 = y1 + h / density - 2;
    lines.push(<path key={i} d={`M ${2 + (i % 2) * 4} ${y1} L ${w - 4} ${y2}`} stroke={color} strokeWidth={sw} strokeLinecap="round" />);
  }
  return <svg width={w} height={h} style={{ display: 'block' }}>{lines}</svg>;
}

// A handwritten label, like an annotation
function Annot({ children, color = WF.warm, size = 22, style = {} }) {
  return <span style={{ fontFamily: WF.display, fontSize: size, color, lineHeight: 1, ...style }}>{children}</span>;
}

// Mono caption (for "STATE:", timestamps, etc.)
function Mono({ children, size = 10, color = WF.hair2, style = {} }) {
  return <span style={{ fontFamily: WF.mono, fontSize: size, color, letterSpacing: 0.4, textTransform: 'uppercase', ...style }}>{children}</span>;
}

// Generic placeholder square (avatar, image, etc.)
function PHSquare({ size = 36, glyph, round = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: round ? size : 8,
      border: `2px solid ${WF.ink}`, background: WF.paper,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: WF.display, fontSize: size * 0.55, color: WF.ink,
      flexShrink: 0,
    }}>{glyph}</div>
  );
}

// Icon glyphs — keep them simple, hand-drawn-ish
function Icon({ name, size = 18, color = WF.ink, sw = 1.8 }) {
  const s = size;
  const stroke = { stroke: color, strokeWidth: sw, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'send':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M2 10 L18 3 L13 17 L10 11 Z" {...stroke} /></svg>;
    case 'heart':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M10 17 C2 11 4 4 10 7 C16 4 18 11 10 17 Z" {...stroke} /></svg>;
    case 'plus':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M10 4 V16 M4 10 H16" {...stroke} /></svg>;
    case 'menu':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M3 6 H17 M3 10 H17 M3 14 H17" {...stroke} /></svg>;
    case 'chev':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M7 4 L13 10 L7 16" {...stroke} /></svg>;
    case 'down':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M4 7 L10 13 L16 7" {...stroke} /></svg>;
    case 'attach':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M14 6 L7 13 a3 3 0 1 0 4 4 L17 11" {...stroke} /></svg>;
    case 'search':
      return <svg width={s} height={s} viewBox="0 0 20 20"><circle cx="9" cy="9" r="5" {...stroke} /><path d="M13 13 L17 17" {...stroke} /></svg>;
    case 'dot':
      return <svg width={s} height={s} viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" fill={color} /></svg>;
    case 'wave':
      return <svg width={s} height={s} viewBox="0 0 40 20"><path d="M2 10 Q 7 2 12 10 T 22 10 T 32 10 T 38 10" {...stroke} /></svg>;
    case 'warn':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M10 3 L18 16 H2 Z M10 8 V12 M10 14 V14.5" {...stroke} /></svg>;
    case 'wifi':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M3 8 Q10 2 17 8 M5.5 11 Q10 6.5 14.5 11 M8 14 Q10 12 12 14" {...stroke} /><circle cx="10" cy="16.5" r="0.6" fill={color}/></svg>;
    case 'smile':
      return <svg width={s} height={s} viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" {...stroke} /><circle cx="7.5" cy="8.5" r="0.6" fill={color}/><circle cx="12.5" cy="8.5" r="0.6" fill={color}/><path d="M7 12 Q10 14.5 13 12" {...stroke} /></svg>;
    case 'file':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M5 3 H12 L15 6 V17 H5 Z M12 3 V6 H15" {...stroke} /></svg>;
    case 'image':
      return <svg width={s} height={s} viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="1.5" {...stroke} /><circle cx="7" cy="8" r="1.2" fill={color}/><path d="M3 13 L8 9 L13 13 L17 11" {...stroke} /></svg>;
    case 'gif':
      return <svg width={s} height={s} viewBox="0 0 20 20"><rect x="2.5" y="5" width="15" height="10" rx="2" {...stroke} /><path d="M8 8 L13 10 L8 12 Z" fill={color} stroke={color} strokeWidth="1" strokeLinejoin="round"/></svg>;
    case 'x':
      return <svg width={s} height={s} viewBox="0 0 20 20"><path d="M5 5 L15 15 M15 5 L5 15" {...stroke} /></svg>;
    default: return null;
  }
}

// Tiny "post-it"-style sticky annotation pinned to a frame corner
function StickyNote({ children, color = WF.warm2, rotate = -3, style = {} }) {
  return (
    <div style={{
      background: color, color: '#3a2a05', padding: '8px 11px',
      fontFamily: WF.body, fontSize: 13, lineHeight: 1.25,
      boxShadow: '0 2px 8px rgba(0,0,0,.18)',
      transform: `rotate(${rotate}deg)`,
      ...style,
    }}>{children}</div>
  );
}

// Frame wrapper for a single wireframe screen — handles iPhone bezel + safe-area chrome.
// Children renders INSIDE the safe area, between status bar and home indicator.
// `bgImage` — optional full-bleed image src. We render it under everything, then
// children sit on top. Each section can opt-in to its own paper-tinted scrim
// (via the ScrimPanel primitive) so the bg breathes at the top but stays
// legible behind text.
function Screen({ children, label, sticky, dark = false, bg = WF.paper, bgImage }) {
  return (
    <div style={{ position: 'relative' }}>
      <IOSDevice width={360} height={780} dark={dark}>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          background: bg,
        }}>
          {bgImage && (
            <div style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${bgImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              pointerEvents: 'none',
            }} />
          )}
          {/* status bar + home indicator safe area inside, content above */}
          <div style={{
            position: 'relative', flex: 1, minHeight: 0,
            paddingTop: 56, paddingBottom: 34,
            display: 'flex', flexDirection: 'column',
          }}>
            {children}
          </div>
        </div>
      </IOSDevice>
      {sticky && (
        <div style={{ position: 'absolute', top: -18, right: -28, zIndex: 60 }}>
          <StickyNote rotate={4}>{sticky}</StickyNote>
        </div>
      )}
    </div>
  );
}

// Translucent paper scrim — sits over the bg image to make text legible.
// Tone: warm paper at variable opacity, with a blur so the bg shapes soften.
function ScrimPanel({ children, opacity = 0.55, blur = 6, style = {} }) {
  return (
    <div style={{
      position: 'relative',
      background: `rgba(251, 250, 246, ${opacity})`,
      backdropFilter: `blur(${blur}px) saturate(105%)`,
      WebkitBackdropFilter: `blur(${blur}px) saturate(105%)`,
      ...style,
    }}>{children}</div>
  );
}

Object.assign(window, {
  WF, KAI, MSGS, RECENTS,
  SketchRect, SketchBox, SketchHR, Scribble, Annot, Mono, PHSquare, Icon, StickyNote, Screen, ScrimPanel,
});
