import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { missionCardVisibleAvatarCount } from './MissionControls'

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

describe('Mission card roster fitting', () => {
  const measure = (label: string): number => label.length * 7

  it('keeps five 23px avatars with 7px overlap at regular card width', () => {
    expect(missionCardVisibleAvatarCount(5, 87, measure)).toBe(5)
    expect(missionCardVisibleAvatarCount(8, 105, measure)).toBe(5)
  })

  it('reduces visible avatars and recalculates +N when footer space is narrow', () => {
    expect(missionCardVisibleAvatarCount(8, 73, measure)).toBe(3)
    expect(missionCardVisibleAvatarCount(12, 41, measure)).toBe(1)
  })

  it('keeps one avatar as the final compact fallback', () => {
    expect(missionCardVisibleAvatarCount(8, 1, measure)).toBe(1)
  })
})
