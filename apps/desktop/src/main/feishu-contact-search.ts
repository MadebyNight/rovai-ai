export type ChatContact = { openId: string; name: string; department?: string }

export type ContactSearchErrorCode = 'permission_denied' | 'unavailable' | 'invalid_response'

export class ContactSearchError extends Error {
  constructor(readonly code: ContactSearchErrorCode, message: string) {
    super(message)
    this.name = 'ContactSearchError'
  }
}

export type ContactSearchRequest = {
  appId: string
  appSecret: string
  domain?: 'feishu' | 'lark'
  query: string
  fetchImpl?: typeof fetch
}

const PERMISSION_CODES = new Set([99991672, 99991663, 41050, 40004])

function baseUrl(domain: 'feishu' | 'lark' | undefined): string {
  return domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
}

/** Contact search runs per request; no directory copy is persisted or cached. */
export async function searchContacts(request: ContactSearchRequest): Promise<ChatContact[]> {
  const query = request.query.trim()
  if (!query) return []
  const fetchImpl = request.fetchImpl ?? fetch
  const root = baseUrl(request.domain)
  let tokenResponse: Response
  try {
    tokenResponse = await fetchImpl(root + '/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: request.appId, app_secret: request.appSecret })
    })
  } catch {
    throw new ContactSearchError('unavailable', 'contact search is unreachable')
  }
  const tokenPayload = (await tokenResponse.json().catch(() => null)) as
    | { code?: number; tenant_access_token?: string }
    | null
  if (!tokenResponse.ok || !tokenPayload?.tenant_access_token) {
    throw new ContactSearchError(
      tokenPayload?.code && PERMISSION_CODES.has(tokenPayload.code)
        ? 'permission_denied'
        : 'unavailable',
      'contact search token failed'
    )
  }
  let searchResponse: Response
  try {
    searchResponse = await fetchImpl(
      root + '/open-apis/search/v1/user?query=' + encodeURIComponent(query) + '&page_size=20',
      { headers: { authorization: 'Bearer ' + tokenPayload.tenant_access_token } }
    )
  } catch {
    throw new ContactSearchError('unavailable', 'contact search is unreachable')
  }
  const payload = (await searchResponse.json().catch(() => null)) as
    | {
        code?: number
        msg?: string
        data?: {
          users?: Array<{
            open_id?: string
            name?: string
            department?: string
            department_names?: string[]
          }>
        }
      }
    | null
  if (!searchResponse.ok || (payload?.code !== undefined && payload.code !== 0)) {
    // The name-search endpoint expects a user token. With an app identity the
    // only live alternative is the contact directory inside the granted scope.
    return listDepartmentContacts(
      fetchImpl,
      root,
      tokenPayload.tenant_access_token,
      query
    )
  }
  const users = payload?.data?.users ?? []
  const contacts: ChatContact[] = []
  for (const user of users) {
    if (typeof user.open_id !== 'string' || typeof user.name !== 'string') continue
    const department = user.department
      ?? (user.department_names?.length ? user.department_names.join(' / ') : undefined)
    contacts.push({
      openId: user.open_id,
      name: user.name,
      ...(department ? { department } : {})
    })
  }
  return contacts
}

type DirectoryUser = {
  open_id?: string
  name?: string
  department?: string
  department_names?: string[]
}

function mapDirectoryUser(user: DirectoryUser): ChatContact | null {
  if (typeof user.open_id !== 'string' || typeof user.name !== 'string') return null
  const department = user.department
    ?? (user.department_names?.length ? user.department_names.join(' / ') : undefined)
  return {
    openId: user.open_id,
    name: user.name,
    ...(department ? { department } : {})
  }
}

async function listDepartmentContacts(
  fetchImpl: typeof fetch,
  root: string,
  token: string,
  query: string
): Promise<ChatContact[]> {
  const matches: ChatContact[] = []
  let pageToken: string | undefined
  let seen = 0
  for (let page = 0; page < 12 && seen < 600 && matches.length < 20; page += 1) {
    const url = root + '/open-apis/contact/v3/users/find_by_department?department_id=0&page_size=50&user_id_type=open_id'
      + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '')
    let response: Response
    try {
      response = await fetchImpl(url, { headers: { authorization: 'Bearer ' + token } })
    } catch {
      throw new ContactSearchError('unavailable', 'contact directory is unreachable')
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          code?: number
          msg?: string
          data?: { items?: DirectoryUser[]; has_more?: boolean; page_token?: string }
        }
      | null
    if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) {
      throw new ContactSearchError(
        payload?.code && PERMISSION_CODES.has(payload.code) ? 'permission_denied' : 'unavailable',
        'contact directory failed: ' + (payload?.msg ?? response.status)
      )
    }
    const items = payload?.data?.items ?? []
    seen += items.length
    for (const raw of items) {
      const user = mapDirectoryUser(raw)
      if (user && user.name.includes(query)) matches.push(user)
    }
    if (!payload?.data?.has_more || !payload.data.page_token) break
    pageToken = payload.data.page_token
  }
  return matches
}
