const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData); app.setPath('sessionData', join(userData, 'session'))
// In-memory Renderer projections only. No Core, SQLite, Skill Library or Runtime.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadFile(renderer)
  const report = await window.webContents.executeJavaScript('window.missionQA.run()', true)
  await window.webContents.executeJavaScript(`(() => {
    localStorage.setItem('rovai.mission-drawer-width', '1040')
    document.querySelector('.mission-board-card')?.click()
  })()`, true)
  const waitFor = async (expression, message) => {
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression, true)) return
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error(message)
  }
  await waitFor("!!document.querySelector('.mission-drawer .mission-drawer-resize-handle') && !!document.querySelector('.file-preview-retained-host:not([hidden])')", 'Mission drawer did not reopen for pointer acceptance')
  const geometry = async () => window.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector('.mission-drawer-resize-handle').getBoundingClientRect()
    const drawer = document.querySelector('.mission-drawer').getBoundingClientRect()
    const shell = document.querySelector('.navigation-shell').getBoundingClientRect()
    const rail = parseFloat(getComputedStyle(document.querySelector('.navigation-shell')).getPropertyValue('--rail-width')) || 0
    return { x: Math.round(handle.x + handle.width / 2), y: Math.round(handle.y + 96), right: drawer.right, snapX: shell.left + rail + 48 }
  })()`, true)
  let point = await geometry()
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
  window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  const narrowX = Math.round(point.right - 640)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: narrowX, y: point.y, button: 'left' })
  await waitFor("!document.querySelector('.file-preview-retained-host:not([hidden])') && getComputedStyle(document.querySelector('.mission-drawer .timeline-pane')).display !== 'none'", 'Pointer shrink did not preserve the message area before release')
  window.webContents.sendInputEvent({ type: 'mouseUp', x: narrowX, y: point.y, button: 'left', clickCount: 1 })

  point = await geometry()
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
  window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  const expandX = Math.round(point.snapX - 8)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: expandX, y: point.y, button: 'left' })
  await waitFor("!!document.querySelector('.mission-full')", 'Pointer drag did not expand before release')
  window.webContents.sendInputEvent({ type: 'mouseUp', x: expandX, y: point.y, button: 'left', clickCount: 1 })
  report.layouts = { pointerShrinkPreservedMessages: true, pointerExpandedBeforeRelease: true }
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
