import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AgentProfile, CheckoutState, MissionActivity, MissionChangedFile, MissionDelivery as Delivery, MissionFileDiff, MissionRecord, MissionWorkspaceChangesView } from '@contracts'
import { useCampClient } from './camp-client'
import { AttachmentCard } from './AttachmentCard'
import { Icon, statuses } from './MissionControls'
import { missionCommand, missionError } from './useMissions'
import { readErrorMessage } from './error-message'
import { missionDate } from './MissionBoard'
import { useFilePreview } from './FilePreviewContext'
import { useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { NavigationIcon } from './NavigationIcon'
import { DialogControlIcon } from './AppDialog'
import { writeClipboardText } from './clipboard'

export function MissionActivityDocument({ mission, agents, onSource, onNotify, onWorkspaceCleanupRequested }: {
  mission: MissionRecord; agents: AgentProfile[]; onSource(id: string): void; onNotify(message: string): void; onWorkspaceCleanupRequested(campId: string): Promise<void>
}) {
  const preview = useFilePreview(), layout = useOptionalFilePreviewLayout()
  const source = (id: string) => { if (layout?.compact) preview.hidePane(); onSource(id) }
  return <div className="mission-activity-document">
    <MissionDeliveryPanel mission={mission} agents={agents} onSource={source} onNotify={onNotify} onWorkspaceCleanupRequested={onWorkspaceCleanupRequested}/>
    <MissionActivityPanel mission={mission} agents={agents} onSource={source}/>
  </div>
}

const kinds: Record<MissionChangedFile['kind'], string> = { added: '新增', deleted: '删除', renamed: '重命名', copied: '复制', type_changed: '类型变化', unmerged: '冲突', modified: '修改' }
type MissionWorkspaceState = NonNullable<Delivery['workspace']>['state']
export function missionChangesVisible(git: boolean, workspaceState: MissionWorkspaceState | null): boolean {
  return git && workspaceState === 'ready'
}
export function MissionDeliveryPanel({ mission, agents, onSource, onNotify, onWorkspaceCleanupRequested }: { mission: MissionRecord; agents: AgentProfile[]; onSource(id: string): void; onNotify(message: string): void; onWorkspaceCleanupRequested(campId: string): Promise<void> }) {
  const client = useCampClient()
  const [data, setData] = useState<Delivery | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  useEffect(() => {
    let current = true
    void client.request<Delivery>('missions.delivery', { missionId: mission.missionId }).then(value => { if (current) { setData(value); setError('') } }).catch(error => { if (current) setError(missionError(error)) })
    return () => { current = false }
  }, [client, mission.missionId, mission.updatedAt, mission.runningAgentIds.join(','), mission.workspaceCleanup?.state, mission.workspaceCleanup?.worktreeRemoved, mission.workspaceCleanup?.branchRemoved, revision])
  async function retryCleanup() {
    setCleanupBusy(true)
    try {
      await missionCommand(client, 'missions.workspace.cleanup', { missionId: mission.missionId })
      setData(current => current?.workspace
        ? { ...current, workspace: { ...current.workspace, state: 'cleanup_pending', diagnostic: null } }
        : current)
      void onWorkspaceCleanupRequested(mission.campId).catch(error => onNotify(`使命 Worktree 清理已开始，但信息刷新失败：${missionError(error)}`))
    } catch (error) { onNotify(missionError(error)) } finally { setCleanupBusy(false) }
  }
  return <section className="mission-delivery-panel" aria-label="使命交付">
    {error && <div className="mission-load-error" role="alert"><span>{error}</span><button onClick={() => setRevision(v => v + 1)}>重试</button></div>}
    {!data && !error && <p className="mission-section-empty" role="status">正在加载交付…</p>}
    {data && <>
      <div className="mission-delivery-section">
        {data.workspace?.state === 'cleaned' && <p className="mission-workspace-cleared">Worktree 已清理 · 下次执行时重建</p>}
        {data.workspace?.state === 'cleanup_pending' && <p className="mission-workspace-cleaning" role="status"><span className="mission-cleanup-spinner" aria-hidden="true"/>{data.workspace.cleanupWorktreeRemoved && !data.workspace.cleanupBranchRemoved ? '正在清理本地分支…' : '正在清理 Worktree…'}</p>}
        <div className="mission-evidence-row"><span>目录</span><code>{data.workingDirectory}</code></div>
        {data.git && data.workspace && <><div className="mission-evidence-row"><span>来源</span><code>{data.workspace.baseBranch ?? 'detached HEAD'}</code></div><div className="mission-evidence-row"><span>基准</span><code title={data.workspace.baseSha}>{data.workspace.baseSha.slice(0, 12)}</code></div></>}
        {data.workspace?.state === 'cleanup_failed' && <div className="mission-workspace-cleanup-failure" role="alert"><strong>{data.workspace.cleanupWorktreeRemoved && !data.workspace.cleanupBranchRemoved ? '分支清理失败' : 'Worktree 清理失败'}</strong><p>{data.workspace.diagnostic ?? '清理未完成，请重试。'}</p><dl><div><dt>Worktree</dt><dd>{data.workspace.cleanupWorktreeRemoved ? '已清理' : '待清理'}</dd></div><div><dt>本地分支</dt><dd>{data.workspace.cleanupBranchRemoved ? '已清理' : '待清理'}</dd></div></dl><button type="button" className="compact-cancel" disabled={cleanupBusy} onClick={() => void retryCleanup()}>{cleanupBusy ? '正在安排重试…' : '重试未完成步骤'}</button></div>}
      </div>
      {missionChangesVisible(data.git, data.workspace?.state ?? null) && <MissionChanges mission={mission} baseSha={data.workspace?.baseSha ?? null}/>}
      <section className="mission-delivery-section"><h3>队员交付 <span>{data.files.length || ''}</span></h3>{data.files.map(file => <div className="mission-delivery-file" key={`${file.messageId}:${file.attachmentId}`}>
        <div className="mission-artifact"><AttachmentCard presentation="agent-timeline" attachment={{ id: file.attachmentId, displayName: file.displayName, kind: file.kind, fileCount: file.fileCount, mediaType: file.mediaType, byteSize: file.byteSize, previewKind: file.previewKind, availability: 'unknown' }} locator={{ owner: 'message', campId: mission.campId, messageId: file.messageId, attachmentRefId: file.attachmentId }} onNotify={onNotify}/><small>{agents.find(a => a.agentId === file.agentId)?.displayName ?? '队员'} · {missionDate(file.createdAt)}</small></div>
        <button className="mission-source-link" onClick={() => onSource(file.messageId)}>查看来源</button>
      </div>)}{!data.files.length && <p className="mission-section-empty">暂无队员交付的文件。</p>}</section>
    </>}
  </section>
}

const MISSION_DIFF_CACHE_LIMIT = 24
const MISSION_DIFF_REQUEST_DELAY_MS = 32
type MissionDiffStore = {
  epoch: number
  cache: Map<string, MissionFileDiff>
  inFlight: Map<string, Promise<MissionFileDiff>>
}
function putMissionDiff(store: MissionDiffStore, fileId: string, diff: MissionFileDiff) {
  store.cache.delete(fileId)
  store.cache.set(fileId, diff)
  while (store.cache.size > MISSION_DIFF_CACHE_LIMIT) {
    const oldest = store.cache.keys().next().value as string | undefined
    if (!oldest) break
    store.cache.delete(oldest)
  }
}
function eventCampId(params: unknown): string | null {
  return typeof params === 'object' && params !== null && typeof (params as Record<string, unknown>).campId === 'string'
    ? (params as Record<string, string>).campId
    : null
}
function staleMissionDiffSnapshot(error: unknown): boolean {
  const message = readErrorMessage(error)
  return message.includes('mission.changes_refresh_required') || message.includes('mission.file_no_longer_changed')
}

type MissionTreeFile = { kind: 'file'; name: string; path: string; file: MissionChangedFile }
type MissionTreeDirectory = { kind: 'directory'; name: string; path: string; children: MissionTreeNode[]; count: number }
type MissionTreeNode = MissionTreeFile | MissionTreeDirectory
type MutableMissionTreeDirectory = { kind: 'directory'; name: string; path: string; children: Map<string, MutableMissionTreeDirectory | MissionTreeFile> }
type VisibleMissionTreeNode = { node: MissionTreeNode; depth: number; parent: string | null; position: number; siblings: number }

export function missionFileTree(files: MissionChangedFile[]): MissionTreeNode[] {
  const root: MutableMissionTreeDirectory = { kind: 'directory', name: '', path: '', children: new Map() }
  for (const file of files) {
    const pieces = file.path.split('/').filter(Boolean)
    if (!pieces.length) continue
    let directory = root
    pieces.slice(0, -1).forEach((name, index) => {
      const key = `directory:${name}`
      const existing = directory.children.get(key)
      if (existing?.kind === 'directory') {
        directory = existing
        return
      }
      const next: MutableMissionTreeDirectory = {
        kind: 'directory',
        name,
        path: pieces.slice(0, index + 1).join('/'),
        children: new Map()
      }
      directory.children.set(key, next)
      directory = next
    })
    directory.children.set(`file:${file.id}`, { kind: 'file', name: pieces.at(-1) ?? file.path, path: file.path, file })
  }
  const compare = (left: MissionTreeNode, right: MissionTreeNode): number => left.kind !== right.kind
    ? left.kind === 'directory' ? -1 : 1
    : left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
  const finalize = (node: MutableMissionTreeDirectory | MissionTreeFile): MissionTreeNode => {
    if (node.kind === 'file') return node
    let result: MissionTreeDirectory = {
      kind: 'directory',
      name: node.name,
      path: node.path,
      children: [...node.children.values()].map(finalize).sort(compare),
      count: 0
    }
    result.count = result.children.reduce((sum, child) => sum + (child.kind === 'file' ? 1 : child.count), 0)
    while (result.children.length === 1 && result.children[0].kind === 'directory') {
      const child = result.children[0]
      result = { ...child, name: result.name ? `${result.name}/${child.name}` : child.name }
    }
    return result
  }
  return [...root.children.values()].map(finalize).sort(compare)
}

function missionTreeDirectoryPaths(nodes: MissionTreeNode[], paths: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    paths.push(node.path)
    missionTreeDirectoryPaths(node.children, paths)
  }
  return paths
}

