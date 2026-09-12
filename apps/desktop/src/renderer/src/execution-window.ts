import type { AgentRunExecutionWindowPage } from '@contracts'

export type ExecutionWindowRequest = (params: {
  campId: string
  agentRunId: string
  beforeSequence: number | null
  limit: number
}) => Promise<AgentRunExecutionWindowPage>

type Direction = 'earlier' | 'newer' | 'latest'
type CacheBudget = { maxPages: number; maxBytes: number }
const DEFAULT_CACHE_BUDGET: CacheBudget = { maxPages: 12, maxBytes: 8 * 1024 * 1024 }

/** Two mounted pages; visited data has a separate, bounded LRU cache. */
export class ExecutionWindow {
  readonly pages = new Map<number | null, AgentRunExecutionWindowPage>()
  visible: number[] = []
  loading = false
  error: string | null = null
  direction: Direction = 'latest'
  private generation = 0
  private cursors = new Map<number, number | null>([[0, null]])
  private pending = new Map<number | null, Promise<AgentRunExecutionWindowPage>>()
  // Keep the reading chain stable while the live head advances in the cache.
  private head: AgentRunExecutionWindowPage | null = null
  private refreshing = false
  private queuedRefresh: (() => boolean) | null = null
  private sizes = new WeakMap<AgentRunExecutionWindowPage, number>()

  constructor(
    readonly campId: string,
    readonly agentRunId: string,
    readonly limit: number,
    private readonly request: ExecutionWindowRequest,
    private readonly changed: () => void,
    private readonly budget: CacheBudget = DEFAULT_CACHE_BUDGET
  ) {}

  private page(index: number): AgentRunExecutionWindowPage | undefined {
    return index === 0 ? this.head ?? undefined : this.pages.get(this.cursors.get(index)!)
  }

  get evidence(): AgentRunExecutionWindowPage['evidence'] {
    const entries = new Map<string, AgentRunExecutionWindowPage['evidence'][number]>()
    for (const index of [...this.visible].sort((a, b) => b - a)) {
      const page = this.page(index)
      for (const item of [...(page?.evidence ?? []), ...(page?.activeEvidence ?? [])]) {
        const key = item.canonical
          ? `${item.executionEpoch}:operation:${item.canonical.operationId}` : item.id
        entries.set(key, item)
      }
    }
    return [...entries.values()].sort((a, b) => a.sequence - b.sequence)
  }

  get hasEarlier(): boolean { return this.page(Math.max(...this.visible))?.hasMore ?? false }
  get hasNewer(): boolean { return this.visible.length > 0 && Math.min(...this.visible) > 0 }

  dispose(): void { this.generation += 1; this.queuedRefresh = null }

  async latest(): Promise<void> { await this.show(0, 'latest') }
  async retry(): Promise<void> { await this[this.direction]() }
  async earlier(): Promise<void> {
    if (this.hasEarlier) await this.show(Math.max(...this.visible) + 1, 'earlier')
  }
  async newer(): Promise<void> {
    if (this.hasNewer) await this.show(Math.min(...this.visible) - 1, 'newer')
  }

  /** Invalidation refreshes the live cache; accept controls only replacing the view. */
  async refresh(accept: () => boolean = () => true): Promise<void> {
    if (this.loading || this.refreshing) { this.queuedRefresh = accept; return }
    if (this.visible.length === 0) return
    const generation = this.generation
    this.refreshing = true
    try {
      const page = await this.fetch(null)
      if (generation !== this.generation) return
      this.remember(page)
      if (accept() && !this.hasNewer && !this.loading) {
        this.adoptHead(page)
        this.visible = [0]
        this.changed()
      }
      this.prune()
    } catch {
      // Keep successful content. A later invalidation retries in the background.
    } finally {
      if (generation === this.generation) {
        this.refreshing = false
        this.afterRead()
      }
    }
  }

  private adoptHead(page: AgentRunExecutionWindowPage): void {
    if (this.head === page) return
    this.head = page
    this.cursors = new Map([[0, null]])
    if (page.nextBeforeSequence !== null) this.cursors.set(1, page.nextBeforeSequence)
  }

