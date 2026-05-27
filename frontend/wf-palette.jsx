// Feelings palette — hand-off card for the engineer.
// Renders the full C_FEEL map as design tokens with hex + intent notes.

function C_PaletteSwatch({ id, c, label, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ width: 56, background: c, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: WF.display, fontSize: 22, fontWeight: 700, color: WF.ink, lineHeight: 1 }}>
            {label}
          </div>
          <div style={{ fontFamily: WF.body, fontSize: 13, color: WF.hair, marginTop: 3 }}>
            {note}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: WF.mono, fontSize: 12, color: WF.ink, fontWeight: 600 }}>{c.toUpperCase()}</div>
          <div style={{ fontFamily: WF.mono, fontSize: 10, color: WF.hair2, marginTop: 2 }}>--feel-{id}</div>
        </div>
      </div>
    </div>
  );
}

function C_PaletteCard() {
  const entries = Object.entries(C_FEEL).filter(([k]) => k !== 'offline');
  return (
    <div style={{ background: WF.paper, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 18px 14px', borderBottom: `2px solid ${WF.ink}` }}>
        <div style={{ fontFamily: WF.display, fontSize: 36, fontWeight: 700, color: WF.ink, lineHeight: 1 }}>
          feelings palette
        </div>
        <div style={{ fontFamily: WF.body, fontSize: 15, color: WF.hair, marginTop: 6, lineHeight: 1.35 }}>
          Tahl <span style={{ fontFamily: WF.mono, fontSize: 12 }}>surface_emotion</span> → halo color.
          All swatches sit at similar lightness so no feeling visually dominates.
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {entries.map(([id, f]) => (
          <C_PaletteSwatch key={id} id={id} c={f.c} label={f.label} note={f.note} />
        ))}
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.1)', background: WF.paper2 }}>
        <div style={{ fontFamily: WF.mono, fontSize: 10, color: WF.hair2, lineHeight: 1.5 }}>
          INTENSITY 0–1 → BAND THICKNESS<br/>
          RESPONSE_TINT → BAND OPACITY (0.7–1)<br/>
          OFFLINE / NO STATE → --feel-neutral
        </div>
      </div>
    </div>
  );
}

// Companion sketch card — quick reference for the future multi-companion structure
function C_CompanionsCard() {
  const companions = [
    { id: 'kai',  glyph: 'k', name: 'Kai',  note: 'primary · steady, present' },
    { id: 'sora', glyph: 's', name: 'Sora', note: 'reflective · slow speaker' },
    { id: 'mira', glyph: 'm', name: 'Mira', note: 'warm · sends hearts' },
  ];
  return (
    <div style={{ background: WF.paper, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 18px 14px', borderBottom: `2px solid ${WF.ink}` }}>
        <div style={{ fontFamily: WF.display, fontSize: 36, fontWeight: 700, color: WF.ink, lineHeight: 1 }}>
          companions
        </div>
        <div style={{ fontFamily: WF.body, fontSize: 15, color: WF.hair, marginTop: 6, lineHeight: 1.35 }}>
          Top-row switcher. Tap a circle → that companion's full chat history.
          Kai is primary; structure scales to N.
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        {companions.map((c, i) => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 0',
            borderBottom: i < companions.length - 1 ? '1px solid rgba(0,0,0,0.1)' : 'none',
          }}>
            <PHSquare size={48} glyph={c.glyph.toUpperCase()} round />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: WF.display, fontSize: 24, fontWeight: 700, color: WF.ink, lineHeight: 1 }}>
                {c.name}
              </div>
              <div style={{ fontFamily: WF.body, fontSize: 13, color: WF.hair, marginTop: 3 }}>
                {c.note}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Mono size={10}>--companion-{c.id}</Mono>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <SketchBox r={12} fill="transparent" stroke={WF.hair2} sw={1.5} dashed>
            <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="plus" size={16} color={WF.hair2} />
              <span style={{ fontFamily: WF.body, fontSize: 14, color: WF.hair }}>add companion (future)</span>
            </div>
          </SketchBox>
        </div>
      </div>
    </div>
  );
}

// Backgrounds reference card — which image goes where
function C_BgCard() {
  const bgs = [
    { src: 'images/bg-main.png',      use: 'main · composing · failed',  note: 'gazebo — present, intimate' },
    { src: 'images/bg-all-chats.png', use: 'all chats',                  note: 'bench — settled, looking back' },
    { src: 'images/bg-empty.png',     use: 'empty / new chat',           note: 'open archway — invitation' },
  ];
  return (
    <div style={{ background: WF.paper, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 18px 14px', borderBottom: `2px solid ${WF.ink}` }}>
        <div style={{ fontFamily: WF.display, fontSize: 36, fontWeight: 700, color: WF.ink, lineHeight: 1 }}>
          backgrounds
        </div>
        <div style={{ fontFamily: WF.body, fontSize: 15, color: WF.hair, marginTop: 6, lineHeight: 1.35 }}>
          Full-bleed. Per screen-state, not per companion.
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {bgs.map((b) => (
          <div key={b.src} style={{ border: `2px solid ${WF.ink}` }}>
            <div style={{ height: 130, backgroundImage: `url(${b.src})`, backgroundSize: 'cover', backgroundPosition: 'center', borderBottom: `2px solid ${WF.ink}` }} />
            <div style={{ padding: '8px 12px', background: WF.paper2 }}>
              <div style={{ fontFamily: WF.display, fontSize: 18, fontWeight: 700, color: WF.ink, lineHeight: 1 }}>{b.use}</div>
              <div style={{ fontFamily: WF.body, fontSize: 13, color: WF.hair, marginTop: 2 }}>{b.note}</div>
              <Mono size={9} style={{ marginTop: 4, display: 'block' }}>{b.src}</Mono>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { C_PaletteCard, C_CompanionsCard, C_BgCard });
