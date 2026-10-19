import type { ChatBotView } from '@contracts'

export type ChatModelMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatModelErrorCode =
  | 'not_configured'
  | 'timeout'
  | 'unauthorized'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'

export class ChatModelError extends Error {
  constructor(readonly code: ChatModelErrorCode, message: string) {
    super(message)
    this.name = 'ChatModelError'
  }
}

export type ChatModelRequest = {
  config: ChatBotView
  apiKey: string
  messages: ChatModelMessage[]
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_TIMEOUT_MS = 60_000

/** One OpenAI-compatible Chat Completions adapter; no provider SDK. */
export async function completeChat(request: ChatModelRequest): Promise<string> {
  const baseUrl = (request.config.modelBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  if (!request.config.modelName || !request.apiKey) {
    throw new ChatModelError('not_configured', 'chat model is not configured')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let response: Response
  try {
    response = await (request.fetchImpl ?? fetch)(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey}`
      },
      body: JSON.stringify({
        model: request.config.modelName,
        messages: request.messages,
        temperature: 0.2
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ChatModelError('timeout', 'chat model timed out')
    }
    throw new ChatModelError('unavailable', 'chat model is unreachable')
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const status = response.status
    if (status === 401 || status === 403) {
      throw new ChatModelError('unauthorized', 'chat model rejected the credential')
    }
    if (status === 429) {
      throw new ChatModelError('rate_limited', 'chat model is rate limited')
    }
    throw new ChatModelError(
      status >= 500 ? 'unavailable' : 'invalid_response',
      `chat model responded with ${status}`
    )
  }
  const payload = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: unknown } }> }
    | null
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new ChatModelError('invalid_response', 'chat model returned no text')
  }
  return content.trim()
}

export type ChatTarget = { openId: string; name: string }

export type ChatAction =
  | { type: 'search_materials'; query: string }
  | { type: 'find_person'; name: string }
  | { type: 'forward'; targetOpenId: string; targetName: string; text: string }
  | { type: 'ask'; targetOpenId: string; targetName: string; question: string }
  | { type: 'ask_owner'; question: string }
  | { type: 'close_item'; itemId: string }

export type ChatModelOutput = { reply: string | null; action: ChatAction | null }

export type ChatItemReplyOutput = {
  newRequest: boolean
  refused: boolean
  report: string | null
}

const ACTION_TYPES = new Set([
  'search_materials',
  'find_person',
  'forward',
  'ask',
  'ask_owner',
  'close_item'
])

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Parse the closed action set; anything malformed degrades to plain text. */
export function parseChatModelOutput(text: string): ChatModelOutput {
  const parsed = extractJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { reply: text.trim() || null, action: null }
  }
  const record = parsed as Record<string, unknown>
  const reply = stringValue(record.reply)
  const rawAction = record.action
  if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) {
    return { reply, action: null }
  }
  const action = rawAction as Record<string, unknown>
  const type = stringValue(action.type)
  if (!type || !ACTION_TYPES.has(type)) return { reply, action: null }
  switch (type) {
    case 'search_materials': {
      const query = stringValue(action.query)
      return query ? { reply, action: { type, query } } : { reply, action: null }
    }
    case 'find_person': {
      const name = stringValue(action.name)
      return name ? { reply, action: { type, name } } : { reply, action: null }
    }
    case 'forward': {
      const targetOpenId = stringValue(action.targetOpenId)
      const targetName = stringValue(action.targetName)
      const body = stringValue(action.text)
      return targetOpenId && targetName && body
        ? { reply, action: { type, targetOpenId, targetName, text: body } }
        : { reply, action: null }
    }
    case 'ask': {
      const targetOpenId = stringValue(action.targetOpenId)
      const targetName = stringValue(action.targetName)
      const question = stringValue(action.question)
      return targetOpenId && targetName && question
        ? { reply, action: { type, targetOpenId, targetName, question } }
        : { reply, action: null }
    }
    case 'ask_owner': {
      const question = stringValue(action.question)
      return question ? { reply, action: { type, question } } : { reply, action: null }
    }
    case 'close_item': {
      const itemId = stringValue(action.itemId)
      return itemId ? { reply, action: { type, itemId } } : { reply, action: null }
    }
    default:
      return { reply, action: null }
  }
}

export function parseItemReplyOutput(text: string): ChatItemReplyOutput {
  const parsed = extractJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { newRequest: false, refused: false, report: text.trim() || null }
  }
  const record = parsed as Record<string, unknown>
  return {
    newRequest: record.newRequest === true,
    refused: record.refused === true,
    report: stringValue(record.report)
  }
}
