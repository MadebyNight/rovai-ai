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
