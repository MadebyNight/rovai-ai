import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

// Opt-in real Runtime acceptance. HOME must belong to an isolated test account
// with its own native CLI configuration. Credentials are never printed.
const [packageArgument, kind, fixtureArgument] = process.argv.slice(2)
assert.ok(['codex-cli', 'claude-code-cli', 'pi', 'opencode-cli', 'copilot-cli', 'kiro-cli', 'qoder-cli', 'codebuddy-cli', 'qwen-code', 'trae-cn-cli', 'kimi-code-cli', 'grok-build', 'zcode-app', 'antigravity-app'].includes(kind), 'Select an admitted Linux Runtime')
assert.ok(isAbsolute(packageArgument) && isAbsolute(fixtureArgument), 'Package and fixture must be absolute')
const packageRoot = resolve(packageArgument), fixture = resolve(fixtureArgument)
const data = join(fixture, 'data'), project = join(fixture, 'project')
const reportPath = join(fixture, 'result.json')
const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
await mkdir(fixture, { recursive: false, mode: 0o700 })
await mkdir(project, { mode: 0o700 })
await writeFile(join(project, 'README.md'), '# Isolated Linux Server Runtime acceptance\n')
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
execFileSync('git', ['add', 'README.md'], { cwd: project })
execFileSync('git', ['-c', 'user.name=Rovai acceptance', '-c', 'user.email=acceptance@rovai.local', 'commit', '-qm', 'fixture'], { cwd: project })
const binary = join(packageRoot, 'rovai-server')
let child, origin, session, closed, output = ''
const checks = [], runFacts = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { schemaVersion: 1, gate: 'runtime_integration_probe', runtime: kind,
  sourceCommit: manifest.commit, fullQualification: false, dataDir: data,
  skillLibraryRoot: join(data, 'skills'), mcpConfigPath: join(data, 'mcp.json'), checks, runs: runFacts }
console.log(JSON.stringify({ channel: 'automatic_acceptance', ...report }))

