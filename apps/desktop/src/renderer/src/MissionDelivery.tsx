import { useEffect, useRef, useState } from 'react'
import type { AgentProfile, MissionActivity, MissionChangedFile, MissionDelivery as Delivery, MissionFileDiff, MissionRecord } from '@contracts'
import { useCampClient } from './camp-client'
import { AttachmentCard } from './AttachmentCard'
import { CompactDialog, Icon, statuses } from './MissionControls'
import { missionCommand, missionError } from './useMissions'
import { missionDate } from './MissionBoard'

const kinds: Record<MissionChangedFile['kind'], string> = { added: '新增', deleted: '删除', renamed: '重命名', copied: '复制', type_changed: '类型变化', unmerged: '冲突', modified: '修改' }
export function MissionDeliveryPanel({ mission, agents, onSource, onNotify }: { mission: MissionRecord; agents: AgentProfile[]; onSource(id: string): void; onNotify(message: string): void }) {
  const client = useCampClient()
  const [data, setData] = useState<Delivery | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const [url, setUrl] = useState(''), [addingPr, setAddingPr] = useState(false), [prBusy, setPrBusy] = useState(false), [prError, setPrError] = useState('')
  useEffect(() => {
    let current = true
    void client.request<Delivery>('missions.delivery', { missionId: mission.missionId }).then(value => { if (current) { setData(value); setError('') } }).catch(error => { if (current) setError(missionError(error)) })
    return () => { current = false }
  }, [client, mission.missionId, mission.updatedAt, mission.runningAgentIds.join(','), revision])
  async function linkPr(prUrl: string, remove = false) {
    setPrBusy(true); setPrError('')
    try { await missionCommand(client, 'missions.linkPr', { missionId: mission.missionId, url: prUrl, remove }); setRevision(v => v + 1); setUrl(''); setAddingPr(false) }
    catch (error) { setPrError(missionError(error)) } finally { setPrBusy(false) }
  }
  return <section className="mission-delivery-panel" aria-label="使命交付">
    {error && <div className="mission-load-error" role="alert"><span>{error}</span><button onClick={() => setRevision(v => v + 1)}>重试</button></div>}
    {!data && !error && <p className="mission-section-empty" role="status">正在加载交付…</p>}
    {data && <>
      <div className="mission-delivery-section">
        <div className="mission-evidence-row"><span>目录</span><code>{data.workingDirectory}</code></div>
        {data.git && data.workspace && <><div className="mission-evidence-row"><Icon name="branch"/><code>{data.workspace.branch}</code></div><div className="mission-evidence-row"><span>基准</span><code title={data.workspace.baseSha}>{data.workspace.baseSha.slice(0, 12)}</code></div></>}
        {data.workspace?.diagnostic && <p className="mission-load-error" role="alert">{data.workspace.diagnostic}</p>}
      </div>
      {data.git && <MissionChanges mission={mission} revision={revision}/>}
      <section className="mission-delivery-section"><div className="mission-delivery-heading"><h3>Pull Requests <span>{data.pullRequests.length || ''}</span></h3><button className="mission-icon-button" aria-label="关联 Pull Request" onClick={() => setAddingPr(v => !v)}><Icon name="plus"/></button></div>
        {addingPr && <form className="mission-pr-form" onSubmit={e => { e.preventDefault(); void linkPr(url.trim()) }}><input type="url" aria-label="Pull Request 链接" placeholder="粘贴 Pull Request 链接" required value={url} onChange={e => setUrl(e.target.value)} disabled={prBusy} autoFocus/><button className="compact-primary" disabled={prBusy || !url.trim()}>关联</button><button className="compact-cancel" type="button" disabled={prBusy} onClick={() => setAddingPr(false)}>取消</button></form>}
        {prError && <p className="compact-inline-error" role="alert">{prError}</p>}
        {data.pullRequests.map(pr => <div className="mission-pr-entry" key={pr.id}><a className="mission-pr-row" href={pr.url} target="_blank" rel="noreferrer"><Icon name="branch"/><span><strong>{pr.title || new URL(pr.url).pathname.split('/').filter(Boolean).slice(-3).join('/')}</strong><small>{new URL(pr.url).host}</small></span></a><button className="mission-icon-button" disabled={prBusy} onClick={() => void linkPr(pr.url, true)} aria-label={`移除关联 ${pr.title || pr.url}`}><span aria-hidden="true">×</span></button></div>)}
        {!data.pullRequests.length && !addingPr && <p className="mission-section-empty">暂无关联的 Pull Request。</p>}
      </section>
      <section className="mission-delivery-section"><h3>队员交付 <span>{data.files.length || ''}</span></h3>{data.files.map(file => <div className="mission-delivery-file" key={`${file.messageId}:${file.attachmentId}`}>
        <div className="mission-artifact"><AttachmentCard presentation="agent-timeline" attachment={{ id: file.attachmentId, displayName: file.displayName, kind: file.kind, fileCount: file.fileCount, mediaType: file.mediaType, byteSize: file.byteSize, previewKind: file.previewKind, availability: 'unknown' }} locator={{ owner: 'message', campId: mission.campId, messageId: file.messageId, attachmentRefId: file.attachmentId }} onNotify={onNotify}/><small>{agents.find(a => a.agentId === file.agentId)?.displayName ?? '队员'} · {missionDate(file.createdAt)}</small></div>
        <button className="mission-source-link" onClick={() => onSource(file.messageId)}>查看来源</button>
      </div>)}{!data.files.length && <p className="mission-section-empty">暂无队员交付的文件。</p>}</section>
    </>}
  </section>
}

