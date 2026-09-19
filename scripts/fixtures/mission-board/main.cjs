const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData, mode = 'standard'] = process.argv.slice(2)
assert(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData); app.setPath('sessionData', join(userData, 'session'))
// In-memory Renderer projections only. No Core, SQLite, Skill Library or Runtime.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadFile(renderer, mode === 'large-diff' ? { query: { largeDiff: '1' } } : undefined)
  const waitFor = async (expression, message) => {
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression, true)) return
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error(message)
  }
  if (mode === 'wide-direct-expand') {
    window.setContentSize(2560, 1440)
    window.webContents.setZoomFactor(1)
    await waitFor("document.querySelector('.navigation-shell')?.clientWidth >= 2500", 'Wide Mission fixture did not resize')
    await waitFor("!!document.querySelector('.mission-board-card')", 'Wide Mission board did not load')
    await window.webContents.executeJavaScript(`(() => {
      localStorage.setItem('rovai.mission-drawer-width', '1906')
      document.querySelector('.mission-board-card').click()
    })()`, true)
    await waitFor("!!document.querySelector('.mission-drawer .mission-drawer-resize-handle')", 'Wide Mission drawer did not open')
    const point = await window.webContents.executeJavaScript(`(() => {
      const handle = document.querySelector('.mission-drawer-resize-handle')
      const drawer = document.querySelector('.mission-drawer')
      const shell = document.querySelector('.navigation-shell')
      const handleBounds = handle.getBoundingClientRect()
      const drawerBounds = drawer.getBoundingClientRect()
      const shellBounds = shell.getBoundingClientRect()
      const rail = parseFloat(getComputedStyle(shell).getPropertyValue('--rail-width')) || 0
      const scale = shellBounds.width / shell.clientWidth
      return {
        x: Math.round(handleBounds.x + handleBounds.width / 2),
        y: Math.round(handleBounds.y + 96),
        snapX: Math.round(shellBounds.left + (rail + 48) * scale),
        logicalWidth: Number(handle.getAttribute('aria-valuenow')),
        renderedWidth: drawerBounds.width
      }
    })()`, true)
    assert(point.logicalWidth > 1400, 'Wide acceptance must begin above the ordinary content cap')
    assert(Math.abs(point.renderedWidth - point.logicalWidth) <= 2,
      `Wide Mission drawer rendered ${point.renderedWidth}px for a ${point.logicalWidth}px logical width`)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    const expandX = point.snapX - 8
    window.webContents.sendInputEvent({ type: 'mouseMove', x: expandX, y: point.y, button: 'left' })
    await waitFor("!!document.querySelector('.mission-full')", 'Direct wide drag did not expand before release')
    const full = await window.webContents.executeJavaScript(`(() => ({
      width: document.querySelector('.mission-full').getBoundingClientRect().width,
      available: document.querySelector('.mission-active-content').getBoundingClientRect().width
    }))()`, true)
    assert(Math.abs(full.width - full.available) <= 2,
      `Expanded Mission rendered ${full.width}px in a ${full.available}px workspace`)
    window.webContents.sendInputEvent({ type: 'mouseUp', x: expandX, y: point.y, button: 'left', clickCount: 1 })
    console.log(JSON.stringify({ ok: true, cases: [], layouts: {
      wideDrawerLogicalWidth: point.logicalWidth,
      wideDrawerRenderedWidth: Math.round(point.renderedWidth),
      wideFullWidth: Math.round(full.width),
      wideDirectExpandedBeforeRelease: true
    } }))
    app.exit(0)
    return
  }
  const report = await window.webContents.executeJavaScript(mode === 'large-diff' ? 'window.missionQA.runLargeDiff()' : 'window.missionQA.run()', true)
  if (mode === 'large-diff') {
    console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1); return
  }
  await window.webContents.executeJavaScript(`(() => {
    localStorage.setItem('rovai.mission-drawer-width', '1040')
    document.querySelector('.mission-board-card')?.click()
  })()`, true)
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
