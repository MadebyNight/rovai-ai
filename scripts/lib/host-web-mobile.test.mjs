import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { buildHostWebParity } from '../review-host-web-parity.mjs'
import { launchHost, within } from './host-test-client.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Real Host + production Web entry. No Electron profile, Runtime, or daily data.
test('phone workbench uses shared navigation, schedules and per-tab drafts', { timeout: 180_000 }, async t => {
  if (process.platform !== 'darwin' || !await access(executable).then(() => true, () => false)) { t.skip('Requires macOS Chrome; does not qualify real phones or other OSes'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-mobile-web-')))
  const dataDir = join(fixture, 'core')
  const output = process.env.ROVAI_MOBILE_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), mcpConfigPath: join(dataDir, 'mcp.json'), chromeProfile: join(fixture, 'chrome'), runtime: false }))
  const host = launchHost(process.env.ROVAI_HOST_BIN ?? join(repository, 'target/debug/rovai-host'), [
    ...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')
  ], { cwd: repository })
  let browser
  const checks = []
  let stage = 'startup'
  try {
    await within(host.ready)
    const profiles = await host.request('members.list')
    const member = profiles[0]
    for (let index = 1; index <= 10; index++) await host.request('camps.create', { commandId: crypto.randomUUID(), name: `分页会话 ${index}`, workspace: null, memberAgentIds: [member.agentId], defaultLeadAgentId: member.agentId, collaborationMode: 'peer' })
    const result = await host.request('camps.create', { commandId: crypto.randomUUID(), name: 'Mobile 验收对话', workspace: null, memberAgentIds: [member.agentId], defaultLeadAgentId: member.agentId, collaborationMode: 'peer' })
    assert.equal(result.status, 'applied')
    const campId = result.payload.campId
    const service = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: join(repository, 'out/web') })
    browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const element = (label, scope = 'document') => `[...${scope}.querySelectorAll('button')].find(e=>e.getClientRects().length>0 && e.textContent.trim()===${JSON.stringify(label)})`
    const click = async label => { const target = element(label); await browser.wait(`Boolean(${target}) && !(${target}).disabled`); await browser.click(target) }
    const byLabel = label => `document.querySelector('[aria-label=${JSON.stringify(label)}]')`
    const fill = async (selector, value) => { await browser.click(`document.querySelector(${JSON.stringify(selector)})`); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`); await browser.send('Input.insertText', { text: value }) }
    const capture = async name => {
      await browser.capture(join(output, `${name}.png`))
      const geometry = await browser.evaluate(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, shell: document.querySelector('.app-shell').getBoundingClientRect().toJSON(), errors: [...document.querySelectorAll('[role=alert]')].filter(e=>e.getClientRects().length>0).map(e=>e.textContent) })`)
      assert.equal(geometry.overflow, false, `${name}: viewport overflow`)
      checks.push({ name, geometry })
    }
    await browser.send('Page.navigate', { url: service.origin })
    await browser.wait(`document.querySelector('#administrator-token')!==null`)
    await fill('#administrator-token', service.administratorToken)
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.documentElement.dataset.mobileWeb==='true' && document.querySelector('.mobile-bottom-navigation')!==null`)
    await browser.wait(`document.querySelector('.camp-nav-open')!==null`)
    stage = 'conversation list'
    await capture('conversations')
    assert.equal(await browser.evaluate(`document.querySelectorAll('.mobile-bottom-navigation button').length`), 5)
    assert.equal(await browser.evaluate(`document.querySelectorAll('.camp-nav-open').length`), 5)
    await click('查看更多'); await browser.wait(`document.querySelectorAll('.camp-nav-open').length===10`)
    await click('查看更多'); await browser.wait(`document.querySelectorAll('.camp-nav-open').length===11`)
    await capture('conversations-expanded')
    await click('收起'); await browser.wait(`document.querySelectorAll('.camp-nav-open').length===5`)
    await browser.click(byLabel('新建对话'))
    await browser.wait(`document.querySelector('.new-camp-quick-setting')!==null`)
    assert.equal(await browser.evaluate(`document.querySelector('#new-camp-name')===null`), true, 'optional name stays folded')
    await capture('new-conversation')
    await browser.click(byLabel('关闭新对话'))
    await click('Mobile 验收对话')
    await browser.wait(`document.querySelector('[contenteditable=true]')!==null`)
    stage = 'draft and Camp tabs'
    const editor = '.conversation-controls [contenteditable=true]'
    await browser.click(`document.querySelector(${JSON.stringify(editor)})`)
    await browser.send('Input.insertText', { text: '手机标签页草稿' })
    await click('任务'); await capture('camp-tasks')
    await browser.click(`document.querySelector('.task-new-button')`)
    await browser.wait(`document.querySelector('.task-editor-dialog')!==null`)
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.task-editor-dialog .task-field > span')].map(e=>e.textContent)`), ['标题', '说明', '验收条件（每行一项，最多 12 项）', '负责人'])
    await capture('new-task')
    await browser.key('Escape')
    await browser.wait(`document.querySelector('.task-editor-dialog')===null`)
    await click('执行'); await capture('camp-execution-empty')
    await click('对话')
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`), '手机标签页草稿')
    await capture('camp')
    await click('任务')
    await browser.click(byLabel('返回对话列表'))
    await browser.wait(`document.querySelector('.app-shell').dataset.mobileView==='compose'`)
    await click('Mobile 验收对话')
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.textContent==='手机标签页草稿'`)
    await browser.send('Page.reload')
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.textContent==='手机标签页草稿'`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-login-overlay')===null`), true)
    stage = 'HTML attachment on phone'
    const htmlPath = join(fixture, 'mobile.html')
    await writeFile(htmlPath, '<!doctype html><html><body><h1>手机 HTML 附件</h1><button onclick="this.textContent=\'已点击\'">打开交互</button></body></html>')
    await browser.setFiles('.conversation-controls .composer-file-input', [htmlPath])
    await browser.wait(`document.querySelector('.composer-attachment-card .attachment-open:not(:disabled)')!==null`)
    await browser.click(`document.querySelector('.composer-attachment-card .attachment-open')`)
    await browser.wait(`document.querySelector('.file-preview-html-stage')?.dataset.documentState==='loaded'`)
    const preview = await browser.evaluate(`document.querySelector('.file-preview-pane').getBoundingClientRect().toJSON()`)
    assert.ok(preview.width > 350 && preview.height > 450, 'attachment occupies the phone reading pane')
    await capture('html-attachment')
    await browser.click(byLabel('返回对话'))
    await browser.wait(`document.querySelector('.file-preview-pane').hidden`)
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`), '手机标签页草稿')
    stage = 'phone return key'
    await browser.click(`document.querySelector(${JSON.stringify(editor)})`)
    await browser.key('Enter')
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.innerHTML.includes('<br')`)
    assert.equal((await host.request('camps.snapshot', { campId })).messages.length, 0, 'phone Return inserts a line break; only Send submits')
    await browser.click(byLabel('提及队员'))
    await browser.wait(`document.querySelector('.structured-mention-menu [role=option]')!==null`)
    await capture('mention-picker')
    await browser.click(`document.querySelector('.structured-mention-menu [role=option]')`)
    await browser.wait(`document.querySelector('.structured-mention-menu')===null`)
    const publicDraft = await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`)
    stage = 'private editor'
    await browser.click(`document.querySelector('.camp-detail-entry[data-detail=single-chat]')`)
    await browser.wait(`document.querySelector('.single-chat-popover')?.hidden===false`)
    await browser.click(`document.querySelector('.single-chat-target-trigger')`)
    await browser.click(`document.querySelector('.single-chat-target-option')`)
    await browser.wait(`document.querySelector('.single-chat-composer textarea')?.disabled===false`)
    assert.equal(await browser.evaluate(`document.querySelector('.conversation-controls').getClientRects().length`), 0, 'only the private Composer is shown')
    await browser.click(`document.querySelector('.single-chat-composer textarea')`)
    await browser.send('Input.insertText', { text: '独立私聊草稿' })
    // Native textarea editing needs the text-bearing Return event; the shared
    // helper sends only key events, sufficient for Lexical's command handler.
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await browser.wait(`document.querySelector('.single-chat-composer textarea').value.endsWith('\\n')`)
    const privateId = await browser.evaluate(`document.querySelector('.single-chat-popover').dataset.singleChatOwner`)
    const privateSnapshot = await host.request('singleChat.get', { conversationId: privateId })
    assert.equal(privateSnapshot.messages.length, 0)
    assert.equal(privateSnapshot.agentRuns.length, 0, 'phone Return never dispatches a private Run')
    await capture('private-chat')
    await browser.click(byLabel('收起单聊'))
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`), publicDraft)
    await browser.click(`document.querySelector('.mobile-camp-members')`)
    await browser.wait(`document.querySelector('.camp-detail-popover[data-detail=members]')?.hidden===false`)
    assert.equal(await browser.evaluate(`document.querySelector('.camp-detail-popover[data-detail=members] .camp-member-action-button')===null`), true, 'mobile Camp members do not expose Runtime editing')
    await capture('camp-members')
    await click('对话')
    await browser.click(byLabel('返回对话列表'))
    stage = 'members'
    await click('队员')
    await browser.wait(`document.querySelector('.member-sidebar-select')!==null`)
    await capture('members')
    await browser.click(`document.querySelector('.member-sidebar-select')`)
    await browser.wait(`document.querySelector('.member-editor-view[data-mobile-detail]')!==null`)
    await capture('member-detail')
    await browser.evaluate(`document.querySelector('.member-editor-runtime').scrollIntoView({block:'start'})`)
    await capture('member-runtime')
    await browser.click(byLabel('返回队员列表'))
    stage = 'memory'
    await click('记忆')
    await browser.wait(`document.querySelector('.memory-library')!==null`)
    await click('新增记忆')
    await fill('.memory-body-field textarea', '手机端真实记忆验收。')
    await fill('.memory-body-field input', '手机端验收')
    await click('保存记忆')
    await browser.wait(`document.querySelector('.app-dialog')===null && document.querySelector('.memory-library[data-mobile-detail]')!==null`)
    assert.ok((await host.request('memory.list')).memories.some(item => item.currentBody === '手机端真实记忆验收。'))
    await capture('memory-detail')
    await browser.click(byLabel('返回记忆列表'))
    await capture('memory-list')
    stage = 'settings'
    await click('设置')
    await capture('settings')
    await click('关于')
    await browser.wait(`document.querySelector('.remote-about-settings')!==null`)
    await browser.wait(`/版本 \\d+\\.\\d+/.test(document.querySelector('.about-identity').textContent)`)
    assert.equal(await browser.evaluate(`document.querySelector('.server-update-entry')===null`), true, 'Desktop-hosted mobile has no updater')
    await capture('desktop-about')
    await browser.click(byLabel('返回设置'))
    await click('外观')
    await browser.wait(`document.querySelector('.mobile-font-slider input')!==null`)
    await capture('appearance')
    await browser.click(byLabel('增大会话字号'))
    await browser.wait(`document.querySelector('.mobile-font-slider output')?.textContent==='14'`)
    await browser.click(byLabel('返回设置'))
    for (const label of ['通用', 'Skills', 'MCP', '运行时', '远程连接']) {
      await click(label)
      // The Runtime page has its own status-dependent content; the shared settings panel is stable.
      await browser.wait(`document.querySelector('.settings-panel')!==null`)
      if (label === 'Skills') await browser.wait(`!document.querySelector('.settings-panel').innerText.includes('正在读取')`)
      if (label === 'MCP') await browser.wait(`document.querySelector('.mcp-first-connection')!==null`)
      await capture(`settings-${label}`)
      await browser.click(byLabel('返回设置'))
    }
    stage = 'automation schedules'
    await click('定时')
    await browser.wait(`Boolean(${element('新建')})`)
    await capture('automations')
    await click('新建')
    await browser.wait(`document.querySelector('[aria-label="重复频率"]')!==null`)
    await browser.click(byLabel('重复频率'))
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[role=menuitemradio]')].map(e=>e.textContent.trim())`), ['每天', '工作日', '每周', '仅一次', '自定义', '手动触发'])
    await browser.click(`[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.trim()==='仅一次')`)
    await browser.click(`document.querySelector('.automation-schedule-value[aria-label^="日期："]')`)
    await browser.wait(`document.querySelector('.mobile-schedule-sheet')!==null`)
    assert.equal(await browser.evaluate(`document.querySelectorAll('.automation-calendar-day').length`), 42)
    assert.ok(await browser.evaluate(`document.querySelector('.automation-calendar-day').getBoundingClientRect().height>=44`))
    await capture('automation-date')
    await browser.click(byLabel('下个月'))
    await browser.click(`document.querySelector('.automation-calendar-day:not(.outside)')`)
    await browser.click(`document.querySelector('.automation-schedule-value[aria-label^="时间："]')`)
    await browser.wait(`document.querySelector('.mobile-schedule-sheet')!==null`)
    await capture('automation-time')
    await click('17:30')
    assert.match(await browser.evaluate(`document.querySelector('.automation-schedule-value[aria-label^="时间："]').textContent`), /17:30/)
    await capture('automation-form')
    await fill('.automation-name-input', '手机定时验收')
    await fill('.automation-prompt-input', '仅保存手动计划，不执行。')
    await browser.click(byLabel('重复频率'))
    await browser.click(`[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.trim()==='手动触发')`)
    await click('保存')
    await browser.wait(`document.querySelector('.automation-editor-toolbar')?.textContent.includes('已保存')`)
    const saved = (await host.request('automations.list', { status: 'all', limit: 50 })).automations.find(item => item.name === '手机定时验收')
    assert.equal(saved?.schedule.kind, 'manual')
    assert.deepEqual(browser.errors, [])
    assert.equal((await host.request('camps.snapshot', { campId })).agentRuns.length, 0)
    await writeFile(join(output, 'validation.json'), JSON.stringify({ productionEntry: true, realHost: true, runtimeExecution: false, realPhone: false, checks }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({ failedStage: stage, message: error.message }))
    if (browser) { await browser.capture(join(output, 'failure.png')).catch(() => {}); console.log(await browser.evaluate('document.body.innerText.slice(-4500)').catch(() => 'browser unavailable')) }
    throw error
  } finally {
    await browser?.close(); await host.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

test('phone execution shares Desktop evidence, wraps avatars and retains Run disclosures', { timeout: 120_000 }, async t => {
  if (process.platform !== 'darwin' || !await access(executable).then(() => true, () => false)) { t.skip('Requires macOS Chrome'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-mobile-execution-')))
  const output = process.env.ROVAI_MOBILE_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ channel: 'component_fixture', chromeProfile: join(fixture, 'chrome'), host: false, runtime: false }))
  const { productPath } = await buildHostWebParity(join(fixture, 'product'))
  const browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
  try {
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    for (const theme of ['day', 'night']) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      const url = pathToFileURL(productPath); url.search = new URLSearchParams({ surface: 'web', scenario: 'mobile-running', theme }).toString()
      await browser.send('Page.navigate', { url: url.href })
      await browser.wait(`document.querySelector('.mobile-camp-tabs')!==null`)
      await browser.capture(join(output, `messages-${theme}.png`))
      await browser.click(`[...document.querySelectorAll('.mobile-camp-tabs button')].find(e=>e.textContent.trim()==='执行')`)
      await browser.wait(`document.querySelectorAll('.run-pulse-chip').length===10`)
      await browser.click(`document.querySelectorAll('.run-pulse-chip')[0]`)
      await browser.wait(`document.querySelectorAll('.execution-process-stage').length===3`)
      assert.equal(await browser.evaluate(`document.querySelectorAll('.run-pulse-chip').length`), 10)
      const rail = await browser.evaluate(`(()=>{const e=document.querySelector('.run-pulse-list');return {scroll:e.scrollWidth,width:e.clientWidth,rows:[...new Set([...e.children].map(c=>c.getBoundingClientRect().top))].length}})()`)
      assert.equal(rail.scroll, rail.width); assert.ok(rail.rows > 1)
      await browser.capture(join(output, `execution-${theme}.png`))
      await browser.click(`document.querySelector('.execution-process-stage .execution-disclosure summary')`)
      await browser.wait(`document.querySelector('.execution-process-stage .execution-disclosure').open===true`)
      await browser.click(`document.querySelectorAll('.run-pulse-chip')[1]`)
      await browser.click(`document.querySelectorAll('.run-pulse-chip')[0]`)
      await browser.wait(`document.querySelectorAll('.execution-process-stage').length===3 && document.querySelector('.execution-process-stage .execution-disclosure').open===true`)
      await browser.click(`document.querySelector('.tool-group-summary')`)
      await browser.wait(`document.querySelector('.tool-activity-group')?.open===true`)
      await browser.capture(join(output, `execution-command-${theme}.png`))
      for (const width of [360, 430, 844]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width === 844 ? 390 : 844, deviceScaleFactor: 1, mobile: true })
        await browser.wait(`document.documentElement.dataset.mobileWeb==='true'`)
        const size = await browser.evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,body:document.querySelector('.execution-drawer-body').getBoundingClientRect().toJSON()})`)
        assert.equal(size.overflow, false)
        assert.ok(size.body.height > 40, 'execution remains readable after rotating the phone')
        await browser.capture(join(output, `execution-${theme}-${width}.png`))
      }
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      url.search = new URLSearchParams({ surface: 'web', scenario: 'approval', theme }).toString()
      await browser.send('Page.navigate', { url: url.href })
      const allowButton = `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Allow once')`
      await browser.wait(`Boolean(${allowButton}) && !(${allowButton}).disabled`)
      await browser.evaluate(`(${allowButton}).scrollIntoView({block:'nearest'})`)
      const approval = await browser.evaluate(`(${allowButton}).getBoundingClientRect().toJSON()`)
      assert.ok(approval.left >= 0 && approval.right <= 390 && approval.height >= 44, 'native approval option is usable in the phone conversation')
      await browser.capture(join(output, `approval-${theme}.png`))
      await browser.click(allowButton)
      await browser.wait(`!${allowButton}`)
    }
    assert.deepEqual(browser.errors, [])
    await writeFile(join(output, 'execution-validation.json'), JSON.stringify({ productionComponents: true, simulatedEvidence: true, realRuntime: false, widths: [360, 390, 430, 844], themes: ['day', 'night'], checks: ['10-avatar-wrap', '3-runs', 'independent-disclosures-retained-across-member-switch', 'shared-command-group', 'rotation'] }, null, 2))
  } catch (error) { await browser.capture(join(output, 'execution-failure.png')).catch(() => {}); throw error }
  finally { await browser.close(); await rm(fixture, { recursive: true, force: true }) }
})

