import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { launchHost, within } from './lib/host-test-client.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'
import { launchAcceptanceBrowser, pause } from './lib/host-web-browser.mjs'

const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-web-recovery-')))
const data = join(fixture, 'data'), skills = join(fixture, 'skills')
const output = resolve(process.env.ROVAI_RECOVERY_OUTPUT ?? join(fixture, 'evidence'))
await mkdir(skills); await mkdir(output, { recursive: true })
console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir: data, skillLibraryRoot: skills, mcpConfigPath: join(data, 'mcp.json'), runtime: false }))
const host = launchHost(join(root, 'target/debug/rovai-host'), [...coreDataDirectoryArguments(data), '--skill-library-root', skills, '--mcp-config-path', join(data, 'mcp.json')], { cwd: fixture })
let browser, stage = 'startup'
const ready = `document.querySelector('.unified-sidebar')!==null && document.querySelector('.web-login-overlay')===null`
const composer = `document.querySelector('#camp-message')`
const choose = name => `[...document.querySelectorAll('.camp-nav-open')].find(e=>e.title===${JSON.stringify(name)})`
const session = `JSON.parse(sessionStorage.getItem('rovai.web.session.v1'))`
const selected = name => `document.querySelector('.camp-nav-row.selected .camp-nav-open')?.title===${JSON.stringify(name)}`
const reload = async () => {
  const previous = await browser.evaluate('performance.timeOrigin')
  await browser.send('Page.reload')
  await browser.wait(`performance.timeOrigin!==${previous} && (${ready})`)
}
try {
  await within(host.ready)
  const members = await host.request('members.list')
  for (const name of ['Refresh A', 'Refresh B']) await host.request('camps.create', { commandId: crypto.randomUUID(), name, workspace: null, memberAgentIds: [members[0].agentId], defaultLeadAgentId: members[0].agentId, collaborationMode: 'peer' })
  const web = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: join(root, 'out/web') })
  browser = await launchAcceptanceBrowser({ executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'browser')}`, 'about:blank'] })
  await browser.send('Page.navigate', { url: web.origin })
  await browser.wait(`document.querySelector('#administrator-token')!==null`)
  await browser.click(`document.querySelector('#administrator-token')`)
  await browser.send('Input.insertText', { text: web.administratorToken })
  await browser.click(`document.querySelector('.web-login .primary-button')`)
  await browser.wait(ready)
  await browser.wait(`${choose('Refresh A')}!==undefined`)
  await browser.click(choose('Refresh A'))
  await browser.wait(`${composer}?.getAttribute('contenteditable')==='true'`)
  const clientId = await browser.evaluate(`${session}.editor.clientId`)
  stage = 'unsaved composer reload'
  await browser.click(composer)
  await browser.send('Input.insertText', { text: 'Before autosave — 刷新仍保留' })
  console.log('before reload', await browser.evaluate(`({text:${composer}.innerText,recovery:sessionStorage.getItem('rovai.web.edits.v1')!==null})`))
  await reload()
  console.log('after reload', await browser.evaluate(`({sameEditor:${session}.editor.clientId===${JSON.stringify(clientId)},recovery:sessionStorage.getItem('rovai.web.edits.v1')!==null})`))
  await browser.wait(`${selected('Refresh A')} && ${composer}?.innerText.includes('刷新仍保留')`)
  assert.equal(await browser.evaluate(`${session}.editor.clientId`), clientId)
  assert.equal(await browser.evaluate(`document.body.innerText.includes('已连接 Host')`), false)
  assert.ok(await browser.evaluate(`document.querySelector('.navigation-browser-control').getBoundingClientRect().left < 20`))
  stage = 'shared browser navigation'
  await browser.click(choose('Refresh B')); await browser.wait(selected('Refresh B'))
  await browser.click(`document.querySelector('button[aria-label="后退"]')`); await browser.wait(selected('Refresh A'))
  await browser.evaluate('history.forward()'); await browser.wait(selected('Refresh B'))
  await browser.evaluate('history.back()'); await browser.wait(selected('Refresh A'))
  await reload(); await browser.wait(selected('Refresh A'))
  await browser.click(`document.querySelector('button[aria-label="前进"]')`); await browser.wait(selected('Refresh B'))
  await browser.evaluate('history.back()'); await browser.wait(selected('Refresh A'))
  await browser.capture(join(output, 'web-recovery-day.png'))
  stage = 'copied tab isolation'
  // window.open copies the opener's sessionStorage, the same hazard as Duplicate Tab.
  await browser.evaluate('window.copiedTab = window.open(location.href); true')
  await browser.wait(`window.copiedTab?.document.querySelector('.unified-sidebar') && !window.copiedTab.document.querySelector('.web-login-overlay')`)
  await browser.wait(`[...window.copiedTab.document.querySelectorAll('.camp-nav-open')].some(e=>e.title==='Refresh A')`)
  await browser.evaluate(`[...window.copiedTab.document.querySelectorAll('.camp-nav-open')].find(e=>e.title==='Refresh A').click();true`)
  await browser.wait(`window.copiedTab.document.querySelector('#camp-message')?.getAttribute('contenteditable')==='true'`)
  assert.equal(await browser.evaluate(`JSON.parse(window.copiedTab.sessionStorage.getItem('rovai.web.session.v1')).editor.clientId !== ${session}.editor.clientId`), true)
  assert.equal(await browser.evaluate(`window.copiedTab.document.querySelector('#camp-message').innerText.trim()`), '')
  assert.equal(await browser.evaluate(`${composer}.innerText.includes('刷新仍保留')`), true)
  await browser.evaluate(`(()=>{window.copiedTab.document.querySelector('#camp-message').focus();window.copiedTab.document.execCommand('insertText',false,'独立标签页草稿');return true})()`)
  await pause(800)
  await browser.evaluate(`(()=>{const d=window.copiedTab.document;d.querySelector('.sidebar-settings-entry button').click();return true})()`)
  await browser.wait(`window.copiedTab.document.querySelector('.settings-sidebar-menu')!==null`)
  await browser.evaluate(`[...window.copiedTab.document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent.trim()==='远程连接').click();true`)
  await browser.wait(`[...window.copiedTab.document.querySelectorAll('button')].some(e=>e.textContent.trim()==='退出登录')`)
  await browser.evaluate(`[...window.copiedTab.document.querySelectorAll('button')].find(e=>e.textContent.trim()==='退出登录').click();true`)
  await browser.wait(`window.copiedTab.document.querySelector('#administrator-token')!==null`)
  await browser.evaluate('window.copiedTab.close();true')
  await reload(); await browser.wait(`${selected('Refresh A')} && ${composer}?.innerText.includes('刷新仍保留')`)
  assert.equal(await browser.evaluate(`${session}.editor.clientId`), clientId)
  assert.equal((await host.request('host.web.status')).enabled, true)
  assert.equal(await browser.evaluate(`(()=>{const s=${session};return Object.values(localStorage).some(value=>value.includes(s.token)||value.includes(s.editor.proof))})()`), false)
  await browser.evaluate(`document.documentElement.dataset.theme='night'`)
  await browser.capture(join(output, 'web-recovery-night.png'))
  assert.deepEqual(browser.errors, [])
  await writeFile(join(output, 'validation.json'), JSON.stringify({ status: 'passed', platform: process.platform, realHost: true, productionWeb: true, noRuntime: true, sameEditorAfterReload: true, unsavedComposerRestored: true, browserAndPageNavigation: true, forwardAfterRefresh: true, copiedTabIndependent: true, copiedLogoutKeepsOriginal: true, controlsStartLeft: true }, null, 2)+'\n')
  console.log(JSON.stringify({ status: 'passed', evidence: output }))
} catch (error) {
  console.error('Web recovery acceptance failed at', stage)
  if (browser) await browser.capture(join(output, 'failure.png')).catch(() => {})
  throw error
} finally {
  if (browser) await browser.close()
  await host.close()
  await removeEphemeralRuntimeCampFilesRoot(data)
  await rm(fixture, { recursive: true, force: true })
}
