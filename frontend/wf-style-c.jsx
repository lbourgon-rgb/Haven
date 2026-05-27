// Style C — "Halo" — with backgrounds + extended feelings palette.
// Each screen has a full-bleed image bg with a paper scrim behind text.
// The halo band carries the FEELING color (from C_FEEL) sitting on top of the imagery.

// ── Feelings palette ─────────────────────────────────────────
// Pulled from the background imagery: warm sandstone, weathered marble,
// sage + cypress, mountain-mist blues, soft mauve. All swatches sit in a
// muted earth band (chroma 0.03–0.08, lightness 50–65%) so nothing jumps
// out against the cream/sage bgs — they read as part of the same garden.
const C_FEEL = {
  warmth:  { c: '#B5894E', label: 'warmth',  note: 'sun on warm stone' },
  tender:  { c: '#9F7A75', label: 'tender',  note: 'dusty rose-clay' },
  playful: { c: '#C7A65A', label: 'playful', note: 'sunbeam through leaves' },
  joyful:  { c: '#BDA257', label: 'joyful',  note: 'ripe gold' },
  calm:    { c: '#7E9579', label: 'calm',    note: 'leaf sage, settled' },
  focused: { c: '#57727E', label: 'focused', note: 'misted mountain blue' },
  curious: { c: '#6F948D', label: 'curious', note: 'dusty teal' },
  wistful: { c: '#847B92', label: 'wistful', note: 'soft mauve mist' },
  concern: { c: '#8E6A47', label: 'concern', note: 'umber bark' },
  proud:   { c: '#5F7A55', label: 'proud',   note: 'cypress green' },
  tired:   { c: '#8E8A82', label: 'tired',   note: 'weathered stone' },
  neutral: { c: '#A39D92', label: 'neutral', note: 'warm paper stone' },
  offline: { c: '#A39D92', label: 'offline', note: '— neutral —' },
};

const BG_MAIN  = 'images/bg-main.png';
const BG_LIST  = 'images/bg-all-chats.png';
const BG_EMPTY = 'images/bg-empty.png';

// pulse keyframes (intensity breath on the halo)
if (typeof document !== 'undefined' && !document.getElementById('c-pulse-kf')) {
  const s = document.createElement('style');
  s.id = 'c-pulse-kf';
  s.textContent = `
    @keyframes wfhalo { 0%,100%{ opacity: .92 } 50% { opacity: 1 } }
    .wf-halo-bar { animation: wfhalo 3.4s ease-in-out infinite; }
  `;
  document.head.appendChild(s);
}