test('standalone Server phone settings expose native update guidance and hide channels', { timeout: 60_000 }, async t => {
  if (process.platform !== 'darwin' || !await access(executable).then(() => true, () => false)) { t.skip('Requires macOS Chrome'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-mobile-server-')))
  const dataDir = join(fixture, 'server')
  const output = process.env.ROVAI_MOBILE_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), mcpConfigPath: join(dataDir, 'mcp.json'), chromeProfile: join(fixture, 'chrome'), runtime: false }))
  const child = spawn(join(repository, 'target/debug/rovai-server'), ['--data-dir', dataDir, '--web-ui', join(repository, 'out/web'), '--listen', '127.0.0.1:0'], { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; let readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const collect = data => { log = (log + data).slice(-16000); if (log.includes('· Ready')) readyResolve() }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const closed = new Promise(resolve => { child.once('error', error => { readyReject(error); resolve() }); child.once('close', () => { readyReject(new Error('Isolated Server exited before ready')); resolve() }) })
  let browser
  try {
    await within(ready)
    const origin = /Address  (http:\/\/127\.0\.0\.1:\d+)/.exec(log)?.[1]
    assert.ok(origin)
    const token = (await readFile(join(dataDir, 'server-token'), 'utf8')).trim()
    browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.send('Page.navigate', { url: origin })
    await browser.wait(`document.querySelector('#administrator-token')!==null`)
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: token })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('.mobile-bottom-navigation')!==null`)
    await browser.click(`[...document.querySelectorAll('.mobile-bottom-navigation button')].find(e=>e.textContent==='设置')`)
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('.settings-sidebar-menu button')].some(e=>e.textContent.trim()==='渠道')`), false)
    await browser.click(`[...document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent==='关于与更新')`)
    await browser.wait(`document.querySelector('.server-update-entry')!==null`)
    await browser.wait(`/版本 \\d+\\.\\d+/.test(document.querySelector('.about-identity').textContent)`)
    assert.match(await browser.evaluate(`document.querySelector('.about-identity').textContent`), /Server/)
    assert.match(await browser.evaluate(`document.querySelector('.server-update-entry a').href`), /server-preview/)
    await browser.capture(join(output, 'server-about.png'))
    assert.deepEqual(browser.errors, [])
    await writeFile(join(output, 'server-validation.json'), JSON.stringify({ realServer: true, actualUpdateInstall: false, runtime: false, checks: ['server-hides-channels', 'server-only-native-update-entry', 'real-version'] }, null, 2))
  } finally {
    await browser?.close()
    child.kill('SIGINT'); const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
    await closed; clearTimeout(deadline)
    await rm(fixture, { recursive: true, force: true })
  }
})
