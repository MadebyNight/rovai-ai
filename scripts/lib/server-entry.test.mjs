import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '../..')
const executable = process.platform === 'win32' ? 'rovai-server.exe' : 'rovai-server'
const binary = process.env.ROVAI_SERVER_BIN ?? join(root, 'target/debug', executable)

test('Server default root is account scoped and independent of working directory', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-server-paths-')))
  try {
    const paths = JSON.parse(execFileSync(binary, ['paths'], { cwd: fixture, encoding: 'utf8' }))
    assert.equal(paths.dataDir, join(process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME, '.rovai-server'))
    assert.equal(paths.database, join(paths.dataDir, 'rovai.sqlite'))
    assert.ok(paths.runtimeCampFilesRoot.startsWith(join(paths.dataDir, 'instances') + sep))
    assert.deepEqual(await readdir(fixture), [])
    assert.throws(() => execFileSync(binary, ['--data-dir', 'relative', 'paths'], { stdio: 'pipe' }))
  } finally { await rm(fixture, { recursive: true, force: true }) }
})

// Owns the installed-entry -> shared Core -> HTTP -> persistent root seam.
// HOME is overridden only in the isolated child process, never in the test
// runner or user's shell. No Runtime/model is launched.
test('Native Server default and custom roots retain data and token, reject another owner, and never write Desktop resources', {
  timeout: 120_000,
  skip: process.platform === 'win32' ? 'Windows console shutdown requires its native console acceptance; path and installer checks run independently' : false
}, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-server-entry-')))
  const home = join(fixture, 'account'), install = join(fixture, 'program'), desktop = join(home, '.rovai')
  await mkdir(join(desktop, 'skills'), { recursive: true })
  let installedBinary = join(install, executable)
  if (process.env.ROVAI_SERVER_RELEASE_DIR) {
    const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
    execFileSync('/bin/sh', [join(root, 'scripts/install-server.sh'), '--version', version, '--from-dir', process.env.ROVAI_SERVER_RELEASE_DIR, '--prefix', install, '--bin-dir', join(fixture, 'bin'), '--no-modify-path'], { env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: 'pipe' })
    installedBinary = join(install, 'current', executable)
  } else {
    await mkdir(join(install, 'web-ui'), { recursive: true }); await cp(binary, installedBinary)
    await writeFile(join(install, 'web-ui/index.html'), '<!doctype html><title>Matched package UI</title><h1>Shared Host</h1>')
  }
  await writeFile(join(desktop, 'mcp.json'), 'desktop sentinel')
  await writeFile(join(desktop, 'skills/sentinel'), 'desktop skill')
  const processes = []
  const start = args => {
    const child = spawn(installedBinary, [...args, '--listen', '127.0.0.1:0'], { cwd: fixture, env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; let resolveReady, rejectReady
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject }); void ready.catch(() => {})
    const collect = chunk => { output += chunk; if (output.includes('Host Core is ready')) resolveReady() }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { rejectReady(new Error(output)); resolve({ code, signal }) }) })
    const host = { child, ready, closed, output: () => output, origin: () => /origin="(http:\/\/127\.0\.0\.1:\d+)"/.exec(output)?.[1] }
    processes.push(host); return host
  }
  const wait = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Server entry step timed out')), 20000); timer.unref() })])
  const call = async (host, token, operation, params = {}) => {
    const login = await fetch(`${host.origin()}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 2, administratorToken: token }) })
    assert.equal(login.status, 200)
    const session = await login.json()
    const deadline = Date.now() + 15_000
    for (;;) {
      const response = await fetch(`${host.origin()}/api/v1/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ operation, params }) })
      const result = await response.json(); assert.equal(response.status, 200)
      if (result.error?.code === 'subsystem_unavailable' && result.error?.details?.state === 'initializing' && Date.now() < deadline) { await delay(50); continue }
      assert.equal(result.error, null, JSON.stringify(result.error)); return result.result
    }
  }
  try {
    for (const [name, args, data] of [['default', [], join(home, '.rovai-server')], ['custom', ['--data-dir', join(fixture, 'custom')], join(fixture, 'custom')]]) {
      console.log(JSON.stringify({ channel: 'automatic_acceptance', name, dataDir: data, skillLibraryRoot: join(data, 'skills'), mcpConfigPath: join(data, 'mcp.json'), runtime: false }))
      const first = start(args); await wait(first.ready)
      assert.ok(first.origin(), first.output())
      const token = await readFile(join(data, 'server-token'), 'utf8')
      assert.equal(first.output().includes(token), false)
      assert.ok((await fetch(first.origin())).status === 200)
      const config = await call(first, token, 'mcp.config.get')
      const created = await call(first, token, 'mcp.servers.create', { expectedConfigDigest: config.configDigest, definitionJson: JSON.stringify({ mcpServers: { 'server-only': { command: 'not-executed-fixture', args: [] } } }) })
      assert.equal(created.status, 'ok')
      const source = join(fixture, `${name}-skill`); await mkdir(source)
      await writeFile(join(source, 'SKILL.md'), `---\nname: ${name}-skill\ndescription: Isolated Server storage acceptance.\n---\nThis skill is stored, never executed.\n`)
      const inspected = await call(first, token, 'skills.import.inspect', { path: source })
      assert.equal(inspected.candidates.length, 1)
      const imported = await call(first, token, 'skills.import.commit', { commandId: randomUUID(), command: { stagingToken: inspected.stagingToken, candidateName: inspected.candidates[0].name, expectedDigest: inspected.candidates[0].contentDigest, expectedSkillVersion: null, confirmUpdate: false } })
      assert.equal(imported.status, 'applied', JSON.stringify(imported))
      const skills = await call(first, token, 'skills.list'); assert.ok(skills.some(skill => skill.name === `${name}-skill`))
      await access(join(data, 'rovai.sqlite')); await access(join(data, 'mcp.json')); await access(join(data, 'skills')); await access(join(data, 'logs/server.log'))
      const instances = await readdir(join(data, 'instances')); assert.equal(instances.length, 1)
      await access(join(data, 'instances', instances[0], 'runtime-files/.runtime-camp-files-root.json'))
      const before = await call(first, token, 'navigation.snapshot')
      const second = start(args); assert.equal((await wait(second.closed)).code, 1); assert.match(second.output(), /owned_by_active_core/)
      first.child.kill('SIGTERM'); assert.deepEqual(await wait(first.closed), { code: 0, signal: null }, first.output())
      const reopened = start(args); await wait(reopened.ready)
      assert.equal(await readFile(join(data, 'server-token'), 'utf8'), token)
      assert.deepEqual(await call(reopened, token, 'navigation.snapshot'), before)
      assert.equal((await call(reopened, token, 'mcp.config.get')).configDigest, created.config.configDigest)
      assert.deepEqual(await call(reopened, token, 'skills.list'), skills)
      reopened.child.kill('SIGINT'); assert.deepEqual(await wait(reopened.closed), { code: 0, signal: null }, reopened.output())
      assert.match(await readFile(join(data, 'logs/server.log'), 'utf8'), /Host Core stopped after durable settlement/)
      assert.equal((await readFile(join(data, 'logs/server.log'), 'utf8')).includes(token), false)
      // A previously admitted instance with a lost DB must not become a fresh empty instance.
      await rm(join(data, 'rovai.sqlite'))
      const lostDatabase = start(args); assert.equal((await wait(lostDatabase.closed)).code, 1)
      await assert.rejects(access(join(data, 'rovai.sqlite')), { code: 'ENOENT' })
    }
    assert.equal(await readFile(join(desktop, 'mcp.json'), 'utf8'), 'desktop sentinel')
    assert.equal(await readFile(join(desktop, 'skills/sentinel'), 'utf8'), 'desktop skill')
    await assert.rejects(access(join(desktop, 'instances')), { code: 'ENOENT' })
    const desktopRoot = start(['--data-dir', desktop]); assert.equal((await wait(desktopRoot.closed)).code, 1); assert.match(desktopRoot.output(), /server_legacy_layout/)
    assert.equal(await readFile(join(desktop, 'mcp.json'), 'utf8'), 'desktop sentinel')
    await assert.rejects(access(join(desktop, 'server-layout.json')), { code: 'ENOENT' })
    const legacy = join(fixture, 'legacy'); await mkdir(legacy); await writeFile(join(legacy, 'rovai.sqlite'), 'legacy sentinel')
    const refused = start(['--data-dir', legacy]); assert.equal((await wait(refused.closed)).code, 1); assert.match(refused.output(), /server_legacy_layout/)
    assert.equal(await readFile(join(legacy, 'rovai.sqlite'), 'utf8'), 'legacy sentinel')
    assert.deepEqual(await readdir(legacy), ['rovai.sqlite'])
    const outside = join(fixture, 'outside'); await mkdir(outside)
    const alias = join(fixture, 'alias'); await symlink(outside, alias)
    const throughAlias = start(['--data-dir', join(alias, 'new-root')])
    assert.equal((await wait(throughAlias.closed)).code, 1); assert.match(throughAlias.output(), /symlink component/)
    assert.deepEqual(await readdir(outside), [], 'path checks must precede preparation through a symlink ancestor')
    const oldDefault = join(desktop, 'server'); await mkdir(oldDefault); await writeFile(join(oldDefault, 'rovai.sqlite'), 'old preview')
    const oldDefaultHint = start([]); assert.equal((await wait(oldDefaultHint.closed)).code, 1); assert.match(oldDefaultHint.output(), /previous preview data exists/)
    assert.equal(await readFile(join(oldDefault, 'rovai.sqlite'), 'utf8'), 'old preview')
  } finally {
    for (const host of processes) { if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGKILL'); await wait(host.closed).catch(() => {}) }
    await rm(fixture, { recursive: true, force: true })
  }
})
