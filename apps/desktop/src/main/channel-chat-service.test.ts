import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ChatBotView, ChatItemView, ChatTurnView } from '@contracts'
import {
  ChannelChatService,
  type ChatInboundInput,
  type ChatSendReceipt
} from './channel-chat-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.allSettled(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

type State = {
  config: ChatBotView
  duplicate: boolean
  turns: ChatTurnView[]
  items: ChatItemView[]
  outbound: Array<{ id: string; chatId: string; text: string; source: string; attempts: number }>
  settled: Array<{ id: string; status: string }>
  createdItems: Array<Record<string, unknown>>
  sent: Array<{ target: string; text: string }>
}

function fakeCore(state: State) {
  let outboundSeq = 0
  return {
    request: async (method: string, params?: unknown): Promise<unknown> => {
      const payload = (params ?? {}) as Record<string, any>
      switch (method) {
        case 'channels.chat.inbound':
          state.turns.push({ role: 'user', body: payload.command.body })
          return { mode: 'chat', duplicate: state.duplicate, owner: false }
        case 'channels.chat.snapshot':
          return state.config
        case 'channels.chat.context':
          return state.turns
        case 'channels.chat.items.waiting':
          return state.items.filter((item) => item.status === 'waiting')
        case 'channels.chat.items.active':
          return state.items
        case 'channels.chat.item.create': {
          state.createdItems.push(payload.command)
          const item: ChatItemView = {
            id: 'item-' + state.createdItems.length,
            provider: 'feishu',
            appId: 'cli_test',
            requesterExternalId: payload.command.requesterExternalId,
            requesterName: payload.command.requesterName,
            destinationChatId: payload.command.destinationChatId,
            destinationKind: payload.command.destinationKind,
            targetExternalId: payload.command.targetExternalId,
            targetName: payload.command.targetName,
            targetIsOwner: payload.command.targetIsOwner,
            question: payload.command.question,
            askMessageId: payload.command.askMessageId ?? null,
            askChatId: payload.command.askChatId ?? null,
            status: 'waiting',
            lastReportAt: null,
            createdAt: Date.now()
          }
          state.items.push(item)
          return item
        }
        case 'channels.chat.item.update': {
          const item = state.items.find((candidate) => candidate.id === payload.command.itemId)
          if (item && payload.command.markReported) item.lastReportAt = Date.now()
          if (item && payload.command.status) item.status = payload.command.status
          if (item && payload.command.askMessageId) item.askMessageId = payload.command.askMessageId
          return item
        }
        case 'channels.chat.ownerTarget':
          return { appId: 'cli_test', externalId: 'ou_owner' }
        case 'channels.chat.outbound.enqueue': {
          outboundSeq += 1
          const id = 'out-' + outboundSeq
          const existing = state.outbound.find((item) => item.id === payload.command.idempotencyKey)
          if (existing) return { outboundId: existing.id, duplicate: true }
          state.outbound.push({
            id: payload.command.idempotencyKey,
            chatId: payload.command.chatId,
            text: payload.command.text,
            source: payload.command.source,
            attempts: 0
          })
          void id
          return { outboundId: payload.command.idempotencyKey, duplicate: false }
        }
        case 'channels.chat.outbound.claim': {
          const claimed = state.outbound.splice(0)
          return claimed
        }
        case 'channels.chat.outbound.settle':
          state.settled.push({ id: payload.command.outboundId, status: payload.command.status })
          return { settled: true }
        default:
          throw new Error('unexpected core method ' + method)
      }
    }
  }
}

