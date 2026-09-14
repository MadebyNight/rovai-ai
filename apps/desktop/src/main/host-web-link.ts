import type { HostWebStatus } from '@contracts'

/** The HTTP exception is limited to address-only links advertised by this Host. */
export async function openHostWebLink(
  value: string,
  status: () => Promise<HostWebStatus>,
  open: (url: string) => Promise<void>
): Promise<void> {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return
  const current = await status()
  if (current.enabled && current.addresses?.some(address => address.origin === url.origin)) await open(url.href)
}
