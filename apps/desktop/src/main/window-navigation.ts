import type { BrowserWindow } from 'electron'

/** Host commands never invoke Chromium history. Windows side buttons have one owner. */
export function installWindowNavigation(window: BrowserWindow, platform: NodeJS.Platform): void {
  if (platform === 'win32') window.on('app-command', (event, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') return
    event.preventDefault()
    window.webContents.send('rovai:navigation-requested', command === 'browser-backward' ? 'back' : 'forward')
  })
  if (platform === 'darwin') window.on('swipe', (event, direction) => {
    if (direction !== 'right' && direction !== 'left') return
    event.preventDefault()
    window.webContents.send('rovai:navigation-requested', direction === 'right' ? 'back' : 'forward')
  })
}
