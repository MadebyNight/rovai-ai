export type ChatContact = { openId: string; name: string; department?: string }

export type ContactSearchErrorCode = 'permission_denied' | 'unavailable' | 'invalid_response'

export class ContactSearchError extends Error {
  constructor(readonly code: ContactSearchErrorCode, message = 'contact search failed') {
    super(message)
    this.name = 'ContactSearchError'
  }
}

export type ContactSearchRequest = {
  appId: string
  appSecret: string
  domain?: 'feishu' | 'lark'
  query: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

const PERMISSION_CODES = new Set([99991672, 99991663, 41050, 40004])
const SEARCH_TIMEOUT_MS = 15_000

function contact(value: unknown): ChatContact | null {
  if (!value || typeof value !== 'object') return null
  const user = value as Record<string, unknown>
  if (typeof user.open_id !== 'string' || !user.open_id.startsWith('ou_')
    || user.open_id.length > 128 || typeof user.name !== 'string' || !user.name.trim()) return null
  const department = typeof user.department === 'string' ? user.department
    : Array.isArray(user.department_names) ? user.department_names.filter((name) => typeof name === 'string').join(' / ')
      : undefined
  return { openId: user.open_id, name: user.name.slice(0, 200), ...(department ? { department: department.slice(0, 300) } : {}) }
}

/** Bounded live queries use only the Bot's granted scope; no directory is cached. */
export async function searchContacts(request: ContactSearchRequest): Promise<ChatContact[]> {
  const query = request.query.trim()
  if (!query) return []
  if (query.length > 200) throw new ContactSearchError('invalid_response')
  const fetchImpl = request.fetchImpl ?? fetch
  const root = request.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  const read = async (url: string, init: RequestInit = {}) => {
    let response: Response
    try {
      signal.throwIfAborted()
      response = await fetchImpl(url, { ...init, signal })
    } catch {
      throw new ContactSearchError('unavailable')
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ContactSearchError('invalid_response')
    }
    return { response, payload: payload as Record<string, any> }
  }
  const tokenResult = await read(root + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: request.appId, app_secret: request.appSecret })
  })
  if (!tokenResult.response.ok || tokenResult.payload.code !== 0) {
    throw new ContactSearchError(PERMISSION_CODES.has(tokenResult.payload.code) ? 'permission_denied' : 'unavailable')
  }
  const token = tokenResult.payload.tenant_access_token
  if (typeof token !== 'string' || !token) throw new ContactSearchError('invalid_response')
  const headers = { authorization: 'Bearer ' + token }
  const search = await read(root + '/open-apis/search/v1/user?query=' + encodeURIComponent(query) + '&page_size=20', { headers })
  if (search.response.ok && search.payload.code === 0) {
    const users = search.payload.data?.users
    if (!Array.isArray(users)) throw new ContactSearchError('invalid_response')
    return users.map(contact).filter((user): user is ChatContact => user !== null).slice(0, 20)
  }
  // Name search may require a user token; only that refusal permits a bounded
  // live scan of the app's already-granted contact scope, never a tenant export.
  if (!PERMISSION_CODES.has(search.payload.code)) throw new ContactSearchError('unavailable')
  const matches: ChatContact[] = []
  const seenIds = new Set<string>()
  let pageToken: string | undefined
  let seen = 0
  for (let page = 0; page < 12 && seen < 600 && matches.length < 20; page += 1) {
    const url = root + '/open-apis/contact/v3/users/find_by_department?department_id=0&page_size=50&user_id_type=open_id'
      + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '')
    const { response, payload } = await read(url, { headers })
    if (!response.ok || payload.code !== 0) {
      throw new ContactSearchError(PERMISSION_CODES.has(payload.code) ? 'permission_denied' : 'unavailable')
    }
    if (!Array.isArray(payload.data?.items)) throw new ContactSearchError('invalid_response')
    const items = payload.data.items.slice(0, Math.min(50, 600 - seen))
    seen += items.length
    for (const raw of items) {
      const user = contact(raw)
      if (user && user.name.includes(query) && !seenIds.has(user.openId)) {
        matches.push(user)
        seenIds.add(user.openId)
        if (matches.length === 20) break
      }
    }
    if (!payload.data.has_more || matches.length >= 20) break
    if (page === 11 || seen >= 600) throw new ContactSearchError('unavailable')
    if (typeof payload.data.page_token !== 'string' || !payload.data.page_token
      || payload.data.page_token === pageToken) throw new ContactSearchError('invalid_response')
    pageToken = payload.data.page_token
  }
  return matches
}