function flattenMissionTree(nodes: MissionTreeNode[], expanded: ReadonlySet<string>, revealAll: boolean, depth = 0, parent: string | null = null, output: VisibleMissionTreeNode[] = []): VisibleMissionTreeNode[] {
  nodes.forEach((node, index) => {
    output.push({ node, depth, parent, position: index + 1, siblings: nodes.length })
    if (node.kind === 'directory' && (revealAll || expanded.has(node.path))) {
      flattenMissionTree(node.children, expanded, revealAll, depth + 1, node.path, output)
    }
  })
  return output
}

function missionTreeKey(node: MissionTreeNode): string {
  return node.kind === 'directory' ? `directory:${node.path}` : `file:${node.file.id}`
}

const MISSION_TREE_ROW_HEIGHT = 29
const MISSION_TREE_VIRTUAL_THRESHOLD = 80
const MISSION_TREE_OVERSCAN = 8
type MissionTreeWindow = { start: number; end: number; before: number; after: number }

export function missionTreeWindow(total: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan = MISSION_TREE_OVERSCAN): MissionTreeWindow {
  const count = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0))
  if (!count) return { start: 0, end: 0, before: 0, after: 0 }
  const height = Math.max(1, Number.isFinite(rowHeight) ? rowHeight : MISSION_TREE_ROW_HEIGHT)
  const viewport = Math.max(height, Number.isFinite(viewportHeight) ? viewportHeight : height)
  const buffer = Math.max(0, Math.floor(Number.isFinite(overscan) ? overscan : 0))
  const maximum = Math.max(0, count * height - viewport)
  const offset = Math.max(0, Math.min(maximum, Number.isFinite(scrollTop) ? scrollTop : 0))
  const start = Math.max(0, Math.floor(offset / height) - buffer)
  const end = Math.min(count, Math.max(start + 1, Math.ceil((offset + viewport) / height) + buffer))
  return { start, end, before: start * height, after: (count - end) * height }
}

