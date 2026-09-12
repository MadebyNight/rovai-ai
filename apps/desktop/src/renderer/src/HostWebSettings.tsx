import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { HostWebApi, HostWebStatus } from '@contracts'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from './AppDialog'
import { SettingsPageHeader } from './SettingsPageHeader'
import { QRCodeSVG } from 'qrcode.react'
import { CopyIcon } from './CopyIcon'
import { readErrorMessage } from './error-message'
import './remote-connection.css'

export function HostWebSettings({ api, portDraft, onPortDraftChange }: {
  api: HostWebApi
  portDraft: string | null
  onPortDraftChange: Dispatch<SetStateAction<string | null>>
}): React.JSX.Element {
  const [status, setStatus] = useState<HostWebStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const port = portDraft ?? '4317'
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [confirm, setConfirm] = useState(false)
  const generation = useRef(0)
  const changing = useRef(false)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const enabled = status?.enabled === true

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      if (changing.current) return
      const current = ++generation.current
      void (async () => {
        try {
          const next = await api.status()
          if (!active || current !== generation.current) return
          setStatus(next)
          onPortDraftChange(current => current ?? next.listen?.split(':').at(-1) ?? '4317')
          const credential = next.enabled ? (await api.token()).administratorToken : ''
          if (!active || current !== generation.current) return
          setToken(credential)
          setError('')
        } catch (failure) {
          if (active && current === generation.current) { setError(readErrorMessage(failure)); setToken('') }
        }
      })()
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; generation.current++; window.removeEventListener('focus', refresh) }
  }, [api, reload, onPortDraftChange])

  async function change(operation: 'start' | 'stop' | 'rotate'): Promise<void> {
    if (changing.current) return
    if (operation === 'start' && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
      setError('请输入 1–65535 之间的端口。'); document.getElementById('remote-port')?.focus(); return
    }
    changing.current = true
    const current = ++generation.current
    setBusy(true); setError(''); setFeedback(''); setVisible(false)
    try {
      const next = operation === 'start'
        ? await api.start({ listen: `0.0.0.0:${port}`, allowInsecureLan: true })
        : await api[operation]()
      if (current !== generation.current) return
      setStatus(next)
      setToken('administratorToken' in next ? next.administratorToken as string : '')
      if (operation !== 'rotate') setAddress('')
      setConfirm(false)
      setFeedback(operation === 'rotate' ? '令牌已重新生成，原浏览器会话已退出。' : '')
    } catch (failure) {
      if (current !== generation.current) return
      setError(readErrorMessage(failure))
      // Resolve an uncertain response by reading, never repeat the mutation.
      try {
        const next = await api.status()
        const credential = next.enabled ? (await api.token()).administratorToken : ''
        if (current === generation.current) { setStatus(next); setToken(credential) }
      } catch { if (current === generation.current) { setStatus(null); setToken('') } }
    } finally { changing.current = false; if (current === generation.current) setBusy(false) }
  }
  async function copy(value: string, label: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(value); setFeedback(`${label}已复制。`); return true }
    catch { setFeedback(label === '连接地址' ? `无法自动复制，请手动复制：${value}` : `无法自动复制，请选择${label}后手动复制。`); return false }
  }
  const addresses = status?.addresses ?? []
  const localAddresses = addresses.filter(item => isLocalAddress(item.origin))
  const remoteAddresses = addresses.filter(item => !isLocalAddress(item.origin))
  const selected = remoteAddresses.some(item => item.origin === address) ? address : remoteAddresses[0]?.origin ?? ''
  const local = localAddresses[0]?.origin ?? ''
  return <div className="general-settings remote-connection-page">
    <SettingsPageHeader eyebrow="Settings / Remote connection" title="远程连接" description="通过浏览器连接这台电脑。" />
    <div className="general-settings-body">
      <section className="general-settings-section remote-access-fields" aria-label="远程访问设置">
        <div className="remote-setting-row">
          <div className="remote-copy"><label htmlFor="remote-enabled">远程访问</label></div>
          {(busy || status === null) && <span className="remote-state" role="status">{busy ? '正在更新…' : error ? '读取失败' : '正在读取…'}</span>}
          <input id="remote-enabled" type="checkbox" role="switch" aria-label="远程访问" checked={enabled} disabled={busy || status === null} onChange={() => void change(enabled ? 'stop' : 'start')} />
        </div>
        <div className="remote-setting-row">
          <div className="remote-copy"><label htmlFor="remote-port">端口</label><p id="remote-port-note">修改后，下次开启时生效。</p></div>
          <input id="remote-port" className="remote-port" inputMode="numeric" aria-describedby="remote-port-note" value={port} disabled={busy} onChange={event => onPortDraftChange(event.target.value)} />
        </div>
        <p className="remote-footnote">HTTP 明文连接，请仅在可信网络开启。</p>
        {enabled && <>
          <div className="remote-addresses">
            <RemoteAddress label="本机地址" description="在这台电脑上访问" value={local} onCopy={() => copy(local, '连接地址')} />
            <RemoteAddress label="远程地址" description="在其他设备上访问" value={selected} onCopy={() => copy(selected, '连接地址')}>
              {remoteAddresses.length > 1 && <select id="remote-address" aria-label="选择远程地址" className="remote-address-select" value={selected} onChange={event => { setAddress(event.target.value); setFeedback('') }}>{remoteAddresses.map(item => <option key={item.origin} value={item.origin}>{item.origin} · {item.interface}</option>)}</select>}
            </RemoteAddress>
          </div>
          <div className="remote-field">
            <label htmlFor="remote-token">管理令牌</label>
            <div className="remote-token"><input id="remote-token" type={visible ? 'text' : 'password'} value={token} readOnly autoComplete="off" spellCheck={false} /><button type="button" className="quiet-button compact" disabled={!token} onClick={() => setVisible(value => !value)} aria-pressed={visible}>{visible ? '隐藏' : '显示'}</button><button type="button" className="quiet-button compact" disabled={!token} onClick={() => void copy(token, '管理令牌')}>复制令牌</button><button type="button" className="quiet-button compact" disabled={busy} onClick={() => setConfirm(true)}>重新生成</button></div>
          </div>
        </>}
      </section>
      {error && <div><p className="remote-error" role="alert">{error}</p><button type="button" className="quiet-button compact" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</button></div>}
      {feedback && <p className="remote-feedback" role="status">{feedback}</p>}
    </div>
    <Dialog.Root open={confirm} onOpenChange={open => { if (!open && !busy) setConfirm(false) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent onOpenAutoFocus={event => { event.preventDefault(); cancelButton.current?.focus() }} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
      <AppDialogHeader title="重新生成管理令牌？" description="所有浏览器会话将退出，Host 上的对话与执行仍会继续。" />
      <AppDialogBody><p>旧令牌会立即失效，可用新令牌重新登录并保留编辑。</p></AppDialogBody>
      <AppDialogFooter><button ref={cancelButton} type="button" className="quiet-button" disabled={busy} onClick={() => setConfirm(false)}>取消</button><button type="button" className="primary-button" disabled={busy} onClick={() => void change('rotate')}>{busy ? '正在更新…' : '确认'}</button></AppDialogFooter>
    </AppDialogContent></Dialog.Portal></Dialog.Root>
  </div>
}

function isLocalAddress(origin: string): boolean {
  const host = new URL(origin).hostname
  return host === 'localhost' || host === '[::1]' || host.startsWith('127.') || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]+\]$/.test(host)
}