function fixture(overrides: Partial<State> = {}) {
  const state: State = {
    config: {
      ownerOnly: false,
      mode: 'chat',
      modelProvider: 'openai-compatible',
      modelName: 'test-model',
      modelBaseUrl: null,
      credentialConfigured: true,
      materialsPath: null,
      materialsStatus: null
    },
    duplicate: false,
    turns: [],
    items: [],
    outbound: [],
    settled: [],
    createdItems: [],
    sent: [],
    ...overrides
  }
  const outputs = ['{"reply":"你好","action":null}']
  const service = new ChannelChatService({
    provider: 'feishu',
    appId: 'cli_test',
    core: fakeCore(state) as never,
    sendText: async (target, text): Promise<ChatSendReceipt> => {
      state.sent.push({ target, text })
      return { status: 'sent', messageId: 'om_' + state.sent.length }
    },
    loadModelKey: async () => 'secret',
    appCredentials: () => ({ appId: 'cli_test', appSecret: 'secret' }),
    complete: async () => outputs.shift() ?? '{"reply":null,"action":null}'
  })
  return { state, service, outputs }
}

const input = (overrides: Partial<ChatInboundInput> = {}): ChatInboundInput => ({
  chatId: 'oc_chat',
  chatName: '项目群',
  conversationKind: 'group',
  authorExternalId: 'ou_requester',
  authorName: '张三',
  isOwner: false,
  body: '你好',
  externalMessageId: 'om_in_1',
  quoteMessageId: null,
  mentions: [],
  ...overrides
})

