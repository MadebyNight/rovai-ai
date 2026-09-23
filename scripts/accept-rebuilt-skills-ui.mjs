import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { assertUserDataIsIsolated, seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const appPath = process.argv[2]
const outputDirectory = process.argv[3] && resolve(process.argv[3])
if (!appPath || !outputDirectory) {
  throw new Error('Usage: ROVAI_CAPTURE_USER_DATA_DIR=<isolated path> node scripts/accept-rebuilt-skills-ui.mjs <Rovai AI.app> <output-directory>')
}
const userDataDirectory = assertUserDataIsIsolated(process.env.ROVAI_CAPTURE_USER_DATA_DIR)
const theme = process.env.ROVAI_CAPTURE_THEME ?? 'day'
const zoom = Number(process.env.ROVAI_CAPTURE_ZOOM_FACTOR ?? 1)
if (!['day', 'night'].includes(theme) || ![1, 2].includes(zoom)) {
  throw new Error('ROVAI_CAPTURE_THEME must be day or night and ROVAI_CAPTURE_ZOOM_FACTOR must be 1 or 2')
}
const width = 1440
const height = 920
const fixtureHome = join(dirname(userDataDirectory), 'native-home')
const nativeSkill = join(fixtureHome, '.codex', 'skills', 'acceptance-demo')
const nativePage = pageExpression('skills', 'Skills')
const toolboxPage = pageExpression('toolbox', '工具箱')
await mkdir(nativeSkill, { recursive: true })
await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
await writeFile(join(nativeSkill, 'SKILL.md'), '---\nname: acceptance-demo\ndescription: Isolated Skills acceptance fixture\n---\n\n# Acceptance demo\n\nA local read-only discovery fixture.\n')
seedCompletedOnboardingForAcceptance(userDataDirectory)

const port = await freePort()
const app = spawn(join(appPath, 'Contents', 'MacOS', 'Rovai AI'), [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDirectory}`
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    ...process.env,
    HOME: fixtureHome,
    CODEX_HOME: join(fixtureHome, '.codex'),
    ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
  }
})
const stderr = []
app.stderr.on('data', (chunk) => stderr.push(String(chunk)))
let cdp
try {
  cdp = await connectCdp(await waitForTarget(port, stderr))
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: width / zoom,
    height: height / zoom,
    deviceScaleFactor: zoom,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  })
  await waitFor(cdp, `window.innerWidth === ${width / zoom} && window.innerHeight === ${height / zoom}`, 5_000)
  await waitFor(cdp, `Boolean(document.querySelector('.unified-primary-nav button[aria-label="新对话"]:not(:disabled)')) && !document.querySelector('.startup-gate')`, 45_000)
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`)
  await waitFor(cdp, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 5_000)
  await evaluate(cdp, `(() => {
    const button = document.querySelector('.unified-sidebar-footer .sidebar-settings-main')
    button.click()
    return true
  })()`)
  await waitFor(cdp, `Boolean(document.querySelector('.settings-sidebar-menu'))`, 5_000)

  await openSection(cdp, 'Skills')
  await waitFor(cdp, `Boolean((${nativePage})?.querySelector('.rebuilt-skill-row strong'))`, 30_000)
  const skills = await evaluate(cdp, `(() => {
    const panel = ${nativePage}
    const rows = [...panel.querySelectorAll('.rebuilt-skill-row strong')].map((item) => item.textContent.trim())
    return { rows, body: panel.querySelector('.rebuilt-skills-content')?.textContent ?? '',
      error: panel.querySelector('[role="alert"]')?.textContent ?? null,
      narrow: getComputedStyle(panel.querySelector('.rebuilt-skills-back')).display !== 'none',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })()`)
  if (skills.rows.join(',') !== 'acceptance-demo' ||
      !skills.body.includes('A local read-only discovery fixture.') || skills.error || skills.overflow ||
      skills.narrow !== (zoom === 2)) {
    throw new Error(`Native Skills view did not match its isolated source: ${JSON.stringify(skills)}`)
  }
  if (skills.narrow) await selectFirstRow(cdp, nativePage)
  await waitFor(cdp, `!document.querySelector('.page-zoom-indicator')`, 5_000)
  await capture(cdp, join(outputDirectory, 'skills.png'))

  await openSection(cdp, '工具箱')
  await waitFor(cdp, `((${toolboxPage})?.querySelectorAll('.rebuilt-skill-row').length ?? 0) === 5`, 30_000)
  const toolbox = await evaluate(cdp, `(async () => {
    const views = await window.rovai.request('toolbox.list')
    const panel = ${toolboxPage}
    return { names: views.map((entry) => entry.name).sort(),
      defaults: views.map((entry) => [entry.name, entry.memberIds.length]),
      rows: panel.querySelectorAll('.rebuilt-skill-row').length,
      narrow: getComputedStyle(panel.querySelector('.rebuilt-skills-back')).display !== 'none',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      error: document.querySelector('.error-banner')?.textContent ?? null }
  })()`)
  const expected = ['campfire', 'grill-duo', 'grill-duo-with-docs', 'member-studio', 'review-duo']
  if (toolbox.names.join(',') !== expected.join(',') || toolbox.rows !== 5 || toolbox.overflow || toolbox.error ||
      toolbox.narrow !== (zoom === 2) ||
      toolbox.defaults.some(([name, count]) => name === 'member-studio' ? count !== 4 : count !== 0)) {
    throw new Error(`Toolbox defaults or layout changed: ${JSON.stringify(toolbox)}`)
  }
  if (toolbox.narrow) await selectFirstRow(cdp, toolboxPage)
  await waitFor(cdp, `!document.querySelector('.page-zoom-indicator')`, 5_000)
  await capture(cdp, join(outputDirectory, 'toolbox.png'))

  await evaluate(cdp, `(() => {
    const row = [...(${toolboxPage}).querySelectorAll('.rebuilt-skill-row')]
      .find((item) => item.querySelector('strong')?.textContent === 'campfire')
    row?.focus()
    row?.click()
    return Boolean(row) && document.activeElement === row
  })()`)
  await waitFor(cdp, `Boolean((${toolboxPage}).querySelector('.rebuilt-toolbox-member input'))`, 5_000)
  await evaluate(cdp, `(${toolboxPage}).querySelector('.rebuilt-toolbox-member input').click()`)
  await waitFor(cdp, `(async () => (await window.rovai.request('toolbox.list')).find((item) => item.name === 'campfire')?.memberIds.length === 1)()`, 8_000)
  await waitFor(cdp, `!(${toolboxPage}).querySelector('.rebuilt-skills-status')`, 5_000)
  await evaluate(cdp, `(${toolboxPage}).querySelector('.rebuilt-toolbox-member input').click()`)
  await waitFor(cdp, `(async () => (await window.rovai.request('toolbox.list')).find((item) => item.name === 'campfire')?.memberIds.length === 0)()`, 8_000)
  await writeFile(join(outputDirectory, 'report.json'), `${JSON.stringify({
    schemaVersion: 1,
    theme,
    zoom,
    userDataDirectory,
    nativeSkillNames: skills.rows,
    toolboxDefaults: toolbox.defaults,
    toolboxToggleRestored: true,
    screenshots: ['skills.png', 'toolbox.png']
  }, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${join(outputDirectory, 'report.json')}\n`)
} finally {
  cdp?.close()
  app.kill('SIGTERM')
  await Promise.race([new Promise((done) => app.once('close', done)), sleep(2_000)])
  if (app.exitCode === null) app.kill('SIGKILL')
}

