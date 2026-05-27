// Haven — Halo direction
// Style C ("Halo") with backgrounds applied. Plus a tokens row showing the
// feelings palette, the companion structure, and which bg goes where.

function App() {
  return (
    <DesignCanvas>
      <DCSection id="halo" title="Halo · with backgrounds" subtitle="full-bleed bg per screen-state · halo carries the feeling on top">
        <DCArtboard id="c-main"     label="01 · main chat"        width={360} height={780}><C_Main /></DCArtboard>
        <DCArtboard id="c-list"     label="02 · all kai chats"    width={360} height={780}><C_List /></DCArtboard>
        <DCArtboard id="c-thinking" label="03 · composing"        width={360} height={780}><C_Thinking /></DCArtboard>
        <DCArtboard id="c-empty"    label="04 · empty / new"      width={360} height={780}><C_Empty /></DCArtboard>
        <DCArtboard id="c-failed"   label="05 · failed / offline" width={360} height={780}><C_Failed /></DCArtboard>
        <DCArtboard id="c-drawer"   label="06 · + drawer"         width={360} height={780}><C_Drawer /></DCArtboard>
      </DCSection>

      <DCSection id="tokens" title="Tokens · for hand-off" subtitle="palette + structure the engineer can wire to">
        <DCArtboard id="t-palette"    label="feelings palette"  width={360} height={780}><C_PaletteCard /></DCArtboard>
        <DCArtboard id="t-companions" label="companions"        width={360} height={780}><C_CompanionsCard /></DCArtboard>
        <DCArtboard id="t-bgs"        label="backgrounds"       width={360} height={780}><C_BgCard /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
