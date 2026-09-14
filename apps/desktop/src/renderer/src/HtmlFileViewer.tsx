import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { HtmlPreviewHostChannel } from '../../../../../packages/html-preview/src/host-channel'
import { htmlPreviewDiagnosticKey, parseHtmlPreviewDiagnostic, validPreviewOrigin, type HtmlPreviewDiagnostic } from '../../../../../packages/html-preview/src/protocol'
import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'
import { HtmlPreviewSource } from './HtmlPreviewSource'
import { useHtmlFileFind } from './file-find-html'
import { HtmlPreviewLoadState, type HtmlPreviewLoadSnapshot } from './file-preview-html-load'

const labels = { script: '脚本错误', promise: '异步脚本错误', resource: '资源加载失败', policy: '浏览器策略阻止', document: '页面加载失败', channel: '诊断通道不可用' }

export function HtmlViewer({ tab, pathControl, updateAction }: {
  tab: FilePreviewTabModel
  pathControl: ReactNode
  updateAction: ReactNode
}): React.JSX.Element | null {
  const content = tab.content?.kind === 'html' ? tab.content : null
  const preview = content?.preview
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const channel = useMemo(() => preview ? new HtmlPreviewHostChannel(preview, () => iframeRef.current?.contentWindow ?? null) : null, [preview])
  const sourceMode = Boolean(tab.htmlSourceMode)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  useHtmlFileFind(iframeRef, sourceMode ? null : channel)
  const { open, reload, toggleHtmlSource, resolvedTheme } = useFilePreview()
  const [loadState, setLoadState] = useState<HtmlPreviewLoadSnapshot>({ documentId: null, document: 'loading', channel: 'waiting', failure: null, notice: null })
  const { document: documentState, channel: channelState, failure } = loadState
  const load = useRef<HtmlPreviewLoadState | null>(null)
  const [diagnostics, setDiagnostics] = useState<HtmlPreviewDiagnostic[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const fragment = tab.file?.target?.htmlFragment
  const current = useRef({ file: tab.file, fragment })
  current.current = { file: tab.file, fragment }
  const retry = (): void => { void reload(tab.id) }

  useEffect(() => {
    if (!channel || !preview) return
    const state = new HtmlPreviewLoadState(setLoadState)
    load.current = state; setDiagnostics([]); setNotice(null); setDetailsOpen(false)
    const unsubscribe = channel.subscribe(message => {
      if (message.type === 'connecting') { state.connecting(); return }
      if (message.type === 'connected' && typeof message.documentId === 'string') {
        if (state.connected(message.documentId)) { setDiagnostics([]); setNotice(null); setDetailsOpen(false) }
        return
      }
      if (message.type === 'state' && typeof message.documentId === 'string' && ['loading', 'loaded', 'failed'].includes(String(message.document))) {
        state.state(message.documentId, message.document as 'loading' | 'loaded' | 'failed', typeof message.message === 'string' ? message.message : undefined)
        if (message.document === 'loaded' && current.current.fragment) channel.send('fragment', { fragment: current.current.fragment })
      } else if (message.type === 'diagnostic') {
        const diagnostic = parseHtmlPreviewDiagnostic(message.diagnostic, preview)
        if (diagnostic) setDiagnostics(items => {
          const index = items.findIndex(item => htmlPreviewDiagnosticKey(item) === htmlPreviewDiagnosticKey(diagnostic))
          if (index >= 0) return diagnostic.status != null && items[index].status == null ? items.map((item, offset) => offset === index ? diagnostic : item) : items
          return items.length >= 100 ? items : [...items, diagnostic]
        })
      } else if (message.type === 'channel-unavailable') state.unavailable()
      else if (message.type === 'fragment-result' && typeof message.found === 'boolean') setNotice(message.found ? null : '未找到指定的页内位置。')
      else if (message.type === 'link' && typeof message.href === 'string' && message.href.startsWith('file:') && message.href.length <= 4096 && current.current.file) {
        void open({ kind: 'child_of_handle', parentHandleId: current.current.file.handleId, rawReference: message.href, allowSystemOpen: true })
          .then(outcome => setNotice(outcome.kind === 'error' ? outcome.error.message : null))
      }
    })
    let detach: (() => void) | undefined
    try { detach = channel.attach(window) } catch (error) { state.failed(error instanceof Error ? error.message : '无法建立预览。') }
    return () => { unsubscribe(); detach?.(); state.close(); load.current = null }
  }, [channel, preview, open])

  useEffect(() => { if (fragment) channel?.send('fragment', { fragment }) }, [channel, fragment])
  if (!preview || !tab.file) return null
  const safe = validPreviewOrigin(preview, window.location.origin)
  const currentDiagnostics = loadState.documentId ? diagnostics : []
  const scriptFailed = currentDiagnostics.some(item => item.kind === 'script' || item.kind === 'promise')
  const resourceFailed = currentDiagnostics.some(item => item.kind === 'resource' || item.kind === 'policy')
  const documentFailed = documentState === 'failed' || !safe
  const hasProblem = documentFailed || Boolean(tab.refreshError) || currentDiagnostics.length > 0
    || channelState === 'unavailable' || documentState === 'unresponsive' || documentState === 'unconfirmed'
  const status = tab.isRefreshing ? '重新加载中…' : documentFailed ? '加载失败' : tab.refreshError ? '重新加载失败'
    : documentState === 'unconfirmed' || channelState === 'unavailable' ? '状态未确认'
      : documentState === 'unresponsive' ? '加载未完成' : documentState === 'loading' ? '加载中…' : ''
  const summary = [status, currentDiagnostics.length ? `${currentDiagnostics.length} 项问题` : ''].filter(Boolean).join(' · ')
  const expanded = hasProblem && detailsOpen
  const feedback = summary && (hasProblem ? <button type="button" className="file-preview-html-feedback is-problem"
    aria-expanded={expanded} aria-controls={detailsId} onClick={() => setDetailsOpen(!detailsOpen)}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Z M8 5.5v4 M8 11.5v.5" /></svg>
    {summary}
    <svg className="file-preview-html-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d={expanded ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} /></svg>
  </button> : <span className="file-preview-html-feedback">{summary}</span>)
  return <div className="file-preview-html-stage" data-document-state={documentState} data-script-state={scriptFailed ? 'error' : 'no-error-observed'} data-resource-state={resourceFailed ? 'partial-failure' : 'no-error-observed'} data-channel-state={channelState}>
    <span className="sr-only" role="status">{summary}</span>
    {(pathControl || feedback || updateAction) && <div className={pathControl ? 'file-preview-path-row' : 'file-preview-html-feedback-row'}>
      {pathControl}
      {updateAction}
      {feedback}
      {pathControl && <button type="button" className="file-preview-html-source-toggle" aria-pressed={sourceMode}
        onClick={() => toggleHtmlSource(tab.id)}>{sourceMode ? '交互预览' : '源码'}</button>}
    </div>}
    {hasProblem && <div id={detailsId} className="file-preview-html-diagnostics" hidden={!expanded}>
      {tab.refreshError && <p role="alert">重新加载失败：{tab.refreshError}。已显示的内容会保留。</p>}
      {loadState.notice && <p className="file-preview-html-notice">{loadState.notice}</p>}
      <p>文档：{documentState === 'loaded' ? '已加载' : documentState === 'failed' ? '加载失败' : documentState === 'unresponsive' ? '尚未完成加载' : documentState === 'unconfirmed' ? '无法确认' : '加载中'} · 脚本：{scriptFailed ? '已发现运行错误' : '尚未发现异常'} · 资源：{resourceFailed ? '部分资源失败' : '尚未发现失败'} · 诊断：{channelState === 'connected' ? '已连接' : channelState === 'waiting' ? '尚未响应' : '不可用'}</p>
      {currentDiagnostics.length > 0 && <ol>{currentDiagnostics.map((item, index) => <li key={index}>
        <strong>{labels[item.kind]}</strong>：{item.message}
        {item.resourceUrl && <div>{item.resourceUrl}{item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : '（位置未知）'}</div>}
        {item.stack && <pre>{item.stack}</pre>}
      </li>)}</ol>}
      {currentDiagnostics.length === 100 && <p>已达到 100 项记录上限。</p>}
      <button type="button" onClick={retry} disabled={tab.isRefreshing}>{tab.isRefreshing ? '重试中…' : '重试'}</button>
    </div>}
    {notice && <p className="file-preview-html-notice" role="status">{notice}</p>}
    <div className="file-preview-content">
      {sourceMode && <HtmlPreviewSource key={preview.generation} file={tab.file} theme={resolvedTheme} />}
      {safe && <iframe hidden={sourceMode} ref={iframeRef} className="file-preview-html" title={`${tab.presentation.fileName} HTML 预览`}
        src={preview.entryUrl} sandbox={preview.sandboxedDocument === undefined ? 'allow-scripts allow-same-origin' : 'allow-scripts'} referrerPolicy="no-referrer"
        onLoad={() => { load.current?.frameLoaded(); channel?.connect() }}
        onError={() => load.current?.failed('无法加载预览页面。')} />}
      {!sourceMode && documentFailed && <div className="file-preview-error file-preview-html-failure" role="alert">
        <strong>无法加载 HTML 预览</strong><p>{failure ?? '预览站点未与主应用隔离。'}</p><button type="button" onClick={retry} disabled={tab.isRefreshing}>{tab.isRefreshing ? '重试中…' : '重试'}</button>
      </div>}
    </div>
  </div>
}