function RemoteAddress({ label, description, value, onCopy, children }: {
  label: string
  description: string
  value: string
  onCopy(): Promise<boolean>
  children?: React.ReactNode
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [value])
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer) } }, [copied])
  return <div className="remote-connection-address" data-address={value} aria-label={label}>
    <div className="remote-copy"><strong>{label}</strong><p>{description}</p></div>
    <div className="remote-address-value">{children || <code>{value || '暂无可用地址'}</code>}</div>
    <div className="remote-address-actions">
      <button type="button" className="message-copy-button" aria-label={`复制${label}`} title={copied ? '已复制' : `复制${label}`} disabled={!value} onClick={() => { void onCopy().then(success => setCopied(success)) }}><CopyIcon copied={copied} /></button>
      <Dialog.Root><Dialog.Trigger asChild><button type="button" className="message-copy-button" aria-label={`${label}二维码`} title="二维码" disabled={!value}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h3v3h3v3h-6v-3M20 14h.01M7 7h.01M17 7h.01M7 17h.01" /></svg></button></Dialog.Trigger>
        {value && <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent onCloseAutoFocus={() => {}}>
          <AppDialogHeader title={label} description={description} />
          <AppDialogBody className="remote-qr"><QRCodeSVG value={value} size={208} marginSize={4} level="M" role="img" title={`${label}二维码`} /><code>{value}</code></AppDialogBody>
        </AppDialogContent></Dialog.Portal>}
      </Dialog.Root>
    </div>
  </div>
}
