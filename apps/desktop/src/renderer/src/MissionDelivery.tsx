import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentProfile, MissionActivity, MissionChangedFile, MissionDelivery as Delivery, MissionFileDiff, MissionRecord } from '@contracts'
import { useCampClient } from './camp-client'
import { AttachmentCard } from './AttachmentCard'
import { CompactDialog, Icon, statuses } from './MissionControls'
import { missionError } from './useMissions'
import { readErrorMessage } from './error-message'
import { missionDate } from './MissionBoard'
import { useFilePreview } from './FilePreviewContext'
import { useOptionalFilePreviewLayout } from './FilePreviewLayout'

export function MissionActivityDocument({ mission, agents, onSource, onNotify }: {
  mission: MissionRecord; agents: AgentProfile[]; onSource(id: string): void; onNotify(message: string): void
}) {
  const preview = useFilePreview(), layout = useOptionalFilePreviewLayout()
  const source = (id: string) => { if (layout?.compact) preview.hidePane(); onSource(id) }
  return <div className="mission-activity-document">
    <MissionDeliveryPanel mission={mission} agents={agents} onSource={source} onNotify={onNotify}/>
    <MissionActivityPanel mission={mission} agents={agents} onSource={source}/>
  </div>
}

const kinds: Record<MissionChangedFile['kind'], string> = { added: '新增', deleted: '删除', renamed: '重命名', copied: '复制', type_changed: '类型变化', unmerged: '冲突', modified: '修改' }
export function MissionDeliveryPanel({ mission, agents, onSource, onNotify }: { mission: MissionRecord; agents: AgentProfile[]; onSource(id: string): void; onNotify(message: string): void }) {
  const client = useCampClient()
  const [data, setData] = useState<Delivery | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    void client.request<Delivery>('missions.delivery', { missionId: mission.missionId }).then(value => { if (current) { setData(value); setError('') } }).catch(error => { if (current) setError(missionError(error)) })
    return () => { current = false }
  }, [client, mission.missionId, mission.updatedAt, mission.runningAgentIds.join(','), revision])
  return <section className="mission-delivery-panel" aria-label="使命交付">
    {error && <div className="mission-load-error" role="alert"><span>{error}</span><button onClick={() => setRevision(v => v + 1)}>重试</button></div>}
    {!data && !error && <p className="mission-section-empty" role="status">正在加载交付…</p>}
    {data && <>
      <div className="mission-delivery-section">
        {data.workspace?.state === 'cleaned' && <p className="mission-workspace-cleared">Worktree 已清理 · 下次执行时重建</p>}
        <div className="mission-evidence-row"><span>目录</span><code>{data.workingDirectory}</code></div>
        {data.git && data.workspace && <><div className="mission-evidence-row"><Icon name="branch"/><code>{data.workspace.branch}</code></div><div className="mission-evidence-row"><span>来源</span><code>{data.workspace.baseBranch ?? 'detached HEAD'}</code></div><div className="mission-evidence-row"><span>基准</span><code title={data.workspace.baseSha}>{data.workspace.baseSha.slice(0, 12)}</code></div></>}
        {data.workspace?.diagnostic && <p className="mission-load-error" role="alert">{data.workspace.diagnostic}</p>}
      </div>
      {data.git && (!data.workspace || data.workspace.state === 'ready') && <MissionChanges mission={mission}/>}
      <section className="mission-delivery-section"><h3>队员交付 <span>{data.files.length || ''}</span></h3>{data.files.map(file => <div className="mission-delivery-file" key={`${file.messageId}:${file.attachmentId}`}>
        <div className="mission-artifact"><AttachmentCard presentation="agent-timeline" attachment={{ id: file.attachmentId, displayName: file.displayName, kind: file.kind, fileCount: file.fileCount, mediaType: file.mediaType, byteSize: file.byteSize, previewKind: file.previewKind, availability: 'unknown' }} locator={{ owner: 'message', campId: mission.campId, messageId: file.messageId, attachmentRefId: file.attachmentId }} onNotify={onNotify}/><small>{agents.find(a => a.agentId === file.agentId)?.displayName ?? '队员'} · {missionDate(file.createdAt)}</small></div>
        <button className="mission-source-link" onClick={() => onSource(file.messageId)}>查看来源</button>
      </div>)}{!data.files.length && <p className="mission-section-empty">暂无队员交付的文件。</p>}</section>
    </>}
  </section>
}

