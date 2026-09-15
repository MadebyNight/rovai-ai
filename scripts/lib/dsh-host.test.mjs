import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { apply } from '../../crates/rovai-core/src/dsh/bootstrap.mjs'

test('DSH official prompt seam binds immutable root identity per session and fails closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-dsh-host-test-'))
  try {
    const variables = new Map(), sections = [], events = new Map()
    let denied = [], guard
    apply({ tools: { guard: fn => { guard = fn }, schemas: () => ['mcp__fixture__echo', 'mcp__fixture__native_only', 'read'].map(name => ({ name })) }, systemPrompt: {
      variable: (key, fn) => variables.set(key, fn), section: section => sections.push(section)
    }, on: (name, fn) => events.set(name, fn) }, { bindingRoot: root, observationRoot: root, mcpServerNames: ['fixture'], readOnly: true, approvalPolicy: 'ask' })
    events.get('agent/created')({ agent: { session: { header: {} }, ctx: {
      tools: { restrict: ({ deny }) => { denied = deny; return () => {} } }, on: () => {}
    } } })
    assert.deepEqual(denied, ['mcp__fixture__echo', 'mcp__fixture__native_only'])
    assert(guard({ name: 'mcp__fixture__echo' }))
    assert.equal(guard({ name: 'read' }), undefined)
    assert.equal((await events.get('tools/pre-execute')({ name: 'mcp__fixture__echo' }, async () => ({kind:'allow'}))).kind, 'ask')
    const bootstrap = 'Member A: {{literal}}'
    const binding = { schemaVersion: 1, sessionId: 'session-a', bootstrap,
      sha256: createHash('sha256').update(bootstrap).digest('hex') }
    writeFileSync(join(root, 'session-a.json'), JSON.stringify(binding))
    const render = (id, header = {}) => variables.get('rovai_bootstrap')({ agent: { session: { id, header } } })
    assert.equal(render('session-a'), bootstrap)
    assert.equal(render('session-a'), bootstrap) // same assembly after a native compact
    assert.throws(() => render('session-b'))
    assert.equal(render('session-child', { parentSession: 'session-a' }), '')
    assert.throws(() => render('../session-a'))
    writeFileSync(join(root, 'session-a.json'), JSON.stringify({ ...binding, bootstrap: 'tampered' }))
    assert.throws(() => render('session-a'), /binding_invalid/)
    assert.deepEqual(sections, [{ name: 'rovai:bootstrap', order: 11000, text: '{{rovai_bootstrap}}' }])
    events.get('tools/result')({ name: 'bash', callId: 'call', agent: { session: { id: 'session-a', header: {} } } },
      { isError: false, value: { exitCode: 7, stdout: { text: 'private body' } } })
    const observation = readdirSync(root).find(name => name !== 'session-a.json')
    const result = JSON.parse(readFileSync(join(root, observation), 'utf8'))
    assert.equal(result.exitCode, 7)
    assert.equal(result.sessionId, 'session-a')
    assert.equal(JSON.stringify(result).includes('private body'), false)
    events.get('session/event')({ id: 'session-a', header: {} }, { type: 'assistant/message', seq: 12,
      data: { turn: 2, usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 90 }, message: { content: 'private reply' } } })
    const usageFile = readdirSync(root).find(name => name.includes('.usage-'))
    const usage = JSON.parse(readFileSync(join(root, usageFile), 'utf8'))
    assert.deepEqual(usage.usage, { inputTokens: 10, outputTokens: 3, cacheReadTokens: 90 })
    assert.equal(usage.seq, 12)
    assert.equal(JSON.stringify(usage).includes('private reply'), false)
    const observe = event => events.get('session/event')({ id: 'session-a', header: {} }, event)
    observe({ type:'compaction/start', seq:13, data:{compactionId:'auto-1',turn:2} })
    observe({ type:'compaction/summary', seq:14, data:{compactionId:'auto-1',summary:'private summary',usage:{inputTokens:20,outputTokens:4}} })
    observe({ type:'compaction/end', seq:15, data:{compactionId:'auto-1',turn:2} })
    const compactionFile=readdirSync(root).find(name=>name.endsWith('.usage-14.json'))
    const compaction=JSON.parse(readFileSync(join(root,compactionFile),'utf8'))
    assert.equal(compaction.turn,2)
    assert.equal(compaction.sourceEvent,'compaction/summary')
    assert.deepEqual(compaction.usage,{inputTokens:20,outputTokens:4})
    assert.equal(JSON.stringify(compaction).includes('private summary'),false)
    observe({ type:'compaction/start', seq:16, data:{compactionId:'manual-1',turn:null} })
    observe({ type:'compaction/summary', seq:17, data:{compactionId:'manual-1',usage:{inputTokens:999}} })
    observe({ type:'compaction/end', seq:18, data:{compactionId:'manual-1',turn:null} })
    observe({ type:'compaction/summary', seq:19, data:{compactionId:'auto-1',usage:{inputTokens:999}} })
    assert.equal(readdirSync(root).filter(name=>name.includes('.usage-')).length,2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
