import { describe, expect, it } from 'vitest'
import type { ChatBotView, CoreMethod } from '@contracts'
import {
  ChannelChatService,
  type ChatCore,
  type ChatInboundInput,
  type ChatSendReceipt
} from './channel-chat-service'

type TurnState = 'pending' | 'running' | 'completed' | 'failed' | 'waiting'

type State = {
  config: ChatBotView
  duplicate: boolean
  turn: { status: TurnState; text: string | null }
  submitted: string[]
  outbound: Array<{ id: string; chatId: string; text: string; source: string; attempts: number }>
  settled: Array<{ id: string; status: string }>
  appended: string[]
  sent: Array<{ target: string; text: string }>
}

function fakeCore(state: State): ChatCore {
  let outboundSeq = 0
  return ({
    request: async (method: CoreMethod, params?: unknown): Promise<unknown> => {
      const payload = (params ?? {}) as Record<string, any>
      switch (method) {
        case 'channels.chat.inbound':
          return { mode: state.config.mode, duplicate: state.duplicate, owner: false }
        case 'channels.chat.snapshot':
          return state.config
        case 'channels.chat.submit': {
          const id = 'msg-' + (state.submitted.length + 1)
          state.submitted.push(id)
          return { campId: 'camp-1', campMessageId: id, duplicate: false }
        }
        case 'channels.chat.result':
          return { status: state.turn.status, text: state.turn.text, reason: null }
        case 'channels.chat.outbound.enqueue': {
          const id = 'out-' + (outboundSeq += 1)
          state.outbound.push({
            id,
            chatId: payload.command.chatId,
            text: payload.command.text,
            source: payload.command.source,
            attempts: 0
          })
          return { outboundId: id, duplicate: false }
        }
        case 'channels.chat.outbound.claim': {
          const claimable = state.outbound.filter(
            (candidate) => !state.settled.some((settled) => settled.id === candidate.id)
          )
          for (const candidate of claimable) candidate.attempts += 1
          return claimable
        }
        case 'channels.chat.outbound.settle': {
          state.settled.push({ id: payload.command.outboundId, status: payload.command.status })
          return { settled: true }
        }
        case 'channels.chat.turn.append':
          state.appended.push(payload.command.body)
          return { appended: true }
        default:
          throw new Error('unexpected core method ' + method)
      }
    }
  }) as ChatCore
}

function chatConfig(overrides: Partial<ChatBotView> = {}): ChatBotView {
  return {
    agentId: 'agent-1',
    ownerOnly: false,
    mode: 'chat',
    materialsPath: 'C:/materials',
    ...overrides
  }
}

function baseState(overrides: Partial<State> = {}): State {
  return {
    config: chatConfig(),
    duplicate: false,
    turn: { status: 'completed', text: '好的，已记下。' },
    submitted: [],
    outbound: [],
    settled: [],
    appended: [],
    sent: [],
    ...overrides
  }
}

function inbound(overrides: Partial<ChatInboundInput> = {}): ChatInboundInput {
  return {
    chatId: 'oc_test',
    chatName: '项目群',
    conversationKind: 'group',
    authorExternalId: 'ou_colleague',
    authorName: '同事',
    isOwner: false,
    body: '帮我记一条备忘',
    externalMessageId: 'om_1',
    quoteMessageId: null,
    mentions: [],
    ...overrides
  }
}

function harness(state: State): ChannelChatService {
  return new ChannelChatService({
    provider: 'feishu',
    appId: 'cli_test',
    core: fakeCore(state),
    sendText: async (target, text): Promise<ChatSendReceipt> => {
      state.sent.push({ target, text })
      return { status: 'sent', messageId: 'om_sent' }
    }
  })
}

describe('ChannelChatService', () => {
  it('submits one turn and delivers the assistant text from Core', async () => {
    const state = baseState()
    const service = harness(state)

    await service.handleInbound(inbound())
    expect(state.submitted).toHaveLength(1)
    expect(state.sent).toHaveLength(0)

    const results = await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '好的，已记下。' }])
    expect(results[0]?.status).toBe('sent')
    expect(state.appended).toEqual(['好的，已记下。'])
  })

  it('ignores duplicates and work-mode Bots', async () => {
    const duplicate = baseState({ duplicate: true })
    await harness(duplicate).handleInbound(inbound())
    expect(duplicate.submitted).toHaveLength(0)

    const work = baseState({ config: chatConfig({ ownerOnly: true, mode: 'work' }) })
    await harness(work).handleInbound(inbound())
    expect(work.submitted).toHaveLength(0)
  })

  it('keeps polling while the Run is live and replies once it settles', async () => {
    const state = baseState({ turn: { status: 'pending', text: null } })
    const service = harness(state)

    await service.handleInbound(inbound())
    await service.flush()
    expect(state.sent).toHaveLength(0)

    state.turn = { status: 'completed', text: '已经写好了。' }
    await service.flush()
    await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '已经写好了。' }])
  })

  it('explains a failed Run instead of staying silent', async () => {
    const state = baseState({ turn: { status: 'failed', text: null } })
    const service = harness(state)
    await service.handleInbound(inbound())
    await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '暂时无法回复，请稍后再试。' }])
  })

  it('reports an empty assistant message instead of sending nothing', async () => {
    const state = baseState({ turn: { status: 'completed', text: '   ' } })
    const service = harness(state)
    await service.handleInbound(inbound())
    await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '这条消息没有生成可发送的回复。' }])
  })
})