function MissionChanges({ mission, revision }: { mission: MissionRecord; revision: number }) {
  const client = useCampClient(), [files, setFiles] = useState<MissionChangedFile[] | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [selected, setSelected] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current; setLoading(true)
    void client.request<MissionChangedFile[]>('missions.changes', { missionId: mission.missionId }).then(files => { if (current === generation.current) { setFiles(files); setError('') } }).catch(error => { if (current === generation.current) setError(missionError(error)) }).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { ++generation.current }
  }, [client, mission.missionId, mission.updatedAt, mission.runningAgentIds.join(','), revision, refresh])
  return <section className="mission-delivery-section"><div className="mission-delivery-heading"><h3>累计文件变更 <span>{files && !error ? files.length : ''}</span></h3><button className="mission-icon-button" aria-label="刷新累计文件变更" disabled={loading} onClick={() => setRefresh(v => v + 1)}><Icon name="refresh"/></button></div>
    {loading && !files && <p className="mission-section-empty" role="status">正在读取工作区…</p>}
    {error ? <div className="mission-diff-error" role="status"><p>{error}</p><button className="compact-cancel" disabled={loading} onClick={() => setRefresh(v => v + 1)}>重新读取</button></div> : files?.length === 0 ? <p className="mission-section-empty">当前没有文件变更。</p> : files?.map(file => <button className="mission-changed-file" key={file.id} onClick={() => setSelected(file.id)}>
      <span className={`mission-file-kind is-${file.kind}`}>{kinds[file.kind] ?? '变化'}</span><span className="mission-changed-path"><strong>{file.path}</strong>{file.oldPath && <small>{file.oldPath} →</small>}</span><DiffCount file={file}/><Icon name="chevron-right"/>
    </button>)}
    {selected && files && <MissionDiff missionId={mission.missionId} files={files} selected={selected} onSelect={setSelected} onClose={() => setSelected(null)}/>}
  </section>
}
function DiffCount({file}: {file: MissionChangedFile}) {
  return file.binary ? <span className="mission-file-binary">二进制</span> : <span className="mission-diff-counts"><span>+{file.additions ?? 0}</span><span>−{file.deletions ?? 0}</span></span>
}
function MissionDiff({missionId, files, selected, onSelect, onClose}: {missionId: string; files: MissionChangedFile[]; selected: string; onSelect(id: string): void; onClose(): void}) {
  const client = useCampClient(), [diff, setDiff] = useState<MissionFileDiff | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => { let current = true; setDiff(null); setError(''); void client.request<MissionFileDiff>('missions.fileDiff', {missionId, fileId: selected}).then(diff => {if(current) setDiff(diff)}).catch(error => {if(current) setError(missionError(error))}); return () => {current=false} }, [client, missionId, selected, retry])
  return <CompactDialog title="累计文件变更" className="mission-diff-dialog" onClose={onClose}>
    <div className="mission-diff-layout"><nav className="mission-diff-file-list" aria-label="变更文件">{files.map(file => <button key={file.id} aria-current={selected===file.id} onClick={() => onSelect(file.id)}><span>{file.path}</span><DiffCount file={file}/></button>)}</nav>
      <section className="mission-diff-reading" aria-label="文件差异">{error ? <div className="mission-diff-error" role="alert"><p>{error}</p><button className="compact-cancel" onClick={() => setRetry(v => v + 1)}>重试</button></div> : !diff ? <p className="mission-diff-state" role="status">正在读取文件差异…</p> : <>
        <header><strong>{diff.file.path}</strong><span>{kinds[diff.file.kind]}</span></header>
        {diff.file.oldMode !== diff.file.newMode && <p className="mission-diff-note">Git 文件模式：{diff.file.oldMode} → {diff.file.newMode}</p>}
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
  const fields = Object.keys(item.changes).map(key => ({title:'标题',description:'使命描述',tags:'标签'}[key] ?? key))
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
