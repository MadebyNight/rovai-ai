import { expect, it, vi } from 'vitest'
import type { HostWebStatus } from '@contracts'
import { openHostWebLink } from './host-web-link'

it('opens only current Host address links without carrying credentials or routes', async () => {
  const status = vi.fn(async () => ({ enabled: true, addresses: [{ origin: 'http://127.0.0.1:8766' }, { origin: 'http://192.168.1.5:8766' }] }) as HostWebStatus)
  const open = vi.fn(async (_url: string) => undefined)
  await openHostWebLink('http://127.0.0.1:8766', status, open)
  await openHostWebLink('http://192.168.1.5:8766/', status, open)
  expect(open.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:8766/', 'http://192.168.1.5:8766/'])
  open.mockClear()
  for (const url of ['http://example.com', 'http://127.0.0.1:8767', 'http://secret@127.0.0.1:8766', 'http://127.0.0.1:8766/?token=secret', 'http://127.0.0.1:8766/#login-ticket=secret', 'http://127.0.0.1:8766/api', 'file:///tmp/test']) await openHostWebLink(url, status, open)
  status.mockResolvedValue({ enabled: false, addresses: [] } as unknown as HostWebStatus)
  await openHostWebLink('http://127.0.0.1:8766', status, open)
  expect(open).not.toHaveBeenCalled()
})