function MissionFileIcon({ file }: { file: MissionChangedFile }): React.JSX.Element {
  const path = file.path.toLocaleLowerCase()
  const document = (soft: string) => <><path d="M3.4 1.25h5.1L13 5.7v8.4c0 .55-.45 1-1 1H3.4c-.55 0-1-.45-1-1V2.25c0-.55.45-1 1-1Z" fill={soft}/><path d="M8.5 1.25V4.9c0 .45.35.8.8.8H13" fill="none" stroke="currentColor" strokeWidth=".75" opacity=".65"/></>
  if (/\.(mjs|cjs|js|jsx)$/.test(path)) return <svg className="node-icon tree-file-type type-js" viewBox="0 0 16 16" aria-hidden="true">{document('var(--tree-js-soft)')}<text x="7.6" y="11.3" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="6.6" fontWeight="600" fill="currentColor">JS</text></svg>
  if (/\.(ts|tsx)$/.test(path)) return <svg className="node-icon tree-file-type type-ts" viewBox="0 0 16 16" aria-hidden="true">{document('var(--tree-ts-soft)')}<text x="7.6" y="11.3" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="6.6" fontWeight="600" fill="currentColor">TS</text></svg>
  if (/\.json$/.test(path)) return <svg className="node-icon tree-file-type type-json" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.4 1.75c-1.8 0-2 1-2 2.6v1.7c0 1.15-.55 1.65-1.65 1.95 1.1.3 1.65.8 1.65 1.95v1.7c0 1.6.2 2.6 2 2.6m5.2-12.5c1.8 0 2 1 2 2.6v1.7c0 1.15.55 1.65 1.65 1.95-1.1.3-1.65.8-1.65 1.95v1.7c0 1.6-.2 2.6-2 2.6" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"/></svg>
  if (/\.(md|mdx)$/.test(path)) return <svg className="node-icon tree-file-type type-md" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.4 11V5.1L4.2 8l2.7-2.9V11M11.7 4.7v6.7m-2.2-2.3 2.2 2.3 2.2-2.3" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"/></svg>
  if (file.binary) return <svg className="node-icon tree-file-type type-image" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="1.8" width="12" height="12.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.05"/><circle cx="5.4" cy="5.3" r="1.1" fill="currentColor"/><path d="m3 12 4.2-4 2.1 1.8 2.5-3 2.2 3.3" fill="none" stroke="currentColor" strokeWidth="1.1"/></svg>
  return <svg className="node-icon tree-file-type type-generic" viewBox="0 0 16 16" aria-hidden="true">{document('var(--tree-generic-soft)')}</svg>
}

function MissionFileStatus({ file }: { file: MissionChangedFile }): React.JSX.Element {
  const symbol = file.kind === 'added' ? <path d="M4.2 7h5.6M7 4.2v5.6"/>
    : file.kind === 'deleted' ? <path d="M4.2 7h5.6"/>
      : file.kind === 'renamed' ? <path d="M3.7 7h6.3M7.6 4.7 10 7 7.6 9.3"/>
        : file.kind === 'copied' ? <path d="M4.3 4.3h4.1v4.1H4.3Zm1.4 5.4h4v-4"/>
          : file.kind === 'type_changed' ? <path d="M4.2 4.8h5.6M7 4.8v4.5"/>
            : file.kind === 'unmerged' ? <><path d="M7 3.9v3.5"/><circle cx="7" cy="10" r=".7" fill="currentColor" stroke="none"/></>
              : <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none"/>
  return <span className="tree-status-slot" aria-hidden="true"><svg className={`tree-status is-${file.kind}`} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth=".95" strokeLinecap="round" strokeLinejoin="round"><rect x=".85" y=".85" width="12.3" height="12.3" rx="2.7"/>{symbol}</svg></span>
}

function TreeFoldIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return <svg className="mission-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{expanded
    ? <><path d="m7 4 5 5 5-5"/><path d="m7 20 5-5 5 5"/></>
    : <><path d="m7 9 5-5 5 5"/><path d="m7 15 5 5 5-5"/></>}</svg>
}

