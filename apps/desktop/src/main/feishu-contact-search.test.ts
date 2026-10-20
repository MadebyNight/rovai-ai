import { describe, expect, it, vi } from 'vitest'
import { ContactSearchError, searchContacts } from './feishu-contact-search'

function stubFetch(routes: {
  search?: () => Response
  directory?: () => Response
}) {
  return vi.fn(async (url: string | URL) => {
    const value = String(url)
    if (value.includes('tenant_access_token')) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token' }), { status: 200 })
    }
    if (value.includes('/search/v1/user')) {
      return routes.search ? routes.search() : new Response(JSON.stringify({ code: 99991663 }), { status: 400 })
    }
    if (value.includes('find_by_department')) {
      return routes.directory
        ? routes.directory()
        : new Response(JSON.stringify({ code: 40004, msg: 'no dept authority' }), { status: 403 })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

const request = (fetchImpl: typeof fetch, query = '李四') => ({
  appId: 'cli_test',
  appSecret: 'secret',
  query,
  fetchImpl
})

describe('Feishu contact search', () => {
  it('does not report an incomplete bounded directory scan as an empty result', async () => {
    let page = 0
    const fetchImpl = stubFetch({ directory: () => new Response(JSON.stringify({
      code: 0, data: { items: [], has_more: true, page_token: String(++page) }
    }), { status: 200 }) })
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({ code: 'unavailable' })
    expect(page).toBe(12)
  })
  it('uses the Lark domain explicitly and bounds results to 20 without credentials', async () => {
    const fetchImpl = stubFetch({ search: () => new Response(JSON.stringify({ code: 0, data: {
      users: Array.from({ length: 30 }, (_, i) => ({ open_id: 'ou_' + i, name: '李四', access_token: 'private' }))
    } })) })
    const result = await searchContacts({ ...request(fetchImpl), domain: 'lark' })
    expect(result).toHaveLength(20)
    expect(JSON.stringify(result)).not.toMatch(/private|secret|token/)
    for (const [url] of vi.mocked(fetchImpl).mock.calls) expect(new URL(String(url)).origin).toBe('https://open.larksuite.com')
  })

  it('rejects malformed payloads instead of pretending nobody matched', async () => {
    const fetchImpl = stubFetch({ search: () => new Response(JSON.stringify({ code: 0, data: { users: {} } })) })
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('does not scan the directory after server failures', async () => {
    const fetchImpl = stubFetch({ search: () => new Response(JSON.stringify({ code: 999, msg: 'private token' }), { status: 500 }) })
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({ code: 'unavailable' })
    expect(vi.mocked(fetchImpl).mock.calls).toHaveLength(2)
  })

  it('honors cancellation before accessing credentials remotely', async () => {
    const fetchImpl = stubFetch({})
    const controller = new AbortController()
    controller.abort()
    await expect(searchContacts({ ...request(fetchImpl), signal: controller.signal })).rejects.toMatchObject({ code: 'unavailable' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not include remote error messages in errors', async () => {
    const fetchImpl = stubFetch({ directory: () => new Response(JSON.stringify({ code: 40004, msg: 'Bearer private secret' }), { status: 403 }) })
    await expect(searchContacts(request(fetchImpl))).rejects.toThrow('contact search failed')
  })

  it('returns name-search results when the token type supports them', async () => {
    const fetchImpl = stubFetch({
      search: () => new Response(JSON.stringify({
        code: 0,
        data: { users: [{ open_id: 'ou_1', name: '李四', department_names: ['研发'] }] }
      }), { status: 200 })
    })
    await expect(searchContacts(request(fetchImpl))).resolves.toEqual([
      { openId: 'ou_1', name: '李四', department: '研发' }
    ])
  })

  it('falls back to the live department directory when search needs a user token', async () => {
    const fetchImpl = stubFetch({
      directory: () => new Response(JSON.stringify({
        code: 0,
        data: {
          items: [
            { open_id: 'ou_1', name: '李四' },
            { open_id: 'ou_2', name: '王五' }
          ],
          has_more: false
        }
      }), { status: 200 })
    })
    await expect(searchContacts(request(fetchImpl))).resolves.toEqual([
      { openId: 'ou_1', name: '李四' }
    ])
  })

  it('reports permission denial instead of pretending nobody matched', async () => {
    const fetchImpl = stubFetch({})
    await expect(searchContacts(request(fetchImpl))).rejects.toMatchObject({
      code: 'permission_denied'
    })
    await expect(searchContacts(request(fetchImpl))).rejects.toBeInstanceOf(ContactSearchError)
  })
})
