import assert from 'node:assert/strict'
import { access, mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { launchHost, within } from './host-test-client.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
// Actual Rust resource authorization + production React viewer + Chrome CSP.
// No daily data, native App, model, or network dependency is used by this fixture.
test('Web HTML attachments render, remain isolated, expose original source and recover after refresh', { timeout: 90_000 }, async t => {
  if (process.platform !== 'darwin') { t.skip('macOS Chrome acceptance; other platforms remain separately unverified'); return }
  const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (!await access(executable).then(() => true, () => false)) { t.skip('Chrome unavailable'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-web-html-')))
  const dataDir = join(fixture, 'core')
  const host = launchHost(process.env.ROVAI_HOST_BIN ?? join(repository, 'target/debug/rovai-host'), [
    ...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')
  ], { cwd: repository })
  let browser
  try {
    await within(host.ready)
    const profiles = await host.request('members.list')
    await host.request('camps.create', { commandId: crypto.randomUUID(), name: 'HTML attachment acceptance', workspace: null, memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' })
    const service = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: join(repository, 'out/web') })
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Interactive attachment</title><style>body{margin:0;background:rgb(236,238,239)}button{position:absolute;left:20px;top:60px;width:200px;height:40px}h1{font:24px sans-serif}</style></head><body><h1>Rendered HTML</h1><button id="run">Run interaction</button><p id="result"></p><script>
      let parentBlocked=false, storageBlocked=false;
      try { parent.sessionStorage.getItem('acceptance-sentinel'); } catch { parentBlocked=true; }
      try { sessionStorage.setItem('preview-test','forbidden'); } catch { storageBlocked=true; }
      const report=()=>parent.postMessage({type:'html-acceptance',parentBlocked,storageBlocked,color:getComputedStyle(document.body).backgroundColor,clicked:document.querySelector('#result').textContent},'*');
      document.querySelector('#run').onclick=()=>{document.querySelector('#result').textContent='INTERACTION_OK';report();const missing=new Image();missing.src='./missing-local-image.png';document.body.append(missing)};report();
    </script></body></html>`
    const file = join(fixture, 'interactive.html'); await writeFile(file, html)
    browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
    await browser.send('Page.navigate', { url: service.origin })
    await browser.wait(`document.querySelector('#administrator-token') !== null`)
    assert.equal(await browser.evaluate(`document.querySelector('#administrator-token').placeholder`), '输入 64 位的 Token')
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: service.administratorToken })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('.web-login-overlay') === null`)
    await browser.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('HTML attachment acceptance'))`)
    await browser.wait(`document.querySelector('.conversation-controls .composer-file-input:not(:disabled)') !== null`)
    await browser.evaluate(`sessionStorage.setItem('acceptance-sentinel','private');window.htmlAcceptance=[];addEventListener('message',e=>{if(e.source===document.querySelector('.file-preview-html')?.contentWindow&&e.origin==='null'&&e.data?.type==='html-acceptance')window.htmlAcceptance.push(e.data)})`)
    await browser.setFiles('.conversation-controls .composer-file-input', [file])
    await browser.wait(`document.querySelector('.composer-attachment-card .attachment-open:not(:disabled)') !== null`)
    await browser.click(`document.querySelector('.composer-attachment-card .attachment-open')`)
    await browser.wait(`document.querySelector('.file-preview-html-stage')?.dataset.documentState==='loaded' && window.htmlAcceptance.length>0`)
    const actual = await browser.evaluate('window.htmlAcceptance.at(-1)')
    assert.equal(actual.parentBlocked, true); assert.equal(actual.storageBlocked, true)
    assert.equal(actual.color, 'rgb(236, 238, 239)')
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html').sandbox.value`), 'allow-scripts')
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html-stage').dataset.channelState`), 'connected')
    await browser.evaluate('new Promise(resolve=>setTimeout(resolve,300))')
    const point = await browser.evaluate(`(()=>{const r=document.querySelector('.file-preview-html').getBoundingClientRect();return{x:r.x+120,y:r.y+80}})()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await browser.wait(`window.htmlAcceptance.at(-1)?.clicked==='INTERACTION_OK'`)
    await browser.wait(`document.querySelector('.file-preview-html-stage')?.dataset.resourceState==='partial-failure'`)
    await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 4 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 4 })
    await browser.wait(`document.querySelector('input[aria-label="查找文件内容"]') !== null`)
    await browser.send('Input.insertText', { text: 'Rendered HTML' })
    await browser.wait(`document.body.textContent.includes('共 1 处匹配')`)
    await browser.key('Escape')
    await browser.capture('/tmp/rovai-web-html-rendered.png')
    const toggleSource = async label => {
      const target = await browser.evaluate(`(()=>{const r=document.querySelector('.file-preview-tab-activate').getBoundingClientRect();return{x:r.x+40,y:r.y+r.height/2}})()`)
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'right', clickCount: 1 })
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'right', clickCount: 1 })
      await browser.click(`[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent===${JSON.stringify(label)})`)
    }
    await toggleSource('查看源码')
    await browser.wait(`document.querySelector('.file-preview-html-source')?.textContent.includes('Rendered HTML')`)
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html-source').textContent.includes('data-rovai-preview-diagnostic')`), false)
    await toggleSource('交互预览')
    assert.equal(await browser.evaluate(`window.htmlAcceptance.at(-1).clicked`), 'INTERACTION_OK', 'source toggle preserves iframe interaction state')
    await browser.send('Page.reload')
    await browser.wait(`document.querySelector('.composer-attachment-card .attachment-open:not(:disabled)') !== null`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-login-overlay')===null`), true)
    // Composer drafts restore their exact attachment locator; file tabs may be
    // reopened explicitly without changing editor ownership or requiring Token.
    if (!await browser.evaluate(`document.querySelector('.file-preview-html')!==null`)) await browser.click(`document.querySelector('.composer-attachment-card .attachment-open')`)
    await browser.wait(`document.querySelector('.file-preview-html-stage')?.dataset.documentState==='loaded'`)
    await browser.click(`document.querySelector('[aria-label="关闭 interactive.html"]')`)
    await browser.wait(`document.querySelector('.file-preview-html')===null`)
    assert.deepEqual(browser.errors, [])
    console.log(JSON.stringify({ rendered: true, realClick: true, originalSource: true, isolated: true, refresh: true, released: true }))
  } catch (error) {
    if (browser) console.log(JSON.stringify(await browser.evaluate(`({samples:window.htmlAcceptance,frame:document.querySelector('.file-preview-html')?.getBoundingClientRect().toJSON()})`).catch(()=>null)))
    if (browser) await browser.capture('/tmp/rovai-web-html-failure.png').catch(() => {})
    throw error
  } finally {
    await browser?.close(); await host.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})