function MissionFileTree({ files, selected, query, expanded, scope, onQueryChange, onExpandedChange, onSelect }: {
  files: MissionChangedFile[]
  selected: string | null
  query: string
  expanded: ReadonlySet<string>
  scope: 'detail' | 'modal'
  onQueryChange(query: string): void
  onExpandedChange(expanded: Set<string>): void
  onSelect(fileId: string, target: HTMLButtonElement): void
}): React.JSX.Element {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingFiles = useMemo(() => normalizedQuery
    ? files.filter(file => `${file.path}\n${file.oldPath ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
    : files, [files, normalizedQuery])
  const tree = useMemo(() => missionFileTree(matchingFiles), [matchingFiles])
  const visible = useMemo(() => flattenMissionTree(tree, expanded, Boolean(normalizedQuery)), [expanded, normalizedQuery, tree])
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 480, rowHeight: MISSION_TREE_ROW_HEIGHT })
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const searchRef = useRef<HTMLInputElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const scrollFrame = useRef(0)
  const pendingFocusKey = useRef<string | null>(null)
  const selectedKey = selected ? `file:${selected}` : null
  const preferredTabKey = visible.some(entry => missionTreeKey(entry.node) === focusedKey) ? focusedKey
    : visible.some(entry => missionTreeKey(entry.node) === selectedKey) ? selectedKey
      : visible[0] ? missionTreeKey(visible[0].node) : null
  const virtualized = visible.length > MISSION_TREE_VIRTUAL_THRESHOLD
  const windowRange = virtualized
    ? missionTreeWindow(visible.length, viewport.scrollTop, viewport.height, viewport.rowHeight)
    : { start: 0, end: visible.length, before: 0, after: 0 }
  const rendered = visible.slice(windowRange.start, windowRange.end)
  const tabKey = rendered.some(entry => missionTreeKey(entry.node) === preferredTabKey)
    ? preferredTabKey
    : rendered[0] ? missionTreeKey(rendered[0].node) : null
  const readViewport = useCallback(() => {
    const element = treeRef.current
    if (!element) return
    const rowHeight = Number.parseFloat(getComputedStyle(element).getPropertyValue('--mission-tree-row-height')) || MISSION_TREE_ROW_HEIGHT
    const height = Math.max(rowHeight, element.clientHeight || rowHeight)
    const scrollTop = Math.max(0, Math.min(element.scrollTop, Math.max(0, visible.length * rowHeight - height)))
    if (element.scrollTop !== scrollTop) element.scrollTop = scrollTop
    setViewport(current => current.scrollTop === scrollTop && current.height === height && current.rowHeight === rowHeight
      ? current
      : { scrollTop, height, rowHeight })
  }, [visible.length])
  useLayoutEffect(() => {
    if (!virtualized || !treeRef.current) return
    readViewport()
    const element = treeRef.current
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(readViewport)
    observer?.observe(element)
    window.addEventListener('resize', readViewport)
    return () => { observer?.disconnect(); window.removeEventListener('resize', readViewport) }
  }, [readViewport, virtualized])
  useLayoutEffect(() => {
    if (scope !== 'modal' || !selectedKey || !virtualized || !treeRef.current) return
    const index = visible.findIndex(entry => missionTreeKey(entry.node) === selectedKey)
    if (index < 0) return
    const element = treeRef.current
    const height = element.clientHeight || viewport.height
    const top = index * viewport.rowHeight
    const bottom = top + viewport.rowHeight
    if (top >= element.scrollTop && bottom <= element.scrollTop + height) return
    const scrollTop = Math.max(0, Math.min(top, visible.length * viewport.rowHeight - height))
    element.scrollTop = scrollTop
    setViewport(current => current.scrollTop === scrollTop ? current : { ...current, scrollTop })
  }, [scope, selectedKey, virtualized, viewport.height, viewport.rowHeight, visible])
  useLayoutEffect(() => {
    const key = pendingFocusKey.current
    if (!key) return
    const row = rows.current.get(key)
    if (!row) return
    pendingFocusKey.current = null
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }, [focusedKey, windowRange.end, windowRange.start])
  useEffect(() => () => { if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current) }, [])
  const resetScroll = (): void => {
    if (treeRef.current) treeRef.current.scrollTop = 0
    setViewport(current => current.scrollTop === 0 ? current : { ...current, scrollTop: 0 })
  }
  const revealIndex = (index: number): void => {
    const element = treeRef.current
    if (!element) return
    const height = element.clientHeight || viewport.height
    const top = index * viewport.rowHeight
    const bottom = top + viewport.rowHeight
    let scrollTop = element.scrollTop
    if (top < scrollTop) scrollTop = top
    else if (bottom > scrollTop + height) scrollTop = bottom - height
    scrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, visible.length * viewport.rowHeight - height)))
    if (element.scrollTop !== scrollTop) element.scrollTop = scrollTop
    setViewport(current => current.scrollTop === scrollTop ? current : { ...current, scrollTop })
  }
  const focusNode = (key: string): void => {
    const index = visible.findIndex(entry => missionTreeKey(entry.node) === key)
    if (index < 0) return
    pendingFocusKey.current = key
    setFocusedKey(key)
    revealIndex(index)
    requestAnimationFrame(() => {
      const row = rows.current.get(key)
      row?.focus({ preventScroll: true })
      row?.scrollIntoView({ block: 'nearest' })
    })
  }
  const toggleDirectory = (path: string): void => {
    if (normalizedQuery) return
    const next = new Set(expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onExpandedChange(next)
  }
  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, entry: VisibleMissionTreeNode, index: number): void => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      if (visible[next]) focusNode(missionTreeKey(visible[next].node))
    } else if (event.key === 'ArrowRight' && entry.node.kind === 'directory') {
      event.preventDefault()
      if (!normalizedQuery && !expanded.has(entry.node.path)) toggleDirectory(entry.node.path)
      else if (visible[index + 1]) focusNode(missionTreeKey(visible[index + 1].node))
    } else if (event.key === 'ArrowLeft') {
      if (entry.node.kind === 'directory' && !normalizedQuery && expanded.has(entry.node.path)) {
        event.preventDefault(); toggleDirectory(entry.node.path)
      } else if (entry.parent) {
        event.preventDefault(); focusNode(`directory:${entry.parent}`)
      }
    }
  }
  return <>
    <div className="changes-tree-tools"><label className="changes-tree-search"><NavigationIcon name="search"/><span className="sr-only">筛选文件或路径</span><input ref={searchRef} type="search" autoComplete="off" spellCheck={false} placeholder="筛选文件…" value={query} aria-controls={`mission-${scope}-tree`} onChange={event => { setFocusedKey(null); resetScroll(); onQueryChange(event.target.value) }} onKeyDown={event => { if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing && visible[0]) { event.preventDefault(); focusNode(missionTreeKey(visible[0].node)) } }}/>{query && <button type="button" className="changes-search-clear" aria-label="清除文件筛选" title="清除文件筛选" onClick={() => { resetScroll(); onQueryChange(''); searchRef.current?.focus() }}><DialogControlIcon name="close"/></button>}</label></div>
    {visible.length ? <div ref={treeRef} className="changes-tree" id={`mission-${scope}-tree`} role="tree" aria-label={scope === 'detail' ? '累计变更文件目录树，可上下滚动' : '选择要查看差异的文件'} onScroll={virtualized ? () => { if (scrollFrame.current) return; scrollFrame.current = requestAnimationFrame(() => { scrollFrame.current = 0; readViewport() }) } : undefined}>
      {windowRange.before > 0 && <div className="changes-tree-spacer" style={{ height: windowRange.before }} aria-hidden="true"/>}
      {rendered.map((entry, renderedIndex) => {
        const node = entry.node
        const index = windowRange.start + renderedIndex
        const directory = node.kind === 'directory'
        const key = missionTreeKey(node)
        const open = directory && (Boolean(normalizedQuery) || expanded.has(node.path))
        const accessible = directory ? `${node.path}，${node.count} 个变更文件` : `${node.path}，${kinds[node.file.kind]}${node.file.binary ? '，二进制文件' : ''}${node.file.oldPath ? `，原路径 ${node.file.oldPath}` : ''}`
        return <button ref={element => { if (element) rows.current.set(key, element); else rows.current.delete(key) }} type="button" role="treeitem" aria-level={entry.depth + 1} aria-posinset={entry.position} aria-setsize={entry.siblings} aria-expanded={directory ? open : undefined} aria-selected={!directory ? node.file.id === selected : undefined} tabIndex={key === tabKey ? 0 : -1} className={`changes-tree-row ${directory ? 'is-directory' : 'is-file'}`} data-node-key={key} data-file-id={directory ? undefined : node.file.id} style={{ '--depth': entry.depth } as CSSProperties} title={node.path} aria-label={accessible} key={key}
          onFocus={() => setFocusedKey(key)} onKeyDown={event => onTreeKeyDown(event, entry, index)} onClick={event => { if (directory) toggleDirectory(node.path); else onSelect(node.file.id, event.currentTarget) }}>
          {Array.from({ length: entry.depth }, (_, guide) => <span className="tree-guide" style={{ '--guide': guide } as CSSProperties} aria-hidden="true" key={guide}/>)}
          {directory ? <span className="node-chevron"><Icon name={open ? 'chevron' : 'chevron-right'}/></span> : <MissionFileIcon file={node.file}/>}
          <span className="node-name">{node.name}</span>
          {directory
            ? <span className="tree-status-slot" aria-hidden="true"><span className="tree-directory-dot"/></span>
            : <MissionFileStatus file={node.file}/>}
        </button>
      })}
      {windowRange.after > 0 && <div className="changes-tree-spacer" style={{ height: windowRange.after }} aria-hidden="true"/>}
    </div> : <div className="changes-filter-empty"><p>没有匹配的文件</p><button type="button" onClick={() => { resetScroll(); onQueryChange(''); searchRef.current?.focus() }}>清除筛选</button></div>}
  </>
}

function checkoutStateLabel(state: CheckoutState): { text: string; title?: string } {
  if (state.kind === 'branch') return { text: state.branch, title: `${state.branch} · ${state.head}` }
  if (state.kind === 'detached') return { text: `detached HEAD · ${state.head.slice(0, 12)}`, title: state.head }
  return { text: '分支信息暂不可用' }
}

function MissionChanges({ mission, baseSha }: { mission: MissionRecord; baseSha: string | null }) {
  const client = useCampClient(), [view, setView] = useState<MissionWorkspaceChangesView | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [selected, setSelected] = useState<string | null>(null), [dialogOpen, setDialogOpen] = useState(false), [detailQuery, setDetailQuery] = useState(''), [detailExpanded, setDetailExpanded] = useState<Set<string>>(new Set()), [snapshotReady, setSnapshotReady] = useState(false), [snapshotEpoch, setSnapshotEpoch] = useState(0)
  const generation = useRef(0)
  const refreshRunner = useRef<(() => void) | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const diffStore = useRef<MissionDiffStore>({ epoch: 0, cache: new Map(), inFlight: new Map() })
  const files = view?.files ?? null
  const checkout = view ? checkoutStateLabel(view.checkoutState) : null
  const tree = useMemo(() => missionFileTree(files ?? []), [files])
  const directoryPaths = useMemo(() => missionTreeDirectoryPaths(tree), [tree])
  useEffect(() => { setDetailExpanded(new Set(directoryPaths)) }, [directoryPaths])
  const refreshChanges = useCallback(() => { refreshRunner.current?.() }, [])
  const requestDiff = useCallback((fileId: string) => {
    const viewId = view?.viewId
    if (!viewId) return Promise.reject(new Error('mission.changes_refresh_required'))
    const store = diffStore.current
    const cached = store.cache.get(fileId)
    if (cached) return Promise.resolve(cached)
    const pending = store.inFlight.get(fileId)
    if (pending) return pending
    const epoch = store.epoch
    const request = client.request<MissionFileDiff>('missions.fileDiff', { missionId: mission.missionId, fileId, viewId })
      .then(diff => {
        if (diffStore.current.epoch === epoch) putMissionDiff(diffStore.current, fileId, diff)
        return diff
      })
      .finally(() => {
        if (diffStore.current.inFlight.get(fileId) === request) diffStore.current.inFlight.delete(fileId)
      })
    store.inFlight.set(fileId, request)
    return request
  }, [client, mission.missionId, view?.viewId])
  useEffect(() => {
    let disposed = false
    let inFlight = false
    let pending = false
    const invalidate = (): void => {
      ++generation.current
      const store = diffStore.current
      store.epoch += 1
      store.cache.clear()
      store.inFlight.clear()
      setSnapshotReady(false)
      setSnapshotEpoch(store.epoch)
      setView(null)
      setError('')
      setLoading(true)
      setDialogOpen(false)
      setDetailQuery('')
    }
    const launch = (): void => {
      if (disposed) return
      inFlight = true
      const current = generation.current
      void client.request<MissionWorkspaceChangesView>('missions.changes', { missionId: mission.missionId }).then(next => {
        if (disposed || current !== generation.current) return
        const files = next.files ?? []
        setView(next)
        setSelected(selected => selected && files.some(file => file.id === selected) ? selected : null)
        setError('')
        setSnapshotReady(Boolean(next.viewId && next.files))
      }).catch(error => {
        if (!disposed && current === generation.current) { setView(null); setError(missionError(error)) }
      }).finally(() => {
        inFlight = false
        if (disposed) return
        if (pending) {
          pending = false
          launch()
        } else if (current === generation.current) {
          setLoading(false)
        }
      })
    }
    const requestRefresh = (): void => {
      if (disposed) return
      invalidate()
      if (inFlight) pending = true
      else launch()
    }
    refreshRunner.current = requestRefresh
    requestRefresh()
    return () => {
      disposed = true
      pending = false
      ++generation.current
      if (refreshRunner.current === requestRefresh) refreshRunner.current = null
    }
  }, [client, mission.missionId])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = client.onEvent?.(event => {
      if (event.method !== 'agent_run.terminal') return
      const campId = eventCampId(event.params)
      if (campId && campId !== mission.campId) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(refreshChanges, 120)
    })
    return () => { if (timer) clearTimeout(timer); unsubscribe?.() }
  }, [client, mission.campId, refreshChanges])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refreshVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(refreshChanges, 80)
    }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => { if (timer) clearTimeout(timer); window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible) }
  }, [refreshChanges])
  useEffect(() => () => {
    const store = diffStore.current
    store.epoch += 1
    store.cache.clear()
    store.inFlight.clear()
    void client.request('missions.diffSession.release', { missionId: mission.missionId }).catch(() => undefined)
  }, [client, mission.missionId])
  const openDiff = (fileId: string, target: HTMLElement): void => { lastFocus.current = target; setSelected(fileId); setDialogOpen(true) }
  const restoreFocus = (): void => { const target = lastFocus.current; requestAnimationFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }) }) }
  const foldersOpen = detailExpanded.size > 0
  return <section className="mission-delivery-section">{checkout && <div className="mission-evidence-row"><Icon name="branch"/><code title={checkout.title}>{checkout.text}</code></div>}<div className="mission-delivery-heading"><h3>累计文件变更 <span>{files && !error ? files.length : ''}</span></h3><div className="mission-changes-actions">
    <button className="mission-icon-button" type="button" aria-label={foldersOpen ? '折叠全部目录' : '展开全部目录'} title={foldersOpen ? '折叠全部目录' : '展开全部目录'} disabled={!files?.length || Boolean(detailQuery.trim())} onClick={() => setDetailExpanded(foldersOpen ? new Set() : new Set(directoryPaths))}><TreeFoldIcon expanded={foldersOpen}/></button>
    <button className="mission-icon-button" type="button" aria-label="刷新累计文件变更" title="刷新累计文件变更" disabled={loading} onClick={refreshChanges}><Icon name="refresh"/></button>
    <button className="mission-icon-button" type="button" aria-label="展开累计文件变更弹窗" title="展开查看" aria-haspopup="dialog" disabled={!files?.length} onClick={event => files?.[0] && openDiff(selected && files.some(file => file.id === selected) ? selected : files[0].id, event.currentTarget)}><Icon name="expand"/></button>
  </div></div>
    {loading && !files && <p className="mission-section-empty" role="status">正在读取工作区…</p>}
    {error
      ? <div className="mission-diff-error" role="alert"><p>{error}</p><button className="compact-cancel" disabled={loading} onClick={refreshChanges}>重新读取</button></div>
      : view?.diffError
        ? <div className="mission-diff-error" role="alert"><p>{missionError(view.diffError)}</p><button className="compact-cancel" disabled={loading} onClick={refreshChanges}>重新读取</button></div>
      : files?.length === 0
        ? <p className="mission-section-empty">当前没有文件变更。</p>
        : files && <MissionFileTree files={files} selected={selected} query={detailQuery} expanded={detailExpanded} scope="detail" onQueryChange={setDetailQuery} onExpandedChange={setDetailExpanded} onSelect={(fileId, target) => openDiff(fileId, target)}/>}
    {dialogOpen && selected && files && (
      <MissionDiff files={files} selected={selected} baseSha={baseSha} snapshotReady={snapshotReady} snapshotEpoch={snapshotEpoch} cache={diffStore.current.cache} requestDiff={requestDiff} onSnapshotStale={refreshChanges} onSelect={setSelected} onClose={() => { setDialogOpen(false); restoreFocus() }}/>
    )}
  </section>
}
function DiffCount({file}: {file: MissionChangedFile}) {
  return file.binary ? <span className="mission-file-binary">二进制</span> : <span className="mission-diff-counts" aria-label={`${file.additions ?? 0} 行增加，${file.deletions ?? 0} 行减少`}><span>+{file.additions ?? 0}</span><span>−{file.deletions ?? 0}</span></span>
}
function MissionDiff({files, selected, baseSha, snapshotReady, snapshotEpoch, cache, requestDiff, onSnapshotStale, onSelect, onClose}: {files: MissionChangedFile[]; selected: string; baseSha: string | null; snapshotReady: boolean; snapshotEpoch: number; cache: Map<string, MissionFileDiff>; requestDiff(fileId: string): Promise<MissionFileDiff>; onSnapshotStale(): void; onSelect(id: string): void; onClose(): void}) {
  const [result, setResult] = useState<{ fileId: string; epoch: number; diff: MissionFileDiff } | null>(null), [failure, setFailure] = useState<{ fileId: string; epoch: number; message: string } | null>(null), [retry, setRetry] = useState(0)
  const [query, setQuery] = useState(''), [expanded, setExpanded] = useState<Set<string>>(() => new Set(missionTreeDirectoryPaths(missionFileTree(files)))), [mobileFilesOpen, setMobileFilesOpen] = useState(false), [copyStatus, setCopyStatus] = useState('')
  const requestGeneration = useRef(0)
  const contentRef = useRef<HTMLDivElement>(null), mobileToggleRef = useRef<HTMLButtonElement>(null), layoutRef = useRef<HTMLDivElement>(null), separatorRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(280), preferredWidth = useRef<number | null>(null), drag = useRef<{ id: number; startX: number; lastX: number; width: number; previous: number | null; scale: number } | null>(null)
  const [treeWidth, setTreeWidth] = useState(280), [splitBounds, setSplitBounds] = useState({ min: 200, max: 600, total: 0 }), [resizing, setResizing] = useState(false)
  const selectedFile = files.find(file => file.id === selected) ?? files[0]
  const cached = cache.get(selected)
  const diff = cached ?? (result?.fileId === selected && result.epoch === snapshotEpoch ? result.diff : null)
  const error = failure?.fileId === selected && failure.epoch === snapshotEpoch ? failure.message : ''
  useEffect(() => {
    const generation = ++requestGeneration.current
    setFailure(null)
    if (!snapshotReady || cache.has(selected)) return
    const timer = setTimeout(() => {
      void requestDiff(selected).then(diff => {
        if (generation === requestGeneration.current) setResult({ fileId: selected, epoch: snapshotEpoch, diff })
      }).catch(error => {
        if (generation !== requestGeneration.current) return
        if (staleMissionDiffSnapshot(error)) { onSnapshotStale(); return }
        setFailure({ fileId: selected, epoch: snapshotEpoch, message: missionError(error) })
      })
    }, MISSION_DIFF_REQUEST_DELAY_MS)
    return () => { clearTimeout(timer); ++requestGeneration.current }
  }, [cache, onSnapshotStale, requestDiff, retry, selected, snapshotEpoch, snapshotReady])
  useEffect(() => { setExpanded(new Set(missionTreeDirectoryPaths(missionFileTree(files)))) }, [files])
  const defaultWidth = (): number => typeof window !== 'undefined' && window.innerWidth <= 760 ? 240 : typeof window !== 'undefined' && window.innerWidth <= 1190 ? 260 : 280
  const applyWidth = useCallback((requested: number | null = preferredWidth.current) => {
    const total = layoutRef.current?.clientWidth ?? 0
    const min = 200
    const readingMin = total > 800 ? 360 : 280
    const max = Math.max(min, Math.min(600, total ? total - readingMin - 1 : 600))
    const next = Math.round(Math.min(max, Math.max(min, requested ?? defaultWidth())))
    widthRef.current = next; setTreeWidth(next); setSplitBounds({ min, max, total })
  }, [])
  useEffect(() => {
    applyWidth()
    const observer = typeof ResizeObserver === 'undefined' || !layoutRef.current ? null : new ResizeObserver(() => applyWidth())
    if (observer && layoutRef.current) observer.observe(layoutRef.current)
    const resize = () => applyWidth()
    window.addEventListener('resize', resize)
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); document.documentElement.classList.remove('diff-resizing') }
  }, [applyWidth])
  const finishResize = useCallback((cancel: boolean) => {
    const current = drag.current
    if (!current) return
    drag.current = null
    preferredWidth.current = cancel ? current.previous : widthRef.current
    if (separatorRef.current?.hasPointerCapture(current.id)) separatorRef.current.releasePointerCapture(current.id)
    document.documentElement.classList.remove('diff-resizing'); setResizing(false); applyWidth(preferredWidth.current)
  }, [applyWidth])
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => { if (drag.current && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finishResize(true) } }
    const blur = () => finishResize(true)
    document.addEventListener('keydown', keydown, true); window.addEventListener('blur', blur)
    return () => { document.removeEventListener('keydown', keydown, true); window.removeEventListener('blur', blur) }
  }, [finishResize])
  const moveResize = (clientX: number): void => {
    const current = drag.current
    if (!current) return
    current.lastX = clientX
    applyWidth(current.width + (clientX - current.startX) / current.scale)
  }
  const selectFile = (fileId: string): void => {
    onSelect(fileId)
    if (window.matchMedia('(max-width: 580px)').matches) {
      setMobileFilesOpen(false)
      requestAnimationFrame(() => mobileToggleRef.current?.focus({ preventScroll: true }))
    }
  }
  const focusInitial = (): void => {
    requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 580px)').matches) { mobileToggleRef.current?.focus({ preventScroll: true }); return }
      const rows = Array.from(contentRef.current?.querySelectorAll<HTMLButtonElement>('[data-file-id]') ?? [])
      rows.find(row => row.dataset.fileId === selected)?.focus({ preventScroll: true })
    })
  }
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0), deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  const copyPath = async (): Promise<void> => {
    const copied = await writeClipboardText(selectedFile.path).catch(() => false)
    setCopyStatus(copied ? '已复制相对路径' : '复制失败，请手动选择路径')
  }
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content ref={contentRef} className="compact-dialog mission-diff-dialog" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); focusInitial() }} onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { if (drag.current) { event.preventDefault(); finishResize(true) } }}>
    <header className="compact-header"><div className="diff-dialog-heading"><Dialog.Title>累计文件变更</Dialog.Title><div className="diff-dialog-baseline" aria-label="固定基准与当前使命工作区比较"><code title={baseSha ?? undefined}>{baseSha?.slice(0, 12) ?? '基准不可用'}</code><svg className="mission-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg><span>当前使命工作区</span></div></div><div className="diff-dialog-summary"><span>{files.length} 个文件</span><span className="mission-diff-counts" aria-label={`合计增加 ${additions} 行，减少 ${deletions} 行`}><span>+{additions}</span><span>−{deletions}</span></span></div><Dialog.Close asChild><button className="compact-close" type="button" aria-label="关闭累计文件变更" title="关闭"><DialogControlIcon name="close"/></button></Dialog.Close></header>
    <div className="compact-body"><button ref={mobileToggleRef} type="button" className="mobile-files-toggle" aria-expanded={mobileFilesOpen} aria-controls="mission-modal-file-navigation" onClick={() => setMobileFilesOpen(value => !value)}><NavigationIcon name="folder-open"/><span>变更文件 {files.length}</span><Icon name="chevron"/></button>
      <div ref={layoutRef} className="mission-diff-layout" style={{ '--diff-tree-width': `${treeWidth}px` } as CSSProperties}><nav id="mission-modal-file-navigation" className={`mission-diff-file-list${mobileFilesOpen ? ' is-mobile-open' : ''}`} aria-label="变更文件"><div className="modal-tree-heading"><span>变更文件</span><small>{files.length}</small><button className="mission-icon-button" type="button" aria-label={expanded.size ? '折叠全部目录' : '展开全部目录'} title={expanded.size ? '折叠全部目录' : '展开全部目录'} disabled={Boolean(query.trim())} onClick={() => setExpanded(expanded.size ? new Set() : new Set(missionTreeDirectoryPaths(missionFileTree(files))))}><TreeFoldIcon expanded={expanded.size > 0}/></button></div><MissionFileTree files={files} selected={selected} query={query} expanded={expanded} scope="modal" onQueryChange={setQuery} onExpandedChange={setExpanded} onSelect={fileId => selectFile(fileId)}/></nav>
        <div ref={separatorRef} className={`diff-resize-handle${resizing ? ' is-resizing' : ''}`} role="separator" tabIndex={0} aria-label="调整变更文件树宽度" aria-orientation="vertical" aria-controls="mission-modal-file-navigation mission-diff-reading" aria-valuemin={splitBounds.min} aria-valuemax={splitBounds.max} aria-valuenow={treeWidth} aria-valuetext={`文件树 ${treeWidth} 像素，内容 ${Math.max(0, splitBounds.total - treeWidth - 1)} 像素`} title="拖动调整 · 双击恢复默认宽度 · 方向键调整"
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => { if (event.button !== 0 || !event.isPrimary || drag.current || !layoutRef.current) return; event.preventDefault(); const bounds = layoutRef.current.getBoundingClientRect(); drag.current = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, width: widthRef.current, previous: preferredWidth.current, scale: bounds.width / layoutRef.current.clientWidth || 1 }; event.currentTarget.setPointerCapture(event.pointerId); document.documentElement.classList.add('diff-resizing'); setResizing(true) }}
          onPointerMove={event => { if (drag.current?.id === event.pointerId) moveResize(event.clientX) }} onPointerUp={event => { if (drag.current?.id === event.pointerId) { moveResize(event.clientX); finishResize(false) } }} onPointerCancel={() => finishResize(true)} onLostPointerCapture={() => { if (drag.current) finishResize(true) }} onDoubleClick={() => { if (drag.current) finishResize(true); preferredWidth.current = null; applyWidth(null) }} onKeyDown={event => { if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return; event.preventDefault(); if (drag.current) finishResize(true); const step = event.shiftKey ? 80 : 24; preferredWidth.current = event.key === 'Home' ? null : Math.max(splitBounds.min, Math.min(splitBounds.max, treeWidth + (event.key === 'ArrowRight' ? step : -step))); applyWidth(preferredWidth.current) }}><span className="diff-splitter-tip" aria-hidden="true">文件树 {treeWidth}px · 内容 {Math.max(0, splitBounds.total - treeWidth - 1)}px</span><span className="sr-only">左右方向键调整 24px，Shift 加速；Home 或双击恢复默认宽度；拖动时 Escape 取消。</span></div>
        <section id="mission-diff-reading" className="mission-diff-reading" aria-label="文件差异"><header><MissionFileIcon file={selectedFile}/><div className="diff-title-wrap"><strong>{selectedFile.path}</strong>{selectedFile.oldPath && <small><span>{selectedFile.oldPath}</span><svg className="mission-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg><span>{selectedFile.path.split('/').at(-1)}</span></small>}</div><div className="diff-header-stats"><DiffCount file={selectedFile}/></div><button className="mission-icon-button header-copy" type="button" aria-label="复制文件相对路径" title="复制相对路径" onClick={() => void copyPath()}><svg className="mission-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></header>
          {error ? <div className="mission-diff-error" role="alert"><p>{error}</p><button className="compact-cancel" onClick={() => setRetry(value => value + 1)}>重试</button></div> : !diff ? <p className="mission-diff-state" role="status">{snapshotReady ? '正在读取文件差异…' : '正在更新文件清单…'}</p> : diff.file.binary ? <div className="diff-code-scroll"><div className="diff-empty-content"><MissionFileIcon file={diff.file}/><strong>二进制文件</strong><p>没有可展示的文本行差异。</p></div></div> : diff.hunks.length ? <div className="diff-code-scroll" tabIndex={0} aria-label="差异内容，可滚动"><div className="mission-diff-code" role="table" aria-label={`${diff.file.path} 的差异行`}>{diff.hunks.map((hunk, index) => <div key={index} role="rowgroup"><div className="mission-diff-hunk" role="row">@@ −{hunk.oldStart} +{hunk.newStart} @@</div>{hunk.lines.map((line, lineIndex) => <div className={`mission-diff-line is-${line.kind}`} role="row" key={lineIndex}><span role="cell" className="mission-line-number">{line.oldLine ?? ''}</span><span role="cell" className="mission-line-number">{line.newLine ?? ''}</span><code role="cell"><span aria-hidden="true">{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '}</span>{line.text}</code></div>)}</div>)}</div></div> : <div className="diff-code-scroll"><div className="diff-empty-content"><strong>没有文本行差异</strong>{diff.file.oldPath && <div className="rename-route"><code>{diff.file.oldPath}</code><span aria-hidden="true">→</span><code>{diff.file.path}</code></div>}</div></div>}
        </section>
      </div>
    </div><span className="sr-only" role="status" aria-live="polite">{copyStatus}</span>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}

function activityText(item: MissionActivity): string {
  if (item.kind === 'created') return '创建了使命'
  if (item.kind === 'started') return '开始了使命'
  if (item.kind === 'status') return `将状态改为“${statuses.find(s => s.id === item.changes.status)?.label ?? item.changes.status}”`
  if (item.kind === 'pull_request') return `${item.changes.removed ? '移除了' : '关联了'} Pull Request`
  if (item.kind === 'members') return '更新了队员'
  if (item.kind === 'lead') return '调整了队长'
  const fields = Object.keys(item.changes).map(key => ({titleChanged:'标题',descriptionChanged:'使命描述',tagsChanged:'标签'}[key] ?? key))
  return `更新了${fields.join('、')}`
}
export function MissionActivityPanel({ mission, agents, onSource }: {mission: MissionRecord; agents: AgentProfile[]; onSource(id: string): void}) {
  const client = useCampClient(), [items, setItems] = useState<MissionActivity[]>([]), [loading, setLoading] = useState(true), [more, setMore] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => { let current=true; setLoading(true); void client.request<MissionActivity[]>('missions.activity', {missionId: mission.missionId}).then(items => {if(current) {setItems(items); setMore(items.length===100); setError('')}}).catch(error => {if(current) setError(missionError(error))}).finally(() => {if(current) setLoading(false)}); return () => {current=false} }, [client, mission.missionId, mission.updatedAt, retry])
  async function earlier() {setLoading(true); try {const next=await client.request<MissionActivity[]>('missions.activity',{missionId:mission.missionId,before:items.at(-1)?.id}); setItems(items => [...items,...next.filter(next=>!items.some(item=>item.id===next.id))]); setMore(next.length===100); setError('')}catch(error){setError(missionError(error))}finally{setLoading(false)}}
  return <section className="mission-activity-panel" aria-label="使命活动"><h3>使命历史</h3>{items.map(item => <div className="mission-history-row" key={item.id}><Icon name="history"/><div><p><strong>{item.actorType==='user' ? '你' : agents.find(a=>a.agentId===item.actorId)?.displayName ?? '队员'}</strong> {activityText(item)}</p><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{missionDate(item.createdAt)}</time>{typeof item.changes.sourceMessageId==='string' && <button className="mission-source-link" onClick={()=>onSource(item.changes.sourceMessageId as string)}>查看说明</button>}</div></div>)}
    {error && <div className="mission-load-error" role="alert"><span>{error}</span><button onClick={()=>setRetry(v=>v+1)}>重试</button></div>}{loading && <p className="mission-section-empty" role="status">正在读取历史…</p>}{more && <button className="compact-cancel" disabled={loading} onClick={()=>void earlier()}>查看更早活动</button>}
  </section>
}