const MISSION_DIFF_CACHE_LIMIT = 24
const MISSION_DIFF_REQUEST_DELAY_MS = 32
const MISSION_CHANGES_INITIAL_FILE_LIMIT = 5
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

function MissionChanges({ mission }: { mission: MissionRecord }) {
  const client = useCampClient(), [files, setFiles] = useState<MissionChangedFile[] | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [selected, setSelected] = useState<string | null>(null), [showAllFiles, setShowAllFiles] = useState(false), [snapshotReady, setSnapshotReady] = useState(false), [snapshotEpoch, setSnapshotEpoch] = useState(0)
  const generation = useRef(0)
  const diffStore = useRef<MissionDiffStore>({ epoch: 0, cache: new Map(), inFlight: new Map() })
  const refreshChanges = useCallback(() => {
    const store = diffStore.current
    store.epoch += 1
    store.cache.clear()
    store.inFlight.clear()
    setSnapshotReady(false)
    setSnapshotEpoch(store.epoch)
    setShowAllFiles(false)
    setRefresh(value => value + 1)
  }, [])
  const requestDiff = useCallback((fileId: string) => {
    const store = diffStore.current
    const cached = store.cache.get(fileId)
    if (cached) return Promise.resolve(cached)
    const pending = store.inFlight.get(fileId)
    if (pending) return pending
    const epoch = store.epoch
    const request = client.request<MissionFileDiff>('missions.fileDiff', { missionId: mission.missionId, fileId })
      .then(diff => {
        if (diffStore.current.epoch === epoch) putMissionDiff(diffStore.current, fileId, diff)
        return diff
      })
      .finally(() => {
        if (diffStore.current.inFlight.get(fileId) === request) diffStore.current.inFlight.delete(fileId)
      })
    store.inFlight.set(fileId, request)
    return request
  }, [client, mission.missionId])
  useEffect(() => {
    const current = ++generation.current; setLoading(true); setSnapshotReady(false)
    void client.request<MissionChangedFile[]>('missions.changes', { missionId: mission.missionId }).then(files => { if (current === generation.current) { setFiles(files); setSelected(selected => selected && files.some(file => file.id === selected) ? selected : null); setError(''); setSnapshotReady(true) } }).catch(error => { if (current === generation.current) setError(missionError(error)) }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { ++generation.current }
  }, [client, mission.missionId, refresh])
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
  useEffect(() => () => {
    const store = diffStore.current
    store.epoch += 1
    store.cache.clear()
    store.inFlight.clear()
    void client.request('missions.diffSession.release', { missionId: mission.missionId }).catch(() => undefined)
  }, [client, mission.missionId])
  const visibleFiles = showAllFiles ? files : files?.slice(0, MISSION_CHANGES_INITIAL_FILE_LIMIT)
  const additionalFileCount = Math.max(0, (files?.length ?? 0) - MISSION_CHANGES_INITIAL_FILE_LIMIT)
  return <section className="mission-delivery-section"><div className="mission-delivery-heading"><h3>累计文件变更 <span>{files && !error ? files.length : ''}</span></h3><button className="mission-icon-button" aria-label="刷新累计文件变更" disabled={loading} onClick={refreshChanges}><Icon name="refresh"/></button></div>
    {loading && !files && <p className="mission-section-empty" role="status">正在读取工作区…</p>}
    {error ? <div className="mission-diff-error" role="status"><p>{error}</p><button className="compact-cancel" disabled={loading} onClick={refreshChanges}>重新读取</button></div> : files?.length === 0 ? <p className="mission-section-empty">当前没有文件变更。</p> : visibleFiles?.map(file => <button className="mission-changed-file" key={file.id} onClick={() => setSelected(file.id)}>
      <span className={`mission-file-kind is-${file.kind}`}>{kinds[file.kind] ?? '变化'}</span><span className="mission-changed-path"><strong>{file.path}</strong>{file.oldPath && <small>{file.oldPath} →</small>}</span><DiffCount file={file}/><Icon name="chevron-right"/>
    </button>)}
    {!error && additionalFileCount > 0 && <button className="mission-changes-more-files" type="button" aria-expanded={showAllFiles} onClick={() => setShowAllFiles(visible => !visible)}><span>{showAllFiles ? '收起文件' : `再显示 ${additionalFileCount} 个文件`}</span><Icon name="chevron"/></button>}
    {selected && files && <MissionDiff files={files} selected={selected} snapshotReady={snapshotReady} snapshotEpoch={snapshotEpoch} cache={diffStore.current.cache} requestDiff={requestDiff} onSnapshotStale={refreshChanges} onSelect={setSelected} onClose={() => setSelected(null)}/>}
  </section>
}
function DiffCount({file}: {file: MissionChangedFile}) {
  return file.binary ? <span className="mission-file-binary">二进制</span> : <span className="mission-diff-counts"><span>+{file.additions ?? 0}</span><span>−{file.deletions ?? 0}</span></span>
}
function MissionDiff({files, selected, snapshotReady, snapshotEpoch, cache, requestDiff, onSnapshotStale, onSelect, onClose}: {files: MissionChangedFile[]; selected: string; snapshotReady: boolean; snapshotEpoch: number; cache: Map<string, MissionFileDiff>; requestDiff(fileId: string): Promise<MissionFileDiff>; onSnapshotStale(): void; onSelect(id: string): void; onClose(): void}) {
  const [result, setResult] = useState<{ fileId: string; epoch: number; diff: MissionFileDiff } | null>(null), [failure, setFailure] = useState<{ fileId: string; epoch: number; message: string } | null>(null), [retry, setRetry] = useState(0)
  const requestGeneration = useRef(0)
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
  return <CompactDialog title="累计文件变更" className="mission-diff-dialog" onClose={onClose}>
    <div className="mission-diff-layout"><nav className="mission-diff-file-list" aria-label="变更文件">{files.map(file => <button key={file.id} aria-current={selected===file.id} onClick={() => onSelect(file.id)}><span>{file.path}</span><DiffCount file={file}/></button>)}</nav>
      <section className="mission-diff-reading" aria-label="文件差异">{error ? <div className="mission-diff-error" role="alert"><p>{error}</p><button className="compact-cancel" onClick={() => setRetry(v => v + 1)}>重试</button></div> : !diff ? <p className="mission-diff-state" role="status">{snapshotReady ? '正在读取文件差异…' : '正在更新文件清单…'}</p> : <>
        <header><strong>{diff.file.path}</strong><span>{kinds[diff.file.kind]}</span></header>
        {diff.file.binary ? <p className="mission-diff-note">二进制文件已变化。</p> : diff.hunks.length ? <div className="mission-diff-code" role="table" aria-label="差异行">{diff.hunks.map((hunk, i) => <div key={i} role="rowgroup"><div className="mission-diff-hunk" role="row">@@ −{hunk.oldStart} +{hunk.newStart} @@</div>{hunk.lines.map((line, j) => <div className={`mission-diff-line is-${line.kind}`} role="row" key={j}><span role="cell" className="mission-line-number">{line.oldLine ?? ''}</span><span role="cell" className="mission-line-number">{line.newLine ?? ''}</span><code role="cell"><span aria-hidden="true">{line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '}</span>{line.text}</code></div>)}</div>)}</div> : <p className="mission-diff-note">没有文本行差异。</p>}
      </>}</section>
    </div>
  </CompactDialog>
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
