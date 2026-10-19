import { describe, expect, it, vi } from 'vitest'
import {
  ChatModelError,
  completeChat,
  parseChatModelOutput,
  parseItemReplyOutput
} from './chat-model-client'
import type { ChatBotView } from '@contracts'

const config: ChatBotView = {
  ownerOnly: false,
  mode: 'chat',
  modelProvider: 'openai-compatible',
  modelName: 'test-model',
  modelBaseUrl: 'https://model.invalid/v1',
  credentialConfigured: true,
  materialsPath: null,
  materialsStatus: null
}

describe('chat model client', () => {
  it('parses the closed action set and degrades malformed output to text', () => {
    expect(parseChatModelOutput(JSON.stringify({ reply: '你好', action: null })))
      .toEqual({ reply: '你好', action: null })
    const fenced = '```json\n' + '{"action":{"type":"ask_owner","question":"进展？"}}' + '\n```'
    expect(parseChatModelOutput(fenced))
      .toEqual({ reply: null, action: { type: 'ask_owner', question: '进展？' } })
    expect(parseChatModelOutput(JSON.stringify({
      action: { type: 'forward', targetOpenId: 'ou_1', targetName: '李四', text: '请查收' }
    }))).toEqual({
      reply: null,
      action: { type: 'forward', targetOpenId: 'ou_1', targetName: '李四', text: '请查收' }
    })
    expect(parseChatModelOutput(JSON.stringify({
      action: { type: 'forward', targetOpenId: 'ou_1', targetName: '李四' }
    }))).toEqual({ reply: null, action: null })
    expect(parseChatModelOutput('普通文字回复')).toEqual({ reply: '普通文字回复', action: null })
  })

  it('parses item reply output and treats non-JSON as a report', () => {
    expect(parseItemReplyOutput('{"newRequest":true,"refused":false,"report":null}'))
      .toEqual({ newRequest: true, refused: false, report: null })
    expect(parseItemReplyOutput('{"newRequest":false,"report":"下周三完成"}'))
      .toEqual({ newRequest: false, refused: false, report: '下周三完成' })
    expect(parseItemReplyOutput('{"refused":true}'))
      .toEqual({ newRequest: false, refused: true, report: null })
    expect(parseItemReplyOutput('我查一下'))
      .toEqual({ newRequest: false, refused: false, report: '我查一下' })
  })

  it('calls one OpenAI-compatible endpoint and returns message text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: ' reply ' } }]
    }), { status: 200 }))
    await expect(completeChat({
      config,
      apiKey: 'secret',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).resolves.toBe('reply')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://model.invalid/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
  })

  it('maps provider failures to closed error codes', async () => {
    const unauthorized = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(completeChat({
      config,
      apiKey: 'secret',
      messages: [],
      fetchImpl: unauthorized as unknown as typeof fetch
    })).rejects.toMatchObject({ code: 'unauthorized' })

    const unavailable = vi.fn(async () => new Response('{}', { status: 503 }))
    await expect(completeChat({
      config,
      apiKey: 'secret',
      messages: [],
      fetchImpl: unavailable as unknown as typeof fetch
    })).rejects.toBeInstanceOf(ChatModelError)
  })

  it('never calls the network without a configured model', async () => {
    const fetchImpl = vi.fn()
    await expect(completeChat({
      config: { ...config, modelName: null },
      apiKey: 'secret',
      messages: [],
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).rejects.toMatchObject({ code: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