async function start() {
  output = ''
  child = spawn(binary, ['--data-dir', data, '--listen', '127.0.0.1:0'], { cwd: fixture, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
  const collect = bytes => { output = (output + bytes).slice(-12000) }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const match = /Address\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    if (match) { origin = match[1]; return }
    assert.equal(child.exitCode, null, 'Server exited before readiness')
    await pause(100)
  }
  throw new Error('Server readiness timed out')
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
  try { assert.deepEqual(await closed, { code: 0, signal: null }) } finally { clearTimeout(timer) }
}
async function request(operation, params = {}) {
  const deadline = Date.now() + 45000
  for (;;) {
    const response = await fetch(origin + '/api/v1/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session }, body: JSON.stringify({ operation, params }), signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, 200, `${operation} HTTP status`)
    const result = await response.json()
    if (result.error?.code === 'subsystem_unavailable' && Date.now() < deadline) { await pause(200); continue }
    if (result.error) throw new Error(`${operation}: ${result.error.code}`)
    return result.result
  }
}
async function execution(campId, agentRunId) {
  const page = await request('agentRunExecution.page', { campId, agentRunId, limit: 96 })
  return [...page.evidence, ...(page.activeEvidence ?? [])]
}
async function send(campId, body) {
  const draft = await request('camp.composerDraft.get', { campId })
  const saved = await request('camp.composerDraft.save', { campId, expectedRevision: draft.revision, content: { version: 2, segments: [{ kind: 'text', text: body }] } })
  const sent = await request('camp.messages.send', { commandId: randomUUID(), campId, draftRevision: saved.revision, execution: { taskId: null, purpose: 'Linux Server Runtime acceptance', completionRole: 'required' } })
  assert.equal(sent.commandResult?.status, 'accepted')
  return sent.commandResult.payload.agentRunIds[0]
}
async function waitRun(campId, id, marker) {
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    const camp = await request('camps.open', { campId, traceId: randomUUID() })
    const run = camp.agentRuns.find(run => run.id === id)
    if (run && ['failed', 'cancelled', 'interrupted', 'rejected'].includes(run.status)) {
      report.failedRun = run
      throw new Error(`Runtime run ${run.status}: ${run.failureCode ?? run.errorCode ?? 'see private fixture'}`)
    }
    if (run?.status === 'succeeded') {
      assert.ok(camp.messages.some(message => message.sourceAgentRunId === id && message.body.includes(marker)), 'Runtime final marker must be publicly projected')
      runFacts.push({ id, status: run.status, conversationId: run.conversationId })
      return { camp, run }
    }
    await pause(500)
  }
  throw new Error('Runtime execution timed out')
}
try {
  await start()
  const administrator = (await readFile(join(data, 'server-token'), 'utf8')).trim()
  const login = await fetch(origin + '/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 2, administratorToken: administrator }) })
  assert.equal(login.status, 200); session = (await login.json()).token
  await request('health.check')
  const installation = await configureProductRuntime(request, kind, ['agent_2'])
  report.runtimeVersion = installation.snapshot.reportedVersion
  report.admission = installation.platformAdmission ?? null
  const profile = await request('members.get', { agentId: 'agent_2' })
  const values = installation.memberRuntimeDefaults.permissions.values
  const configured = await request('members.runtime.set', { commandId: randomUUID(), command: { agentId: 'agent_2', expectedVersion: profile.version, adapterKind: kind, model: profile.runtimeConfiguration.model, permissions: { adapterKind: kind, schemaVersion: 1, values } } })
  assert.equal(configured.status, 'applied')
  checks.push('native_discovery_auth_model_and_permissions')
  const marker = 'ROVAI_SERVER_' + randomUUID().replaceAll('-', '')
  const workspace = await request('workspaces.inspect', { path: project })
  const first = await createConfiguredCampAndSend(request, { commandId: randomUUID(), name: 'Linux Runtime acceptance', workspace, memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', body: `Use tools to write runtime-marker.txt in the current workspace with the single line ${marker}, then read it back. Reply with ${marker}. Do not read files outside this workspace.`, purpose: 'Linux Server tool execution' })
  assert.equal(first.status, 'accepted')
  const campId = first.payload.campId
  const one = await waitRun(campId, first.payload.agentRunIds[0], marker)
  assert.equal((await readFile(join(project, 'runtime-marker.txt'), 'utf8')).trim(), marker)
  const firstEvidence = await execution(campId, one.run.id)
  assert.ok(firstEvidence.some(item => ['command', 'tool_call', 'tool_result', 'file_change'].includes(item.kind)), 'Native tools must appear in the public execution projection')
  report.toolEvidence = firstEvidence.filter(item => item.canonical).map(item => ({ kind: item.kind, phase: item.phase, toolName: item.canonical.toolName, outcome: item.canonical.outcome }))
  checks.push('http_send_native_tool_write_read_and_final_projection')
  await waitRun(campId, await send(campId, 'Repeat the exact marker from your previous response. Do not use tools.'), marker)
  assert.equal(runFacts[1].conversationId, runFacts[0].conversationId)
  checks.push('warm_conversation_continuation')
  await stop(); await start()
  await waitRun(campId, await send(campId, 'Repeat the exact marker from this conversation again. Do not use tools.'), marker)
  assert.equal(runFacts[2].conversationId, runFacts[0].conversationId)
  checks.push('server_restart_persisted_auth_and_cold_conversation_continuation')
  const cancelId = await send(campId, 'Use your shell tool to run sleep 120 in the foreground and wait for it to finish. Set its timeout to at least 150 seconds. Do not run it in the background and do not reply until the command finishes. Do not write files.')
  const deadline = Date.now() + 60000
  let cancelRun, toolStarted = false
  while (Date.now() < deadline) {
    const camp = await request('camps.open', { campId, traceId: randomUUID() }); cancelRun = camp.agentRuns.find(run => run.id === cancelId)
    if (cancelRun?.status === 'running') {
      const evidence = await execution(campId, cancelId)
      toolStarted = evidence.some(item => ['command', 'tool_call'].includes(item.kind) && JSON.stringify(item.payload).includes('sleep 120'))
      if (toolStarted) break
    }
    assert.ok(!cancelRun || !['succeeded', 'failed', 'cancelled'].includes(cancelRun.status), 'Cancellable tool must still be active')
    await pause(250)
  }
  assert.equal(cancelRun?.status, 'running')
  assert.ok(toolStarted, 'Cancel only after the native sleep command appears in public execution evidence')
  const cancel = await request('agentRuns.cancel', { commandId: randomUUID(), command: { campId, agentRunId: cancelId, expectedVersion: cancelRun.version } })
  assert.notEqual(cancel.status, 'rejected')
  for (let i = 0; i < 80; i++) {
    cancelRun = (await request('camps.open', { campId, traceId: randomUUID() })).agentRuns.find(run => run.id === cancelId)
    if (cancelRun.status === 'cancelled') break
    await pause(250)
  }
  assert.equal(cancelRun.status, 'cancelled')
  checks.push('http_cancel_active_native_tool')
  await stop(); report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = error.message
  process.exitCode = 1
} finally {
  try { await stop() } catch (error) { report.shutdownError = error.message; report.status = 'failed'; process.exitCode = 1 }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  // Failed Run details remain private until explicitly sanitized for evidence.
  const { failedRun, ...safe } = report
  console.log(JSON.stringify(safe))
}