async function selectFirstRow(cdp, page) {
  await evaluate(cdp, `(${page})?.querySelector('.rebuilt-skill-row')?.click()`)
  await waitFor(cdp, `getComputedStyle((${page}).querySelector('.rebuilt-skills-detail')).display !== 'none'`, 5_000)
}

function pageExpression(section, heading) {
  return `[...document.querySelectorAll('.settings-panel-${section} .rebuilt-skills-page')]
    .find((page) => page.querySelector('h1')?.textContent?.trim() === ${JSON.stringify(heading)})`
}

async function openSection(cdp, label) {
  const focused = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(label)})
    button?.focus()
    button?.click()
    return Boolean(button) && document.activeElement === button
  })()`)
  if (!focused) throw new Error(`${label} settings entry is unavailable or not keyboard focusable`)
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text)
  return result.result?.result?.value
}

async function waitFor(cdp, expression, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(cdp, expression)) return }
    catch { /* Core may still be starting. */ }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${expression}`)
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function freePort() {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function waitForTarget(port, stderr) {
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      const page = targets.find((target) => target.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* Electron is starting. */ }
    await sleep(150)
  }
  throw new Error(`Electron DevTools target did not start: ${stderr.join('')}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message)
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { socket.close() }
  }
}

function sleep(ms) { return new Promise((done) => setTimeout(done, ms)) }