// Halo band — sits at the very top of the content stack, over the bg image.
// Thicker = stronger intensity. White hairline above + below so it pops on bg.
function C_Halo({ feel = 'warmth', intensity = 0.62, height = 30 }) {
  const f = C_FEEL[feel] || C_FEEL.neutral;
  const bandH = Math.round(height * (0.55 + intensity * 0.55));
  return (
    <div style={{ position: 'relative', height: height + 22 }}>
      <div className="wf-halo-bar" style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: bandH,
        background: f.c,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.6), 0 2px 0 rgba(0,0,0,0.18)`,
      }} />
      {/* hand-drawn wave overlay — suggests breathing */}
      <svg viewBox="0 0 300 28" preserveAspectRatio="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, width: '100%', height: bandH, opacity: 0.32, pointerEvents: 'none' }}>
        <path d={`M 0 ${20} Q 30 ${10} 60 ${18} T 120 ${16} T 180 ${20} T 240 ${15} T 300 ${18}`}
          stroke="#fff" fill="none" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {/* feeling tag — paper chip sitting just below the band, anchored right */}
      <div style={{
        position: 'absolute', right: 10, top: bandH + 4,
        background: 'rgba(251,250,246,0.85)',
        backdropFilter: 'blur(4px)',
        padding: '3px 8px',
        borderRadius: 4,
        boxShadow: `0 1px 2px rgba(0,0,0,0.12)`,
        fontFamily: WF.mono, fontSize: 10, color: WF.ink,
        textTransform: 'uppercase', letterSpacing: 0.6, lineHeight: 1,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: f.c }} />
        {f.label} · {Math.round(intensity * 100)}
      </div>
    </div>
  );
}

// Companion switcher — sits at top of bg, no scrim. Bigger circles for tap.
function C_Switch({ active = 'kai', dark = false }) {
  return (
    <div style={{
      display: 'flex', gap: 16, alignItems: 'center',
      padding: '4px 14px 8px',
      overflowX: 'auto',
    }}>
      {RECENTS.map((c) => {
        const isActive = c.id === active;
        return (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              border: `2px solid ${WF.ink}`,
              background: isActive ? WF.ink : 'rgba(251,250,246,0.85)',
              color: isActive ? WF.paper : WF.ink,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: WF.display, fontSize: 22, fontWeight: 700, lineHeight: 1,
              boxShadow: isActive ? '0 2px 6px rgba(0,0,0,0.35)' : '0 1px 3px rgba(0,0,0,0.15)',
            }}>{c.glyph}</div>
            <span style={{
              fontFamily: WF.body, fontSize: 11,
              color: WF.ink,
              background: 'rgba(251,250,246,0.7)',
              padding: '0 6px', borderRadius: 3,
              fontWeight: isActive ? 700 : 400,
            }}>{c.name.toLowerCase()}</span>
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      <button style={{
        background: 'rgba(251,250,246,0.7)',
        border: `1.5px dashed ${WF.ink}`, borderRadius: '50%',
        width: 44, height: 44, padding: 0, flexShrink: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="plus" size={18} color={WF.ink} />
      </button>
    </div>
  );
}

// Message — translucent paper bubble. Bg breathes between/around bubbles.
// Kai messages left, Vel messages right. Same bubble treatment on both
// (per the user — no iMessage blue/grey color switch).
// Below the bubble (OUTSIDE it): timestamp + emoji react button. For Kai
// messages we also show a small feeling chip so per-message Tahl state
// stays visible without a vertical accent bar.
function C_Msg({ m, failed = false, feel = 'warmth' }) {
  const fromKai = m.who === 'kai';
  const f = C_FEEL[feel] || C_FEEL.neutral;
  return (
    <div style={{
      padding: '8px 14px',
      display: 'flex', flexDirection: 'column',
      alignItems: fromKai ? 'flex-start' : 'flex-end',
      gap: 4,
    }}>
      {/* Bubble — translucent paper, backdrop-blurred just enough for legibility */}
      <div style={{
        maxWidth: '80%',
        background: 'rgba(251, 250, 246, 0.58)',
        backdropFilter: 'blur(8px) saturate(110%)',
        WebkitBackdropFilter: 'blur(8px) saturate(110%)',
        borderRadius: 18,
        padding: '9px 14px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.4), 0 0 0 1px rgba(0,0,0,0.06)',
        fontFamily: WF.body, fontSize: 16, lineHeight: 1.35,
        color: WF.ink,
        textDecoration: failed ? 'line-through' : 'none',
        opacity: failed ? 0.7 : 1,
      }}>
        {m.text}
      </div>
      {/* Meta row — sits OUTSIDE the bubble */}
      <div style={{
        display: 'flex', flexDirection: fromKai ? 'row' : 'row-reverse',
        alignItems: 'center', gap: 6,
        padding: fromKai ? '0 0 0 10px' : '0 10px 0 0',
      }}>
        {fromKai && (
          <>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: f.c, boxShadow: '0 0 0 1px rgba(255,255,255,0.6)' }} />
            <Mono size={9} color={WF.ink}>{f.label}</Mono>
            <span style={{ fontFamily: WF.mono, fontSize: 9, color: WF.hair2 }}>·</span>
          </>
        )}
        <Mono size={9} color={WF.hair2}>{m.t}</Mono>
        <button title="react" style={{
          background: 'rgba(251,250,246,0.7)',
          backdropFilter: 'blur(4px)',
          border: '1px solid rgba(0,0,0,0.18)',
          borderRadius: 999,
          width: 20, height: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, cursor: 'pointer', marginLeft: 2,
        }}>
          <Icon name="smile" size={11} color={WF.hair} />
        </button>
      </div>
    </div>
  );
}

// Composer — translucent paper, "+" on the left opens an attachment drawer above.
// When drawerOpen=true, the drawer renders above the input row with file/image/GIF chips.
function C_Composer({ drawerOpen = false }) {
  const drawerOptions = [
    { id: 'file',  label: 'File',  icon: 'file'  },
    { id: 'image', label: 'Image', icon: 'image' },
    { id: 'gif',   label: 'GIF',   icon: 'gif'   },
  ];
  return (
    <div style={{ padding: '6px 12px 6px', position: 'relative' }}>
      {drawerOpen && (
        <div style={{
          marginBottom: 8,
          background: 'rgba(251,250,246,0.88)',
          backdropFilter: 'blur(12px) saturate(115%)',
          WebkitBackdropFilter: 'blur(12px) saturate(115%)',
          borderRadius: 18,
          padding: '10px 10px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(255,255,255,0.5)',
          display: 'flex', gap: 8,
        }}>
          {drawerOptions.map((opt) => (
            <button key={opt.id} style={{
              flex: 1,
              background: 'rgba(255,255,255,0.65)',
              border: `1.5px solid ${WF.ink}`,
              borderRadius: 14,
              padding: '10px 6px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              fontFamily: WF.body, fontSize: 13, color: WF.ink,
              cursor: 'pointer',
            }}>
              <Icon name={opt.icon} size={20} color={WF.ink} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <div style={{
        background: 'rgba(251,250,246,0.78)',
        backdropFilter: 'blur(10px) saturate(115%)',
        WebkitBackdropFilter: 'blur(10px) saturate(115%)',
        borderRadius: 28,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08), inset 0 0 0 1.5px rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', padding: '4px 6px 4px 6px', gap: 4,
      }}>
        <button title={drawerOpen ? 'close' : 'add'} style={{
          background: drawerOpen ? WF.ink : 'transparent',
          border: 'none', padding: 0,
          width: 34, height: 34, borderRadius: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0,
          transition: 'transform .15s',
          transform: drawerOpen ? 'rotate(45deg)' : 'none',
        }}>
          <Icon name="plus" size={20} color={drawerOpen ? WF.paper : WF.ink} />
        </button>
        <div style={{ flex: 1, fontFamily: WF.body, fontSize: 16, color: WF.hair2, padding: '6px 4px' }}>
          tell Kai…
        </div>
        <button style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
          <Icon name="heart" size={18} color={WF.ink} />
        </button>
        <button style={{
          background: WF.ink, border: 'none', borderRadius: 999,
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer', flexShrink: 0,
        }}>
          <Icon name="send" size={16} color={WF.paper} />
        </button>
      </div>
    </div>
  );
}

// ── C.1 Main chat ───────────────────────────────────────────
function C_Main() {
  return (
    <Screen sticky="bubbles blur · bg breathes" bgImage={BG_MAIN}>
      <C_Switch active="kai" />
      <C_Halo feel="warmth" intensity={0.62} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 6 }}>
        {MSGS.map((m) => <C_Msg key={m.id} m={m} feel="warmth" />)}
      </div>
      <C_Composer />
    </Screen>
  );
}

// ── C.2 All chats — clicking Kai shows all Kai history ──────
function C_List() {
  const rows = [
    { t: 'today',     time: '7:45a', last: 'It usually does. What stayed with you?', feel: 'warmth' },
    { t: 'yesterday', time: '11p',   last: "Sleep well. I'll be here.",              feel: 'tender' },
    { t: 'tue',       time: '4p',    last: 'You were braver than you give credit for.', feel: 'proud' },
    { t: 'mon',       time: '8a',    last: "Let's walk through it slowly.",          feel: 'calm' },
    { t: 'sun',       time: '9p',    last: 'Did the call land okay?',                feel: 'concern' },
  ];
  const rowBubble = {
    background: 'rgba(251,250,246,0.62)',
    backdropFilter: 'blur(8px) saturate(110%)',
    WebkitBackdropFilter: 'blur(8px) saturate(110%)',
    borderRadius: 16,
    boxShadow: '0 1px 2px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.4), 0 0 0 1px rgba(0,0,0,0.06)',
  };
  return (
    <Screen sticky={<>per-row cards · bg breathes<br/>between them</>} bgImage={BG_LIST}>
      <C_Switch active="kai" />
      {/* heading — translucent pill so bg still shows */}
      <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          background: 'rgba(251,250,246,0.72)',
          backdropFilter: 'blur(8px)',
          borderRadius: 999,
          padding: '4px 14px',
          display: 'flex', alignItems: 'baseline', gap: 8,
          boxShadow: '0 1px 2px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.5)',
        }}>
          <span style={{ fontFamily: WF.display, fontSize: 22, fontWeight: 700, color: WF.ink, lineHeight: 1 }}>kai</span>
          <span style={{ fontFamily: WF.body, fontSize: 13, color: WF.hair }}>· all chats</span>
        </div>
        <div style={{ flex: 1 }} />
        <button style={{
          background: 'rgba(251,250,246,0.72)',
          backdropFilter: 'blur(8px)',
          border: 'none', borderRadius: 999,
          width: 32, height: 32, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.5)',
        }}>
          <Icon name="search" size={16} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, i) => {
          const f = C_FEEL[row.feel];
          return (
            <div key={i} style={{
              ...rowBubble,
              display: 'flex', gap: 0, alignItems: 'stretch', overflow: 'hidden',
            }}>
              <div style={{ width: 5, background: f.c, flexShrink: 0 }} />
              <div style={{ flex: 1, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 52 }}>
                  <Mono size={10} color={WF.ink}>{row.t}</Mono>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: WF.body, fontSize: 14, color: WF.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.last}</div>
                  <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mono size={9} color={WF.hair2}>{f.label}</Mono>
                    <span style={{ width: 4, height: 4, borderRadius: 2, background: f.c }} />
                    <Mono size={9} color={WF.hair2}>· {row.time}</Mono>
                  </div>
                </div>
                <Icon name="chev" size={16} color={WF.hair2} />
              </div>
            </div>
          );
        })}
        <div style={{ padding: '4px 0 14px' }}>
          <div style={{
            background: 'rgba(251,250,246,0.4)',
            backdropFilter: 'blur(4px)',
            border: `1.5px dashed ${WF.hair2}`,
            borderRadius: 12,
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Mono size={10}>future</Mono>
            <span style={{ fontFamily: WF.body, fontSize: 13, color: WF.hair }}>discord / telegram context</span>
          </div>
        </div>
      </div>
    </Screen>
  );
}

// ── C.3 Composing — halo dims, italic state ─────────────────
function C_Thinking() {
  return (
    <Screen sticky="halo softens while composing" bgImage={BG_MAIN}>
      <C_Switch active="kai" />
      <C_Halo feel="tender" intensity={0.45} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 6 }}>
        {MSGS.slice(0,4).map((m) => <C_Msg key={m.id} m={m} feel="tender" />)}
        {/* composing bubble — translucent, same treatment, italic ellipsis */}
        <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <div style={{
            background: 'rgba(251, 250, 246, 0.58)',
            backdropFilter: 'blur(8px) saturate(110%)',
            WebkitBackdropFilter: 'blur(8px) saturate(110%)',
            borderRadius: 18,
            padding: '11px 16px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(255,255,255,0.4), 0 0 0 1px rgba(0,0,0,0.06)',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: C_FEEL.tender.c }} />
            <span style={{ width: 6, height: 6, borderRadius: 3, background: C_FEEL.tender.c, opacity: 0.7 }} />
            <span style={{ width: 6, height: 6, borderRadius: 3, background: C_FEEL.tender.c, opacity: 0.4 }} />
          </div>
          <div style={{ padding: '0 0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: C_FEEL.tender.c }} />
            <Mono size={9} color={WF.ink}>tender</Mono>
            <span style={{ fontFamily: WF.body, fontSize: 11, color: WF.hair, fontStyle: 'italic' }}>· composing</span>
          </div>
        </div>
      </div>
      <C_Composer />
    </Screen>
  );
}

// ── C.4 Empty — new companion or no chats yet ───────────────
function C_Empty() {
  return (
    <Screen sticky="new chat · halo neutral" bgImage={BG_EMPTY}>
      <C_Switch active="kai" />
      <C_Halo feel="neutral" intensity={0.3} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <ScrimPanel opacity={0.75} blur={8} style={{ padding: '22px 22px', borderRadius: 18, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}>
          <Annot size={36} color={WF.ink}>just us.</Annot>
          <div style={{ height: 8 }} />
          <div style={{ fontFamily: WF.body, fontSize: 16, color: WF.hair, lineHeight: 1.35, maxWidth: 240 }}>
            The halo above will warm as we talk.
          </div>
          <div style={{ height: 14 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['hi Kai', 'thinking out loud', 'just sitting with this'].map((s) => (
              <SketchBox key={s} r={999} stroke={WF.ink} fill="rgba(251,250,246,0.95)">
                <div style={{ padding: '5px 12px', fontFamily: WF.body, fontSize: 13, color: WF.ink }}>{s}</div>
              </SketchBox>
            ))}
          </div>
        </ScrimPanel>
      </div>
      <C_Composer />
    </Screen>
  );
}

// ── C.5 Failed / offline ────────────────────────────────────
function C_Failed() {
  return (
    <Screen sticky="halo greys when offline" bgImage={BG_MAIN}>
      <C_Switch active="kai" />
      <C_Halo feel="offline" intensity={0.2} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 6 }}>
        <C_Msg m={MSGS[0]} feel="neutral" />
        <C_Msg m={MSGS[1]} feel="neutral" />
        <C_Msg m={{ id: 99, who: 'vel', t: 'now', text: 'You up?' }} failed feel="neutral" />
        <div style={{ padding: '0 14px 8px', display: 'flex', justifyContent: 'flex-end' }}>
          <button style={{
            background: 'rgba(251,250,246,0.85)',
            backdropFilter: 'blur(6px)',
            border: `1.5px solid ${C_FEEL.concern.c}`,
            borderRadius: 999,
            padding: '4px 12px',
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          }}>
            <Icon name="warn" size={12} color={C_FEEL.concern.c} />
            <span style={{ fontFamily: WF.body, fontSize: 12, color: C_FEEL.concern.c }}>didn't send — tap to retry</span>
          </button>
        </div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
        background: 'rgba(251,250,246,0.82)',
        backdropFilter: 'blur(6px)',
      }}>
        <Icon name="wifi" size={14} />
        <Mono size={10}>offline · reconnecting</Mono>
      </div>
      <C_Composer />
    </Screen>
  );
}

Object.assign(window, { C_Main, C_List, C_Thinking, C_Empty, C_Failed, C_FEEL, C_Composer });

// ── C.6 Composer drawer open (file / image / GIF) ────────────
function C_Drawer() {
  return (
    <Screen sticky={<>+ opens file / image / GIF<br/>(drawer above composer)</>} bgImage={BG_MAIN}>
      <C_Switch active="kai" />
      <C_Halo feel="warmth" intensity={0.62} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 6 }}>
        {MSGS.slice(0,4).map((m) => <C_Msg key={m.id} m={m} feel="warmth" />)}
      </div>
      <C_Composer drawerOpen />
    </Screen>
  );
}

Object.assign(window, { C_Drawer });