describe('channel chat service', () => {
  it('replies to the original conversation and never touches work delivery', async () => {
    const { state, service } = fixture()
    await service.handleInbound(input())
    expect(state.sent).toEqual([{ target: 'oc_chat', text: '你好' }])
    expect(state.settled).toHaveLength(1)
    expect(state.settled[0].status).toBe('sent')
  })

  it('skips duplicate platform events without sending again', async () => {
    const { state, service } = fixture({ duplicate: true })
    await service.handleInbound(input())
    expect(state.sent).toEqual([])
  })

  it('asks the owner and remembers the item so the answer returns to the requester', async () => {
    const { state, service, outputs } = fixture()
    outputs.splice(0, outputs.length,
      '{"reply":"我向负责人确认一下","action":{"type":"ask_owner","question":"最新进展？"}}')
    await service.handleInbound(input({ body: '现在最新情况是什么？' }))

    const ownerSend = state.sent.find((entry) => entry.target === 'ou_owner')
    expect(ownerSend?.text).toContain('张三')
    expect(ownerSend?.text).toContain('最新进展？')
    expect(state.sent.some((entry) => entry.target === 'oc_chat' && entry.text.includes('我向负责人确认一下'))).toBe(true)
    expect(state.createdItems).toHaveLength(1)
    expect(state.createdItems[0]).toMatchObject({
      targetIsOwner: true,
      destinationChatId: 'oc_chat'
    })
    expect(String(state.items[0].askMessageId)).toMatch(/^om_\d+$/)
  })

  it('grounds material answers in freshly read snippets and cites the source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rovai-chat-materials-'))
    directories.push(directory)
    await writeFile(
      path.join(directory, '项目进展记录.md'),
      '10 月 16 日完成评审，下一步进入联调。',
      'utf8'
    )
    const { state, service, outputs } = fixture({
      config: {
        ownerOnly: false,
        mode: 'chat',
        modelProvider: 'openai-compatible',
        modelName: 'test-model',
        modelBaseUrl: null,
        credentialConfigured: true,
        materialsPath: directory,
        materialsStatus: '共 1 个文件可用'
      }
    })
    let captured: Array<{ role: string; content: string }> = []
    void service
    outputs.splice(0, outputs.length,
      '{"reply":"根据《项目进展记录》中 10 月 16 日的记录，下一步进入联调。","action":null}')

    // Re-create with a capturing model call while keeping the same fakes.
    const capturing = new ChannelChatService({
      provider: 'feishu',
      appId: 'cli_test',
      core: fakeCore(state) as never,
      sendText: async (target, text) => {
        state.sent.push({ target, text })
        return { status: 'sent', messageId: 'om_' + state.sent.length }
      },
      loadModelKey: async () => 'secret',
      appCredentials: () => ({ appId: 'cli_test', appSecret: 'secret' }),
      complete: async (request) => {
        captured = request.messages
        return outputs.shift() ?? '{"reply":null,"action":null}'
      }
    })
    await capturing.handleInbound(input({ body: '项目进展到哪一步了？' }))
    const system = captured[0]?.content ?? ''
    expect(system).toContain('《项目进展记录》')
    expect(system).toContain('10月16日')
    expect(state.sent.at(-1)?.text).toContain('根据《项目进展记录》')
  })

  it('turns a correlated reply into a staged report for the requester', async () => {
    const readyItem: ChatItemView = {
      id: 'item-ready',
      provider: 'feishu',
      appId: 'cli_test',
      requesterExternalId: 'ou_requester',
      requesterName: '张三',
      destinationChatId: 'oc_chat',
      destinationKind: 'group',
      targetExternalId: 'ou_target',
      targetName: '李四',
      targetIsOwner: false,
      question: '项目 A 什么时候完成？',
      askMessageId: 'om_ask',
      askChatId: 'ou_target',
      status: 'waiting',
      lastReportAt: null,
      createdAt: 1
    }
    const { state, service, outputs } = fixture({ items: [readyItem] })
    outputs.splice(0, outputs.length, '{"newRequest":false,"report":"下周三完成。"}')
    await service.handleInbound(input({
      authorExternalId: 'ou_target',
      authorName: '李四',
      body: '下周三完成。',
      quoteMessageId: 'om_ask',
      externalMessageId: 'om_reply_1'
    }))
    expect(state.sent[0]).toEqual({
      target: 'oc_chat',
      text: '关于「项目 A 什么时候完成？」的回复：\n下周三完成。'
    })
    expect(state.items[0].lastReportAt).not.toBeNull()
  })

  it('forwards an explicit message and reports the send result', async () => {
    const { state, service, outputs } = fixture()
    outputs.splice(0, outputs.length,
      '{"reply":null,"action":{"type":"forward","targetOpenId":"ou_target","targetName":"李四","text":"明天请假"}}')
    await service.handleInbound(input({
      body: '帮我转告李四明天请假',
      mentions: [{ openId: 'ou_target', name: '李四' }]
    }))
    expect(state.sent[0]).toEqual({
      target: 'ou_target',
      text: '受 张三 委托转告：\n明天请假'
    })
    expect(state.sent[1]).toEqual({ target: 'oc_chat', text: '已转告 李四。' })
  })

  it('asks which item is meant when several are waiting unless the message is a new request', async () => {
    const waiting = (id: string, question: string): ChatItemView => ({
      id,
      provider: 'feishu',
      appId: 'cli_test',
      requesterExternalId: 'ou_requester',
      requesterName: '张三',
      destinationChatId: 'oc_chat',
      destinationKind: 'group',
      targetExternalId: 'ou_target',
      targetName: '李四',
      targetIsOwner: false,
      question,
      askMessageId: 'om_' + id,
      askChatId: 'ou_target',
      status: 'waiting',
      lastReportAt: null,
      createdAt: 1
    })
    const { state, service, outputs } = fixture({
      items: [waiting('a', '问题 A'), waiting('b', '问题 B')]
    })
    outputs.splice(0, outputs.length, '{"newRequest":false}')
    await service.handleInbound(input({ authorExternalId: 'ou_target', authorName: '李四', body: '不清楚' }))
    expect(state.sent[0].text).toContain('多条待回复的事项')

    const next = fixture({ items: [waiting('a', '问题 A'), waiting('b', '问题 B')] })
    next.outputs.splice(0, next.outputs.length, '{"newRequest":true}', '{"reply":"好的","action":null}')
    await next.service.handleInbound(input({
      authorExternalId: 'ou_target',
      authorName: '李四',
      body: '帮我查一下项目 A'
    }))
    expect(next.state.sent.at(-1)).toEqual({ target: 'oc_chat', text: '好的' })
  })

})
