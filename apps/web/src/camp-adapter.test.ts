import { afterEach, expect, it, vi } from 'vitest'
import type { AgentRunExecutionEvidenceView } from '@contracts'
import { ExecutionWindow } from '../../desktop/src/renderer/src/execution-window'
import { ConsoleClient } from './client'
import { createCampAdapter } from './camp-adapter'

// Owns the production Web adapter + execution window seam. A Host-only HTTP
// test bypasses this adapter's allowlist; a populated page hides missing deltas.
afterEach(() => vi.unstubAllGlobals())
it('loads a command after an initially empty Web Run and refreshes its completion', async () => {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  let evidence: AgentRunExecutionEvidenceView[] = []
  const operations: string[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 2, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    const { operation, params } = JSON.parse(String(options?.body))
    operations.push(operation)
    const common = { schemaVersion: 1, campId: 'camp', agentRunId: 'run', throughSequence: evidence.length, hasMore: false }
    if (operation === 'agentRunExecution.page') return Response.json({ result: {
      ...common, requestedBeforeSequence: params.beforeSequence, nextBeforeSequence: null, evidence
    } })
    if (operation === 'agentRunExecution.changes') return Response.json({ result: {
      ...common, requestedAfterSequence: params.afterSequence, nextAfterSequence: evidence.length,
      evidence: evidence.filter(item => item.sequence > params.afterSequence),
      refreshedEvidence: evidence.filter(item => params.refreshEvidenceIds.includes(item.id))
    } })
    throw Error(`Unexpected request: ${operation}`)
  })
  const transport = new ConsoleClient('http://127.0.0.1:8766', fetcher)
  await transport.login('b'.repeat(64))
  const adapter = createCampAdapter(transport, async () => null)
  const client = adapter.environment.client
  const current = new ExecutionWindow('camp', 'run', 12,
    params => client.request('agentRunExecution.page', params), () => undefined,
    params => client.request('agentRunExecution.changes', params))
  try {
    await current.latest()
    expect(current.loaded).toBe(true)
    expect(current.evidence).toEqual([])
    evidence = [{ id: 'command', agentRunId: 'run', executionEpoch: 1, sequence: 1,
      eventType: 'command.started', kind: 'command', phase: 'started',
      payload: { command: 'printf WEB_LIVE_COMMAND_MARKER' }, contentBlobId: null,
      contentByteCount: 0, isTruncated: false, occurredAt: '2026-09-14T00:00:00Z' }]
    await current.refresh()
    expect(current.evidence).toEqual(evidence)
    evidence = [{ ...evidence[0], eventType: 'command.completed', phase: 'completed', payload: { command: 'printf WEB_LIVE_COMMAND_MARKER', exitCode: 0 } }]
    await current.refresh()
    expect(current.evidence[0].phase).toBe('completed')
    expect(operations).toEqual(['agentRunExecution.page', 'agentRunExecution.changes', 'agentRunExecution.changes'])
  } finally { current.dispose(); transport.clear() }
})
