import { acquireTabRecovery } from './tab-recovery'
import { takeLoginTicket } from './login-ticket'
import { StrictMode, useEffect, useState } from 'react'
import { RemoteConnectionStatus } from '../../desktop/src/renderer/src/RemoteConnectionStatus'
import { HostWorkspacePicker } from './HostWorkspacePicker'
import { WebLogin } from './WebLogin'
import '../../desktop/src/renderer/src/remote-connection.css'
import type { WorkspaceSelection } from '@contracts'
import { createRoot } from 'react-dom/client'
import { BusinessApp } from '../../desktop/src/renderer/src/BusinessApp'
import { CampClientProvider } from '../../desktop/src/renderer/src/camp-client'
import { CurrentUserProfileProvider } from '../../desktop/src/renderer/src/CurrentUserProfile'
import { ConsoleClient, type ConnectionState } from './client'
import { createCampAdapter, browserPlatform } from './camp-adapter'
import '../../desktop/src/renderer/src/styles.css'
import '../../desktop/src/renderer/src/member-editor.css'
import './styles.css'

const transport = new ConsoleClient(window.location.origin, fetch, sessionStorage)
document.documentElement.dataset.platform = browserPlatform()
document.documentElement.dataset.rovaiSurface = 'web'
const loginTheme = matchMedia('(prefers-color-scheme: dark)')
function applyLoginTheme(): void {
  document.documentElement.dataset.theme = loginTheme.matches ? 'night' : 'day'
  document.documentElement.style.colorScheme = loginTheme.matches ? 'dark' : 'light'
}
applyLoginTheme()
let startupScanning = false
const recovery = (async () => {
  // Synchronous fragment removal happens before the first await. StrictMode
  // remounts subscribe to this one promise, never redeem the ticket twice.
  let ticket: string | null = null
  let ticketError: unknown
  try { ticket = takeLoginTicket(); startupScanning = ticket !== null } catch (error) { ticketError = error }
  const owner = await acquireTabRecovery()
  const restored = await transport.restore(owner.fork, owner.assert, ticket === null && !ticketError)
  if (ticketError) throw ticketError
  if (ticket !== null) {
    try { await transport.loginTicket(ticket) } finally { ticket = null }
    return true
  }
  return restored
})()

function WebEntry() {
  const [workspaceChoice, setWorkspaceChoice] = useState<{ resolve(value: WorkspaceSelection | null): void } | null>(null)
  const selectWorkspace = async (): Promise<WorkspaceSelection | null> => {
    return new Promise(resolve => setWorkspaceChoice({ resolve }))
  }
  const finishWorkspace = (value: WorkspaceSelection | null): void => { workspaceChoice?.resolve(value); setWorkspaceChoice(null) }
  const [adapter, setAdapter] = useState<ReturnType<typeof createCampAdapter> | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [authGeneration, setAuthGeneration] = useState(0)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(startupScanning)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  useEffect(() => {
    // Once mounted, BusinessApp owns the scoped appearance, including re-login.
    if (adapter) return
    loginTheme.addEventListener('change', applyLoginTheme)
    return () => loginTheme.removeEventListener('change', applyLoginTheme)
  }, [adapter])
  useEffect(() => transport.onAuthenticationChanged(() => {
    setAuthenticated(transport.authenticated)
    setAuthGeneration(value => value + 1)
  }), [])
  useEffect(() => {
    if (!authenticated) return
    return transport.subscribe(() => adapter?.invalidate(), setConnection)
  }, [authenticated, authGeneration, adapter])
  useEffect(() => {
    let cancelled = false
    void recovery.then(restored => {
      if (cancelled) return
      if (restored && transport.authenticated) {
        setAdapter(current => current ?? createCampAdapter(transport, selectWorkspace))
        setAuthenticated(true)
      }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '恢复失败，请重试。') })
      .finally(() => { if (!cancelled) { setRestoring(false); setScanning(false) } })
    return () => { cancelled = true }
  }, [])
  useEffect(() => transport.onRecovered(() => adapter?.invalidate()), [adapter])
  useEffect(() => {
    let active = true
    const scanned = (): void => {
      let ticket: string | null
      try { ticket = takeLoginTicket() } catch (e) { setError(e instanceof Error ? e.message : '扫码登录失败。'); return }
      if (ticket === null) return
      setBusy(true); setScanning(true); setError(null)
      // Same-document scans reuse this tab's verified editor. Copied tabs were
      // already separated by startup recovery before this handler can sign in.
      void recovery.catch(() => false).then(() => transport.loginTicket(ticket!)).then(() => {
        if (!active) return
        setAdapter(current => current ?? createCampAdapter(transport, selectWorkspace)); setAuthenticated(true)
      }).catch(e => { if (active) setError(e instanceof Error ? e.message : '扫码登录失败。') })
        .finally(() => { ticket = null; if (active) { setBusy(false); setScanning(false) } })
    }
    window.addEventListener('hashchange', scanned)
    return () => { active = false; window.removeEventListener('hashchange', scanned) }
  }, [])
  const login = async (token: string): Promise<void> => {
    if (busy || restoring) return
    setBusy(true); setError(null)
    try {
      await transport.login(token)
      setAdapter(current => current ?? createCampAdapter(transport, selectWorkspace))
      setAuthenticated(true)
    } catch (e) { setError(e instanceof TypeError ? '暂时无法连接，请检查网络后重试。' : e instanceof Error ? e.message : '登录失败，请重试。') }
    finally { setBusy(false) }
  }
  const current = adapter
  return <>
    {current && <CampClientProvider client={current.environment.client}>
      <CurrentUserProfileProvider api={current.profile}>
        <BusinessApp environment={current.environment} remoteConnection={<RemoteConnectionStatus origin={transport.origin} state={authenticated ? connection : 'expired'} onLogout={() => void transport.logout().catch(() => undefined)} />} sidebarFooter={authenticated && connection === 'offline' ? <div className="web-connection" role="status">
          <span>连接中断，编辑保留</span>
        </div> : undefined} />
      </CurrentUserProfileProvider>
    </CampClientProvider>}
    {authenticated && error && <div className="web-recovery-error" role="alert">{error}<button type="button" className="quiet-button compact" onClick={() => setError(null)}>关闭</button></div>}
    {workspaceChoice && <HostWorkspacePicker transport={transport} onSelect={finishWorkspace} />}
    {!authenticated && <WebLogin reauthenticating={current !== null}
      status={scanning ? 'scanning' : restoring ? 'restoring' : busy ? 'submitting' : null}
      error={error} onLogin={token => { void login(token) }} />}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><WebEntry /></StrictMode>)
