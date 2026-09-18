import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('./MissionControls.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./mission.css', import.meta.url), 'utf8')

describe('Mission card action menu interaction', () => {
  it('keeps submenus click-open while giving every action a visible hover and keyboard-focus state', () => {
    expect(component).toContain('onPointerMove={event => event.preventDefault()}')
    expect(component).toContain("onClick={event => { event.preventDefault(); setPanel(current => current === id ? null : id) }}")
    expect(styles).toMatch(/\.mission-action-menu \.compact-option:is\(:hover,:focus-visible\),\.mission-action-menu \.compact-option\[data-state="open"\]\s*\{\s*background:\s*var\(--surface-hover\);\s*\}/)
    expect(styles).toMatch(/\.mission-action-menu \.mission-danger-item:is\(:hover,:focus-visible,\[data-highlighted\]\)\s*\{[^}]*background:\s*var\(--danger-soft\);/)
  })
})
