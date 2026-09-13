import type {
  ChannelKind,
  ChannelLoginViewBounds,
  ChannelSettingsSnapshot,
  CoreEvent
} from '@contracts'
import type { ChannelSettingsService } from './channel-settings'
import type { DingTalkChannelSettingsService } from './dingtalk-channel-settings'

export function hasPublishedChannelBot(snapshot: {
  channels: ReadonlyArray<{ memberBots: ReadonlyArray<{ publicationStatus: string }> }>
}): boolean {
  return snapshot.channels.some((channel) => (
    channel.memberBots.some((bot) => bot.publicationStatus === 'published')
  ))
}

export class ChannelSettingsCoordinator {
  readonly #feishu: ChannelSettingsService
  readonly #dingtalk: DingTalkChannelSettingsService
  readonly #publications = new Set<ChannelKind>()
  readonly #listeners = new Set<(snapshot: ChannelSettingsSnapshot) => void>()
  readonly #unsubscribeChildren: Array<() => void>

  constructor(input: {
    feishu: ChannelSettingsService
    dingtalk: DingTalkChannelSettingsService
  }) {
    this.#feishu = input.feishu
    this.#dingtalk = input.dingtalk
    this.#unsubscribeChildren = [
      this.#feishu.onChanged(() => { void this.#emit() }),
      this.#dingtalk.onChanged(() => { void this.#emit() })
    ]
  }

  async start(): Promise<void> {
    const [feishu, dingtalk] = await Promise.allSettled([
      this.#feishu.start(),
      this.#dingtalk.start()
    ])
    if (feishu.status === 'rejected') {
      console.warn('[rovai] Feishu Channel Host startup failed.', feishu.reason)
    }
    if (dingtalk.status === 'rejected') {
      console.warn('[rovai] DingTalk Channel Host startup failed.', dingtalk.reason)
    }
    if (feishu.status === 'rejected' && dingtalk.status === 'rejected') {
      throw new AggregateError(
        [feishu.reason, dingtalk.reason],
        'All Channel Hosts failed to start'
      )
    }
  }

  async stop(): Promise<void> {
    await Promise.allSettled([this.#feishu.stop(), this.#dingtalk.stop()])
  }

  handleCoreEvent(event: CoreEvent): void {
    this.#feishu.handleCoreEvent(event)
    this.#dingtalk.handleCoreEvent(event)
  }

  async get(): Promise<ChannelSettingsSnapshot> {
    const [feishu, dingtalk] = await Promise.all([
      this.#feishu.get(),
      this.#dingtalk.get()
    ])
    return {
      schemaVersion: 4,
      channels: [
        ...feishu.channels.map(provider => ({ ...provider, provisioning: feishu.activeProvisioning
          ? { ...feishu.activeProvisioning, kind: 'feishu' as const } : null })),
        { ...dingtalk.provider, provisioning: dingtalk.activeProvisioning
          ? { ...dingtalk.activeProvisioning, kind: 'dingtalk' as const } : null }
      ],
      pendingBindingCount: feishu.pendingBindingCount + dingtalk.pendingBindingCount,
      bindingIssueCount: feishu.bindingIssueCount + dingtalk.bindingIssueCount,
      activeQrAttempt: dingtalk.activeQrAttempt
        ? { ...dingtalk.activeQrAttempt, kind: 'dingtalk' }
        : feishu.activeQrAttempt
          ? { ...feishu.activeQrAttempt, kind: 'feishu' }
          : null,
      activeProvisioning: dingtalk.activeProvisioning
        ? { ...dingtalk.activeProvisioning, kind: 'dingtalk' }
        : feishu.activeProvisioning
          ? { ...feishu.activeProvisioning, kind: 'feishu' }
          : null
    }
  }

  onChanged(listener: (snapshot: ChannelSettingsSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async connect(kind: ChannelKind = 'feishu'): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.connect()
    else await this.#feishu.connect()
    return this.get()
  }

  async disconnect(kind: ChannelKind = 'feishu'): Promise<ChannelSettingsSnapshot> {
    if (kind === 'dingtalk') await this.#dingtalk.disconnect()
    else await this.#feishu.disconnect()
    return this.get()
  }

  async publishMemberBot(
    agentId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    return this.#publication(kind, async () => {
      if (kind === 'dingtalk') await this.#dingtalk.publish(agentId)
      else await this.#feishu.publishMemberBot(agentId)
    })
  }

  async retryMemberBot(
    agentId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    return this.#publication(kind, async () => {
      if (kind === 'dingtalk') await this.#dingtalk.publish(agentId)
      else await this.#feishu.retryMemberBot(agentId)
    })
  }

  async selectPublicationApprover(
    agentId: string,
    userId: string,
    kind: ChannelKind = 'feishu'
  ): Promise<ChannelSettingsSnapshot> {
    if (kind !== 'dingtalk') throw new Error('feishu_publication_approver_not_supported')
    return this.#publication(kind, () => this.#dingtalk.selectApprover(agentId, userId))
  }

  async #publication(kind: ChannelKind, action: () => Promise<unknown>): Promise<ChannelSettingsSnapshot> {
    // Desktop IPC and hosted Web use the same coordinator. Admit before the
    // first asynchronous Core read so simultaneous callers cannot both create.
    if (this.#publications.has(kind)) throw new Error('channel_publication_busy')
    this.#publications.add(kind)
    try { await action(); return await this.get() }
    finally { this.#publications.delete(kind) }
  }

  async cancelQrAttempt(attemptId: string): Promise<ChannelSettingsSnapshot> {
    const dingtalk = await this.#dingtalk.get()
    if (dingtalk.activeQrAttempt?.attemptId === attemptId) {
      await this.#dingtalk.cancelLogin(attemptId)
    } else {
      await this.#feishu.cancelQrAttempt(attemptId)
    }
    return this.get()
  }

  setLoginViewBounds(attemptId: string, bounds: ChannelLoginViewBounds | null): void {
    this.#dingtalk.setLoginViewBounds(attemptId, bounds)
  }

  async refreshLoginQr(attemptId: string): Promise<void> {
    if (!await this.#feishu.refreshLoginQr(attemptId)) await this.#dingtalk.refreshLoginQr(attemptId)
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribeChildren) unsubscribe()
    this.#listeners.clear()
  }

  async #emit(): Promise<ChannelSettingsSnapshot> {
    const snapshot = await this.get()
    for (const listener of this.#listeners) listener(structuredClone(snapshot))
    return snapshot
  }
}
