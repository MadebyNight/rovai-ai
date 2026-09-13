import { acquireTabRecovery } from './tab-recovery'
import { takeLoginTicket } from './login-ticket'
import { StrictMode, useEffect, useState } from 'react'
import { RemoteConnectionStatus } from '../../desktop/src/renderer/src/RemoteConnectionStatus'
import { HostWorkspacePicker } from './HostWorkspacePicker'
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
const recovery = (async () => {
  // Synchronous fragment removal happens before the first await. StrictMode
  // remounts subscribe to this one promise, never redeem the ticket twice.
  let ticket: string | null = null
  let ticketError: unknown
  try { ticket = takeLoginTicket() } catch (error) { ticketError = error }
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
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => transport.onPendingCommandsChanged(() => setPendingCount(transport.pendingCommandCount)), [])
  const selectWorkspace = async (): Promise<WorkspaceSelection | null> => {
    return new Promise(resolve => setWorkspaceChoice({ resolve }))
  }
  const finishWorkspace = (value: WorkspaceSelection | null): void => { workspaceChoice?.resolve(value); setWorkspaceChoice(null) }
  const [adapter, setAdapter] = useState<ReturnType<typeof createCampAdapter> | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [authGeneration, setAuthGeneration] = useState(0)
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
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
      .finally(() => { if (!cancelled) { setRestoring(false); setPendingCount(transport.pendingCommandCount) } })
    return () => { cancelled = true }
  }, [])
  useEffect(() => transport.onRecovered(() => adapter?.invalidate()), [adapter])
  useEffect(() => {
    let active = true
    const scanned = (): void => {
      let ticket: string | null
      try { ticket = takeLoginTicket() } catch (e) { setError(e instanceof Error ? e.message : '扫码登录失败。'); return }
      if (ticket === null) return
      setBusy(true); setError(null)
      // Same-document scans reuse this tab's verified editor. Copied tabs were
      // already separated by startup recovery before this handler can sign in.
      void recovery.catch(() => false).then(() => transport.loginTicket(ticket!)).then(() => {
        if (!active) return
        setAdapter(current => current ?? createCampAdapter(transport, selectWorkspace)); setAuthenticated(true)
      }).catch(e => { if (active) setError(e instanceof Error ? e.message : '扫码登录失败。') })
        .finally(() => { ticket = null; if (active) setBusy(false) })
    }
    window.addEventListener('hashchange', scanned)
    return () => { active = false; window.removeEventListener('hashchange', scanned) }
  }, [])
  const login = async (): Promise<void> => {
    setBusy(true); setError(null)
    const token = credential; setCredential('')
    try {
      await transport.login(token)
      setAdapter(current => current ?? createCampAdapter(transport, selectWorkspace))
      setAuthenticated(true)
    } catch (e) { setError(e instanceof Error ? e.message : '登录失败，请重试。') }
    finally { setBusy(false) }
  }
  const current = adapter
  return <>
    {current && <CampClientProvider client={current.environment.client}>
      <CurrentUserProfileProvider api={current.profile}>
        <BusinessApp environment={current.environment} remoteConnection={<RemoteConnectionStatus origin={transport.origin} state={authenticated ? connection : 'expired'} onLogout={() => void transport.logout().catch(() => undefined)} />} sidebarFooter={authenticated && (connection === 'offline' || pendingCount > 0) ? <div className="web-connection" role="status">
          {connection === 'offline' && <span>连接中断，编辑保留</span>}
          {pendingCount > 0 && <>
            <button type="button" className="quiet-button compact" onClick={() => void transport.reconcilePending()}>核对 {pendingCount} 项提交</button>
            <button type="button" className="quiet-button compact" title="使用原命令编号和内容重试；Host 已保存的结果会直接返回。" onClick={() => void transport.retryPending().catch(e => setError(e instanceof Error ? e.message : '重试未完成。'))}>重试原提交</button>
          </>}
        </div> : undefined} />
      </CurrentUserProfileProvider>
    </CampClientProvider>}
    {authenticated && error && <div className="web-recovery-error" role="alert">{error}<button type="button" className="quiet-button compact" onClick={() => setError(null)}>关闭</button></div>}
    {workspaceChoice && <HostWorkspacePicker transport={transport} onSelect={finishWorkspace} />}
    {!authenticated && <div className="web-login-overlay">
      {restoring ? <p role="status">正在恢复…</p> : <form className="web-login" onSubmit={event => { event.preventDefault(); void login() }}>
        <h1>{current ? '重新登录 Rovai AI' : '登录 Rovai AI'}</h1>
        <p>{current ? '当前页面的编辑仍保留。认证后重新读取 Host 状态。' : '使用 Host 的登录 Token 登录。'}</p>
        <label htmlFor="administrator-token">登录 Token</label>
        <input id="administrator-token" type="password" placeholder="输入 64 位的 Token" value={credential} autoComplete="off" autoFocus
          onChange={event => setCredential(event.target.value)} required disabled={busy} />
        {error && <p role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy || !credential.trim()}>{busy ? '正在登录…' : '登录'}</button>
      </form>}
    </div>}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><WebEntry /></StrictMode>)
