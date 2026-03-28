# Haven — Testing Notes

## Issues Found

### Setup Wizard
- [x] Description textarea too small (4 rows → 8 rows, scrollable to 300px)
- [ ] Description field IS the CI — should be labeled clearly as "Companion Identity" or "Personality"
- [ ] Should support pasting large CI docs (character cards, personality files)
- [ ] Consider adding a "Paste from file" option for long CIs
- [ ] identity_type 'personality' not in the schema CHECK constraint — schema allows: anchor, voice, trait, boundary, value, dynamic, backstory

### Chat
- [ ] Test: SSE streaming works end-to-end
- [ ] Test: Thread creation on first message
- [ ] Test: Thread switching
- [ ] Test: Message editing + regen
- [ ] Test: GIF picker
- [ ] Test: STT
- [ ] Test: TTS on companion messages
- [ ] Test: Wallpaper picker
- [ ] Test: Model selector
- [ ] Test: Font size

### Settings
- [ ] Test: Companion name change
- [ ] Test: API key save
- [ ] Test: Identity editor (add/delete)
- [ ] Test: Cache clear

### Mobile
- [ ] Test: Sidebar drawer
- [ ] Test: Keyboard behavior
- [ ] Test: Touch interactions

## Schema Issues
- identity_type CHECK constraint: `anchor, voice, trait, boundary, value, dynamic, backstory`
- SetupWizard sends `personality` as identity_type — will fail the CHECK constraint
- Fix: either update schema or change wizard to use `backstory` or `trait`
