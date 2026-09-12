import { describe, expect, it, vi } from 'vitest'
import type { AgentRunExecutionWindowPage } from '@contracts'
import { ExecutionWindow, executionWindowPageSize, type ExecutionWindowRequest } from './execution-window'

function page(before: number | null, limit = 12, through = 100): AgentRunExecutionWindowPage {
  const end = Math.min(through, (before ?? through + 1) - 1)
  const start = Math.max(1, end - limit + 1)
  return {
    schemaVersion: 1, campId: 'camp', agentRunId: 'run', requestedBeforeSequence: before,
    nextBeforeSequence: start > 1 ? start : null, throughSequence: through, hasMore: start > 1,
    evidence: Array.from({ length: end - start + 1 }, (_, offset) => ({
      id: `e-${start + offset}`, agentRunId: 'run', executionEpoch: 1, sequence: start + offset,
      eventType: 'agent.text.block', kind: 'narration', phase: 'completed',
      payload: { text: `text ${start + offset}` }, contentBlobId: null, contentByteCount: 10,
      isTruncated: false, occurredAt: '2026-09-12T00:00:00Z'
    }))
  }
}

describe('bounded execution window', () => {
  it('restores visited pages and jumps to cached latest even when the transport is offline', async () => {
    let offline = false
    const request = vi.fn<ExecutionWindowRequest>(async params => {
      if (offline) throw new Error('offline')
      return page(params.beforeSequence)
    })
    const window = new ExecutionWindow('camp', 'run', 12, request, () => {})
    await window.latest()
    for (let index = 0; index < 4; index++) await window.earlier()
    await Promise.resolve()
    const count = request.mock.calls.length
    offline = true
    for (let index = 0; index < 3; index++) await window.newer()
    expect(window.error).toBeNull()
    expect(window.evidence.at(-1)?.sequence).toBe(100)
    await window.latest()
    expect(window.error).toBeNull()
    expect(window.visible).toEqual([0])
    expect(request).toHaveBeenCalledTimes(count)
  })

  it('caches live updates while reading history and only adopts them on return to latest', async () => {
    let updated = false
    const request = vi.fn<ExecutionWindowRequest>(async params => {
      const result = page(params.beforeSequence)
      if (updated && params.beforeSequence === null) result.evidence.at(-1)!.payload = { text: 'updated latest' }
      return result
    })
    const window = new ExecutionWindow('camp', 'run', 12, request, () => {})
    await window.latest()
    await window.earlier()
    await window.earlier()
    const history = window.evidence
    updated = true
    await window.refresh(() => false)
    expect(window.evidence).toEqual(history)
    const count = request.mock.calls.length
    await window.latest()
    expect(request).toHaveBeenCalledTimes(count)
    expect(window.evidence.at(-1)?.payload).toEqual({ text: 'updated latest' })
  })

  it('loads a viewport page, prefetches exactly one neighbor and bounds both data and mounted pages across navigation', async () => {
    const request = vi.fn<ExecutionWindowRequest>(async params => page(params.beforeSequence, params.limit))
    const changed = vi.fn()
    const window = new ExecutionWindow('camp', 'run', 12, request, changed)
    await window.latest()
    await vi.waitFor(() => expect(window.pages.size).toBe(2))
    expect(request.mock.calls.map(([params]) => params.beforeSequence)).toEqual([null, 89])
    expect(window.evidence).toHaveLength(12)
    expect(window.visible).toEqual([0])
    await window.earlier()
    await vi.waitFor(() => expect(window.pages.size).toBe(3))
    expect(window.evidence).toHaveLength(24)
    await window.earlier()
    await vi.waitFor(() => expect(window.pages.has(65)).toBe(true))
    expect(window.visible).toEqual([1, 2])
    expect(window.pages.size).toBe(4)
    expect(window.hasNewer).toBe(true)
    expect(window.evidence[0].sequence).toBe(65)
    await window.newer()
    expect(window.visible).toEqual([0, 1])
    expect(window.evidence.at(-1)?.sequence).toBe(100)
    expect(window.pages.size).toBeLessThanOrEqual(12)
    expect(executionWindowPageSize(300)).toBeLessThan(executionWindowPageSize(900))
    expect(executionWindowPageSize(4000)).toBe(48)
  })

  it('keeps successful content after a page failure, retries on demand and rejects mixed Camp/cursor data', async () => {
    let fail = true
    const request = vi.fn<ExecutionWindowRequest>(async params => {
      if (params.beforeSequence !== null && fail) throw new Error('offline')
      return page(params.beforeSequence)
    })
    const window = new ExecutionWindow('camp', 'run', 12, request, () => {})
    await window.latest()
    await window.earlier()
    expect(window.error).toBe('offline')
    expect(window.evidence.at(-1)?.sequence).toBe(100)
    fail = false
    await window.retry()
    expect(window.error).toBeNull()
    expect(window.evidence).toHaveLength(24)
    const invalid = new ExecutionWindow('camp', 'run', 12, async () => ({ ...page(null), campId: 'another' }), () => {})
    await invalid.latest()
    expect(invalid.error).toContain('不兼容')
    expect(invalid.evidence).toEqual([])
  })

  it('evicts older cached pages within budget, reloads them automatically and retries in the failed direction', async () => {
    let fail = false
    const request = vi.fn<ExecutionWindowRequest>(async params => {
      if (fail) throw new Error('offline')
      return page(params.beforeSequence)
    })
    const window = new ExecutionWindow('camp', 'run', 12, request, () => {}, { maxPages: 4, maxBytes: 1_000_000 })
    await window.latest()
    for (let index = 0; index < 4; index++) {
      await window.earlier()
      await Promise.resolve()
      expect(window.visible.length).toBeLessThanOrEqual(2)
      expect(window.pages.size).toBeLessThanOrEqual(4)
    }
    const reading = window.evidence
    fail = true
    await window.newer()
    expect(window.error).toBe('offline')
    expect(window.evidence).toEqual(reading)
    fail = false
    await window.retry()
    expect(window.error).toBeNull()
    expect(window.visible).toEqual([2, 3])
    fail = true
    const reads = request.mock.calls.length
    await window.latest()
    expect(window.error).toBeNull()
    expect(window.visible).toEqual([0])
    // An evicted older neighbor may prefetch again, but the pinned latest never rereads.
    expect(request.mock.calls.slice(reads).every(([params]) => params.beforeSequence !== null)).toBe(true)
  })

  it('evicts by payload bytes while retaining visible pages, the latest page and one neighbor', async () => {
    const request = vi.fn<ExecutionWindowRequest>(async params => page(params.beforeSequence))
    const window = new ExecutionWindow('camp', 'run', 12, request, () => {}, { maxPages: 12, maxBytes: 1 })
    await window.latest()
    for (let index = 0; index < 4; index++) await window.earlier()
    await Promise.resolve()
    expect(window.pages.size).toBeLessThanOrEqual(4)
    expect(window.pages.has(null)).toBe(true)
    expect(window.evidence).toHaveLength(24)
  })

  it('discards late responses after leaving a Run and refreshes the live cache without replacing history', async () => {
    let resolve!: (value: AgentRunExecutionWindowPage) => void
    const changed = vi.fn()
    const window = new ExecutionWindow('camp', 'run', 12, () => new Promise(done => { resolve = done }), changed)
    const loading = window.latest()
    window.dispose()
    changed.mockClear()
    resolve(page(null))
    await loading
    expect(window.evidence).toEqual([])
    expect(changed).not.toHaveBeenCalled()

    const request = vi.fn<ExecutionWindowRequest>(async params => page(params.beforeSequence))
    const current = new ExecutionWindow('camp', 'run', 12, request, () => {})
    await current.latest()
    await current.earlier()
    await current.earlier()
    const count = request.mock.calls.length
    await current.refresh()
    expect(request).toHaveBeenCalledTimes(count + 1)
    expect(current.visible).toEqual([1, 2])
    await current.latest()
    expect(current.visible).toEqual([0])
    expect(current.hasNewer).toBe(false)
  })

  it('fences an in-flight refresh from historical reading and rebases shifted cursors only on a latest jump', async () => {
    let through = 100
    let resolve!: (value: AgentRunExecutionWindowPage) => void
    const request = vi.fn<ExecutionWindowRequest>(async params => {
      if (params.beforeSequence === null && through > 100) return new Promise(done => { resolve = done })
      return page(params.beforeSequence, params.limit, through)
    })
    const changed = vi.fn()
    const window = new ExecutionWindow('camp', 'run', 12, request, changed)
    await window.latest()
    through = 153
    let following = true
    const refreshing = window.refresh(() => following)
    await window.earlier()
    await window.earlier()
    following = false
    const reading = window.evidence
    changed.mockClear()
    resolve(page(null, 12, through))
    await refreshing
    expect(window.evidence).toEqual(reading)
    expect(changed).not.toHaveBeenCalled()
    await window.newer()
    expect(window.evidence.at(-1)?.sequence).toBe(100)
    const latestReads = request.mock.calls.filter(([params]) => params.beforeSequence === null).length
    await window.latest()
    expect(window.evidence.map(item => item.sequence)).toEqual(Array.from({ length: 12 }, (_, index) => 142 + index))
    expect(request.mock.calls.filter(([params]) => params.beforeSequence === null)).toHaveLength(latestReads)
    await window.earlier()
    expect(window.evidence.map(item => item.sequence)).toEqual(Array.from({ length: 24 }, (_, index) => 130 + index))
  })
})
