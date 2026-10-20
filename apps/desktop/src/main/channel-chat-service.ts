import { createHash } from 'node:crypto'
import type { ChatBotView, CoreMethod } from '@contracts'

export type ChatCore = { request<T>(method: CoreMethod, params?: unknown): Promise<T> }

export type ChatSendOutcome = 'sent' | 'failed' | 'unknown'

export type ChatSendReceipt = { status: ChatSendOutcome; messageId: string | null }

export type ChatRuntime = {
  provider: 'feishu' | 'lark'
  appId: string
  core: ChatCore
  /** Sends to a chat id (group/p2p) or an open id for direct messages. */
  sendText: (target: string, text: string, targetKind: 'chat' | 'open_id') => Promise<ChatSendReceipt>
  log?: (event: string, detail?: Record<string, unknown>) => void
}

export type ChatInboundInput = {
  chatId: string
  chatName: string | null
  conversationKind: 'p2p' | 'group' | 'topic'
  authorExternalId: string
  authorName: string
  isOwner: boolean
  body: string
  externalMessageId: string
  quoteMessageId: string | null
  mentions: Array<{ openId: string | null; name: string }>
}

export type ChatFlushResult = {
  id: string
  status: ChatSendOutcome
  messageId: string | null
  chatId: string
  source: string
  text: string
}

type TurnResult = { status: string; text: string | null; reason: string | null }

type PendingTurn = {
  chatId: string
  submittedAt: number
  waitingSince: number | null
}

type ClaimedOutbound = {
  id: string
  chatId: string
  text: string
  source: string
  attempts: number
}

const MAX_REPLY_BYTES = 8 * 1024
const OUTBOUND_BATCH = 10
const TURN_TIMEOUT_MS = 30 * 60_000
const WAITING_NOTICE_MS = 10 * 60_000

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 40)
}

function truncateBytes(text: string, max: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.byteLength <= max) return text
  return buffer.subarray(0, max).toString('utf8').replace(/\uFFFD$/, '') + '…'
}

/**
 * Chat turns are ordinary Thread executions owned by Core. This service only
 * carries Feishu transport: it records the inbound message, asks Core to admit
 * one turn in the member's materials folder, waits for the Run to settle, and
 * delivers the assistant text through the existing outbound queue.
 */
export class ChannelChatService {
  readonly #runtime: ChatRuntime
  readonly #workerId: string
  readonly #pending = new Map<string, PendingTurn>()
  #flushing = false
  #stopped = false

  constructor(runtime: ChatRuntime) {
    this.#runtime = runtime
    this.#workerId = 'chat-' + runtime.appId + '-' + digest(String(Date.now()))
  }

  stop(): void {
    this.#stopped = true
    this.#pending.clear()
  }

