import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const settingsStyles = readFileSync(new URL('./settings-workspace.css', import.meta.url), 'utf8')
const mobileStyles = readFileSync(new URL('../../../../web/src/mobile.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('./AboutUpdatesSettings.tsx', import.meta.url), 'utf8')

function styleBlock(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

describe('App update interaction presentation', () => {
  it('keeps the track neutral and uses the dedicated bright-blue fill in every browser engine', () => {
    expect(styleBlock(styles, '.about-download-progress progress')).toMatch(
      /background:\s*var\(--surface-muted\);[^}]*accent-color:\s*var\(--update-progress-fill\)/
    )
    expect(styleBlock(styles, '.about-download-progress progress::-webkit-progress-bar')).toMatch(
      /background:\s*var\(--surface-muted\)/
    )
    expect(styleBlock(styles, '.about-download-progress progress::-webkit-progress-value')).toMatch(
      /background:\s*var\(--update-progress-fill\)/
    )
    expect(styleBlock(styles, '.about-download-progress progress::-moz-progress-bar')).toMatch(
      /background:\s*var\(--update-progress-fill\)/
    )
  })

  it('uses the neutral action family and the V4 spacing in the global update prompt', () => {
    expect(styleBlock(styles, '.app-update-prompt')).toMatch(/gap:\s*12px 6px/)
    expect(styleBlock(styles, '.app-update-prompt')).toMatch(/padding:\s*15px 12px 12px 16px/)
    expect(styleBlock(styles, '.app-update-prompt .primary-button')).toMatch(
      /border-color:\s*var\(--conversation-action\)[^}]*color:\s*var\(--conversation-action-contrast\)[^}]*background:\s*var\(--conversation-action\)/
    )
    expect(styleBlock(styles, '.app-update-prompt-actions button')).toMatch(/min-height:\s*30px/)
    expect(styleBlock(styles, '.app-update-prompt-actions button')).toMatch(/font-size:\s*10\.5px/)
  })

  it('matches the compact update hierarchy and state dot from the approved About surface', () => {
    expect(component).toContain('data-update-read-only={readOnly}')
    expect(component).toContain("data-update-status={snapshot?.status ?? 'unavailable'}")
    expect(settingsStyles).toMatch(/about-updates-settings\[data-update-read-only="false"\][^{]*\.settings-page-heading-copy>p:last-child\s*\{[^}]*display:\s*none/)
    expect(styleBlock(settingsStyles, ':root .settings-panel:not(.settings-panel-mcp,.settings-panel-skills) .about-update-control')).toMatch(/min-height:\s*40px/)
    expect(settingsStyles).toMatch(/\.about-update-actions>button\s*\{[^}]*min-height:\s*32px/)
    expect(settingsStyles).toMatch(/\.about-download-progress-meta\s*\{[^}]*color:\s*var\(--muted\)[^}]*font-family:\s*inherit[^}]*font-size:\s*11px/)
    expect(settingsStyles).toMatch(/data-update-status="downloading"[^}]*>div:first-child>strong::before\s*\{[^}]*background:\s*var\(--info\)/)
    expect(settingsStyles).toMatch(/data-update-status="ready_to_install"[^}]*>div:first-child>strong::before\s*\{[^}]*background:\s*var\(--success\)/)
    expect(settingsStyles).toMatch(/data-update-status="download_failed"[^}]*>div:first-child>strong::before\s*\{[^}]*background:\s*var\(--danger\)/)
  })

  it('keeps MobileUI actions full-width, reordered, and at least 44px high', () => {
    expect(styleBlock(mobileStyles, 'html[data-mobile-web="true"] .settings-panel-about .about-update-control')).toMatch(
      /display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*gap:\s*14px/
    )
    expect(styleBlock(mobileStyles, 'html[data-mobile-web="true"] .settings-panel-about .about-update-actions')).toMatch(
      /width:\s*100%[^}]*margin-left:\s*0/
    )
    expect(styleBlock(mobileStyles, 'html[data-mobile-web="true"] .settings-panel-about .about-update-actions > .primary-button')).toMatch(
      /min-height:\s*44px[^}]*flex:\s*1 1 auto/
    )
    expect(styleBlock(mobileStyles, 'html[data-mobile-web="true"] .settings-panel-about .about-update-actions > .quiet-button')).toMatch(
      /min-height:\s*44px[^}]*order:\s*2/
    )
  })
})