  private async show(index: number, direction: Direction): Promise<void> {
    if (this.loading) return
    const generation = this.generation
    this.loading = true
    this.direction = direction
    this.error = null
    this.changed()
    try {
      const cursor = this.cursors.get(index)
      if (cursor === undefined) throw new Error('执行记录分页位置不可用')
      const page = (direction === 'latest' ? this.pages.get(null) : this.page(index)) ?? await this.fetch(cursor)
      if (generation !== this.generation) return
      // A frozen reading head must not replace the newer live cache.
      if (index !== 0 || direction === 'latest') this.remember(page)
      if (direction === 'latest') {
        this.adoptHead(page)
        this.visible = [0]
      } else {
        if (page.nextBeforeSequence !== null) this.cursors.set(index + 1, page.nextBeforeSequence)
        this.visible = [...new Set([...this.visible, index])].sort((a, b) => a - b)
        this.visible = direction === 'earlier' ? this.visible.slice(-2) : this.visible.slice(0, 2)
      }
      this.prune()
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : '读取执行记录失败'
    } finally {
      if (generation === this.generation) {
        this.loading = false
        this.changed()
        this.afterRead()
      }
    }
  }

  private afterRead(): void {
    const refresh = this.queuedRefresh
    this.queuedRefresh = null
    if (refresh) void this.refresh(refresh)
    else void this.prefetch()
  }

  private remember(page: AgentRunExecutionWindowPage): void {
    this.pages.delete(page.requestedBeforeSequence)
    this.pages.set(page.requestedBeforeSequence, page)
    if (!this.sizes.has(page)) this.sizes.set(page, JSON.stringify(page).length * 2)
  }

  private async fetch(beforeSequence: number | null): Promise<AgentRunExecutionWindowPage> {
    const existing = this.pending.get(beforeSequence)
    if (existing) return existing
    const promise = this.request({ campId: this.campId, agentRunId: this.agentRunId, beforeSequence, limit: this.limit })
      .then(page => {
        const sequences = page.evidence.map(item => item.sequence)
        if (page.schemaVersion !== 1 || page.campId !== this.campId || page.agentRunId !== this.agentRunId
          || page.requestedBeforeSequence !== beforeSequence
          || !Number.isSafeInteger(page.throughSequence) || page.throughSequence < 0
          || page.evidence.length > this.limit
          || page.activeEvidence?.some(item => item.agentRunId !== this.agentRunId
            || !Number.isSafeInteger(item.sequence) || item.sequence <= 0 || item.sequence > page.throughSequence)
          || page.evidence.some((item, position) => item.agentRunId !== this.agentRunId
            || !Number.isSafeInteger(item.sequence) || item.sequence <= 0 || item.sequence > page.throughSequence
            || (beforeSequence !== null && item.sequence >= beforeSequence)
            || (position > 0 && item.sequence <= sequences[position - 1]))
          || (page.hasMore && (page.nextBeforeSequence !== sequences[0] || sequences.length === 0))
          || (!page.hasMore && page.nextBeforeSequence !== null)) {
          throw new Error('执行记录分页数据不兼容')
        }
        return page
      })
    this.pending.set(beforeSequence, promise)
    try { return await promise } finally {
      if (this.pending.get(beforeSequence) === promise) this.pending.delete(beforeSequence)
    }
  }

  private async prefetch(): Promise<void> {
    if (!this.hasEarlier || this.error) return
    const index = Math.max(...this.visible) + 1
    const cursor = this.page(index - 1)?.nextBeforeSequence
    if (cursor == null) return
    this.cursors.set(index, cursor)
    if (this.pages.has(cursor)) return
    const generation = this.generation
    try {
      const page = await this.fetch(cursor)
      if (generation !== this.generation) return
      this.remember(page)
      this.prune()
      // Cache only: no render and no recursive prefetch.
    } catch { /* Explicit navigation retries and reports a failure. */ }
  }

  private prune(): void {
    const pinned = new Set([null, ...this.visible.map(index => this.cursors.get(index)),
      this.page(Math.max(...this.visible))?.nextBeforeSequence])
    const frozen = this.head && this.head !== this.pages.get(null) ? this.head : null
    let count = this.pages.size + (frozen ? 1 : 0)
    let bytes = [...this.pages.values(), ...(frozen ? [frozen] : [])]
      .reduce((total, page) => total + (this.sizes.get(page) ?? 0), 0)
    for (const [cursor, page] of this.pages) {
      if (count <= this.budget.maxPages && bytes <= this.budget.maxBytes) break
      // Visible content, the adjacent page and the live head take precedence
      // when one unusually large page alone exceeds the byte budget.
      if (pinned.has(cursor)) continue
      this.pages.delete(cursor)
      count -= 1
      bytes -= this.sizes.get(page) ?? 0
    }
  }
}

export function executionWindowPageSize(viewportHeight: number): number {
  return Math.max(12, Math.min(48, Math.ceil(viewportHeight / 36) + 8))
}
