import { describe, expect, it, vi } from 'vitest'
import { ChannelSettingsCoordinator, hasPublishedChannelBot } from './channel-settings-coordinator'
import type { ChannelSettingsService } from './channel-settings'
import type { DingTalkChannelSettingsService } from './dingtalk-channel-settings'
import type { MemberBotProvisioningView } from '@contracts'

describe('ChannelSettingsCoordinator', () => {
  it('retains each provider publication identity when both have progress', async () => {
    const feishuProgress: MemberBotProvisioningView = { publicationIntentId: 'feishu-original', agentId: 'member', stage: 'creating_app', detail: 'creating', remoteAppId: 'feishu-app', failureCode: null }
    const dingtalkProgress: MemberBotProvisioningView = { ...feishuProgress, publicationIntentId: 'dingtalk-original', remoteAppId: 'dingtalk-app', stage: 'completed' }
    const feishu = { onChanged: () => () => undefined, get: async () => ({ channels: [{ kind: 'feishu' }], activeProvisioning: feishuProgress, activeQrAttempt: null, pendingBindingCount: 0, bindingIssueCount: 0 }) }
    const dingtalk = { onChanged: () => () => undefined, get: async () => ({ provider: { kind: 'dingtalk' }, activeProvisioning: dingtalkProgress, activeQrAttempt: null, pendingBindingCount: 0, bindingIssueCount: 0 }) }
    const coordinator = new ChannelSettingsCoordinator({ feishu: feishu as unknown as ChannelSettingsService, dingtalk: dingtalk as unknown as DingTalkChannelSettingsService })
    const snapshot = await coordinator.get()
    expect(snapshot.channels.map(provider => provider.provisioning)).toEqual([
      { ...feishuProgress, kind: 'feishu' }, { ...dingtalkProgress, kind: 'dingtalk' }
    ])
    coordinator.dispose()
  })

  it('admits one publication per provider before any asynchronous service read and releases after failure', async () => {
    let release!: () => void
    const publish = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); throw new Error('network timeout') })
    const feishu = { onChanged: () => () => undefined, publishMemberBot: publish, retryMemberBot: publish }
    const dingtalk = { onChanged: () => () => undefined }
    const coordinator = new ChannelSettingsCoordinator({ feishu: feishu as unknown as ChannelSettingsService, dingtalk: dingtalk as unknown as DingTalkChannelSettingsService })
    const first = coordinator.publishMemberBot('member', 'feishu')
    const failure = expect(first).rejects.toThrow('network timeout')
    await expect(coordinator.retryMemberBot('member', 'feishu')).rejects.toThrow('channel_publication_busy')
    expect(publish).toHaveBeenCalledOnce()
    release(); await failure
    const retry = coordinator.retryMemberBot('member', 'feishu')
    const retryFailure = expect(retry).rejects.toThrow('network timeout')
    expect(publish).toHaveBeenCalledTimes(2)
    release(); await retryFailure
    coordinator.dispose()
  })

  it('opens the execution gate only for a currently published channel Bot', () => {
    expect(hasPublishedChannelBot({
      channels: [{ memberBots: [{ publicationStatus: 'disabled' }] }]
    })).toBe(false)
    expect(hasPublishedChannelBot({
      channels: [
        { memberBots: [] },
        { memberBots: [{ publicationStatus: 'published' }] }
      ]
    })).toBe(true)
  })

  it('keeps Feishu running when the optional DingTalk Host cannot start', async () => {
    const feishu = host()
    const dingtalk = host(new Error('dingtalk_open_platform_unavailable'))
    const coordinator = new ChannelSettingsCoordinator({
      feishu: feishu.service as ChannelSettingsService,
      dingtalk: dingtalk.service as DingTalkChannelSettingsService
    })

    await expect(coordinator.start()).resolves.toBeUndefined()
    expect(feishu.start).toHaveBeenCalledOnce()
    expect(feishu.stop).not.toHaveBeenCalled()
    coordinator.dispose()
  })

  it('reports startup failure only when neither provider Host is available', async () => {
    const feishu = host(new Error('feishu_unavailable'))
    const dingtalk = host(new Error('dingtalk_unavailable'))
    const coordinator = new ChannelSettingsCoordinator({
      feishu: feishu.service as ChannelSettingsService,
      dingtalk: dingtalk.service as DingTalkChannelSettingsService
    })

    await expect(coordinator.start()).rejects.toThrow('All Channel Hosts failed to start')
    coordinator.dispose()
  })

  it('forwards Core activity to both provider Hosts', () => {
    const feishu = host()
    const dingtalk = host()
    const coordinator = new ChannelSettingsCoordinator({
      feishu: feishu.service as ChannelSettingsService,
      dingtalk: dingtalk.service as DingTalkChannelSettingsService
    })
    const event = { method: 'agent_run.terminal', params: { agentRunId: 'run-1' } }

    coordinator.handleCoreEvent(event)

    expect(feishu.handleCoreEvent).toHaveBeenCalledExactlyOnceWith(event)
    expect(dingtalk.handleCoreEvent).toHaveBeenCalledExactlyOnceWith(event)
    coordinator.dispose()
  })
})

function host(startError?: Error): {
  service: unknown
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  handleCoreEvent: ReturnType<typeof vi.fn>
} {
  const start = vi.fn(async () => {
    if (startError) throw startError
  })
  const stop = vi.fn(async () => undefined)
  const handleCoreEvent = vi.fn()
  return {
    start,
    stop,
    handleCoreEvent,
    service: {
      start,
      stop,
      handleCoreEvent,
      onChanged: vi.fn(() => () => undefined)
    }
  }
}