  async handleInbound(input: ChatInboundInput): Promise<void> {
    if (this.#stopped) return
    const recorded = await this.#runtime.core.request<{
      mode: string
      duplicate: boolean
      owner: boolean
    }>('channels.chat.inbound', {
      commandId: 'chat-inbound-' + digest(this.#runtime.appId + '\0' + input.externalMessageId),
      command: {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        externalMessageId: input.externalMessageId,
        chatId: input.chatId,
        conversationKind: input.conversationKind,
        chatName: input.chatName,
        authorExternalId: input.authorExternalId,
        authorName: input.authorName,
        authorIsOwner: input.isOwner,
        body: input.body,
        quoteMessageId: input.quoteMessageId
      }
    })
    if (recorded.duplicate || recorded.mode !== 'chat') return
    const config = await this.snapshot()
    if (config.ownerOnly) return
    const turn = await this.#runtime.core.request<{ campMessageId: string }>(
      'channels.chat.submit',
      {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        chatId: input.chatId,
        conversationKind: input.conversationKind,
        chatName: input.chatName,
        authorName: input.authorName,
        body: input.body
      }
    )
    this.#pending.set(turn.campMessageId, {
      chatId: input.chatId,
      submittedAt: Date.now(),
      waitingSince: null
    })
  }

  async snapshot(): Promise<ChatBotView> {
    return this.#runtime.core.request<ChatBotView>('channels.chat.snapshot', {
      provider: this.#runtime.provider,
      appId: this.#runtime.appId
    })
  }

  /** Polls admitted turns, then drains the outbound queue. */
  async flush(): Promise<ChatFlushResult[]> {
    if (this.#stopped || this.#flushing) return []
    this.#flushing = true
    try {
      await this.#pollTurns()
      return await this.#flushOutbound()
    } finally {
      this.#flushing = false
    }
  }

  async #pollTurns(): Promise<void> {
    for (const [campMessageId, turn] of [...this.#pending]) {
      let result: TurnResult
      try {
        result = await this.#runtime.core.request<TurnResult>('channels.chat.result', {
          provider: this.#runtime.provider,
          appId: this.#runtime.appId,
          campMessageId
        })
      } catch (error) {
        this.#log('turn.result_failed', { code: errorName(error) })
        continue
      }
      const now = Date.now()
      if (result.status === 'completed') {
        this.#pending.delete(campMessageId)
        const text = result.text?.trim()
        if (text) {
          await this.#enqueue(campMessageId, turn.chatId, truncateBytes(text, MAX_REPLY_BYTES), 'reply')
        } else {
          this.#log('turn.empty_result', { reason: result.reason ?? 'unknown' })
          await this.#enqueue(campMessageId, turn.chatId, '这条消息没有生成可发送的回复。', 'notice')
        }
        continue
      }
      if (result.status === 'waiting') {
        if (turn.waitingSince === null) {
          turn.waitingSince = now
          continue
        }
        if (now - turn.waitingSince < WAITING_NOTICE_MS) continue
        this.#pending.delete(campMessageId)
        await this.#enqueue(
          campMessageId,
          turn.chatId,
          '这条消息需要在应用里确认后才能继续。',
          'notice'
        )
        continue
      }
      if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'unknown') {
        this.#pending.delete(campMessageId)
        this.#log('turn.failed', { status: result.status, reason: result.reason ?? null })
        await this.#enqueue(campMessageId, turn.chatId, '暂时无法回复，请稍后再试。', 'notice')
        continue
      }
      if (now - turn.submittedAt > TURN_TIMEOUT_MS) {
        this.#pending.delete(campMessageId)
        this.#log('turn.timeout', { status: result.status })
        await this.#enqueue(campMessageId, turn.chatId, '这条消息处理时间过长，请稍后再试。', 'notice')
      }
    }
  }

  async #flushOutbound(): Promise<ChatFlushResult[]> {
    const claimed = await this.#runtime.core.request<ClaimedOutbound[]>(
      'channels.chat.outbound.claim',
      {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        workerId: this.#workerId,
        limit: OUTBOUND_BATCH
      }
    )
    const results: ChatFlushResult[] = []
    for (const outbound of claimed) {
      let receipt: ChatSendReceipt = { status: 'unknown', messageId: null }
      let failureCode: string | null = null
      try {
        receipt = await this.#runtime.sendText(
          outbound.chatId,
          outbound.text,
          outbound.chatId.startsWith('ou_') ? 'open_id' : 'chat'
        )
      } catch (error) {
        receipt = { status: 'unknown', messageId: null }
        failureCode = errorName(error)
      }
      await this.#runtime.core.request('channels.chat.outbound.settle', {
        commandId: 'chat-settle-' + outbound.id,
        command: {
          outboundId: outbound.id,
          status: receipt.status,
          externalMessageId: receipt.messageId,
          failureCode
        }
      })
      if (outbound.source === 'reply' && receipt.status === 'sent') {
        await this.#rememberAssistant(outbound.chatId, outbound.text).catch(() => undefined)
      }
      results.push({
        id: outbound.id,
        status: receipt.status,
        messageId: receipt.messageId,
        chatId: outbound.chatId,
        source: outbound.source,
        text: outbound.text
      })
    }
    return results
  }

  async #enqueue(campMessageId: string, chatId: string, text: string, source: string): Promise<void> {
    const key = digest([this.#runtime.provider, this.#runtime.appId, campMessageId, source, text].join('\0'))
    try {
      await this.#runtime.core.request('channels.chat.outbound.enqueue', {
        commandId: 'chat-outbound-' + key,
        command: {
          provider: this.#runtime.provider,
          appId: this.#runtime.appId,
          chatId,
          text,
          source,
          idempotencyKey: key,
          usesMaterials: false
        }
      })
    } catch (error) {
      this.#log('outbound.enqueue_failed', { code: errorName(error) })
    }
  }

  async #rememberAssistant(chatId: string, text: string): Promise<void> {
    await this.#runtime.core.request('channels.chat.turn.append', {
      commandId: 'chat-turn-' + digest(chatId + '|' + text),
      command: {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        chatId,
        role: 'assistant',
        body: text,
        materialsOnly: false
      }
    })
  }

  #log(event: string, detail?: Record<string, unknown>): void {
    this.#runtime.log?.(event, detail)
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}
