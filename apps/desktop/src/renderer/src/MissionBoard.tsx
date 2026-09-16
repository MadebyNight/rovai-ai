import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import type { AgentProfile, CampOpenProjection, MissionDelivery, MissionRecord, MissionStatus, MissionWorkspace, ProjectNavigationGroup } from '@contracts'
import { useCampClient } from './camp-client'
import { newCommandId } from '../../shared/command-id'
import { DialogControlIcon } from './AppDialog'
import { NavigationIcon } from './NavigationIcon'
import { MissionIcon } from './MissionIcon'
import { CompactDialog, Icon, LabelsEditor, MissionAvatars, MissionContextMenu, MissionFilter, MissionPeopleProvider, MissionPopover, MissionRoster, MissionTags, StatusIcon, FilterStateIcon, TagMark, statuses, type ContextPosition } from './MissionControls'
import { MissionCommandRejected, missionCommand, missionError } from './useMissions'

type MissionActions = {
  edit(mission: MissionRecord): void
  menu(mission: MissionRecord, event: MouseEvent<HTMLElement>): void
  roster(mission: MissionRecord, event: MouseEvent<HTMLElement>): void
  tags(mission: MissionRecord, event: MouseEvent<HTMLElement>): void
  status(mission: MissionRecord, status: MissionStatus): void
  start(mission: MissionRecord): void
  busyId: string | null
}
const Actions = createContext<MissionActions | null>(null)
function useMissionActions(): MissionActions {
  const actions = useContext(Actions)
  if (!actions) throw new Error('Mission interaction owner is unavailable')
  return actions
}
export function missionProject(m: MissionRecord, projects: ProjectNavigationGroup[]): string {
  return m.projectBindingKind === 'quick_chat' ? '快速对话' : projects.find(p => p.projectPath === m.projectPath)?.name ?? m.projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? m.projectPath
}
export function missionDate(value: string): string {
  const date = new Date(value), today = new Date(), yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } as const : {}) })
}

/** Shared overlays keep card actions identical in the board, drawer and full conversation. */
export function MissionInteractionProvider({ missions, agents, onChanged, onDeleted, onError, children }: {
  missions: MissionRecord[]; agents: AgentProfile[]; onChanged(campId: string): Promise<void>; onDeleted(campId: string): Promise<void>; onError(message: string): void; children: ReactNode
}) {
  const client = useCampClient()
  const [position, setPosition] = useState<(ContextPosition & { kind: 'menu' | 'tags' | 'members' }) | null>(null)
  const [editing, setEditing] = useState<MissionRecord | null>(null)
  const [deleting, setDeleting] = useState<MissionRecord | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const starts = useRef(new Map<string, string>())
  const catalog = [...new Set(missions.flatMap(m => m.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const selected = missions.find(m => m.missionId === position?.id)
  const anchor = (kind: 'menu' | 'tags' | 'members', m: MissionRecord, event: MouseEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setPosition({ id: m.missionId, kind, x: kind === 'menu' && event.type === 'contextmenu' ? event.clientX : rect.left, y: kind === 'menu' && event.type === 'contextmenu' ? event.clientY : rect.bottom, origin: event.currentTarget })
  }
  async function change(m: MissionRecord, kind: 'status' | 'update', fields: object) {
    await missionCommand(client, kind === 'status' ? 'missions.status' : 'missions.update', { missionId: m.missionId, ...fields })
    await onChanged(m.campId)
  }
  const report = (promise: Promise<unknown>) => { void promise.catch(error => onError(missionError(error))) }
  async function start(m: MissionRecord) {
    if (busyId) return
    const commandId = starts.current.get(m.missionId) ?? newCommandId()
    starts.current.set(m.missionId, commandId); setBusyId(m.missionId)
    try { await missionCommand(client, 'missions.start', { missionId: m.missionId }, commandId); starts.current.delete(m.missionId); await onChanged(m.campId) }
    catch (error) { if (error instanceof MissionCommandRejected) starts.current.delete(m.missionId); throw error }
    finally { setBusyId(null) }
  }
  const actions: MissionActions = {
    edit: setEditing, menu: (m, e) => anchor('menu', m, e), roster: (m, e) => anchor('members', m, e), tags: (m, e) => anchor('tags', m, e),
    status: (m, status) => report(change(m, 'status', { status })), start: m => report(start(m)), busyId
  }
  return <MissionPeopleProvider agents={agents}><Actions.Provider value={actions}>{children}
    <MissionContextMenu key={`${position?.id}:${position?.x}:${position?.y}`} m={selected} position={position?.kind === 'menu' ? position : null} catalog={catalog} onClose={() => setPosition(null)}
      onStatus={status => { if (selected) actions.status(selected, status) }}
      onLead={id => { if (selected) report((async () => {
        const snapshot = await client.request<CampOpenProjection>('camps.open', { campId: selected.campId })
        await missionCommand(client, 'camps.changeDefaultLead', { campId: selected.campId, successorAgentId: id, expectedVersion: snapshot.camp.version })
        await onChanged(selected.campId)
      })()) }}
      onSaveTags={tags => selected ? change(selected, 'update', { tags }) : Promise.resolve()}
      onDelete={() => { if (selected) setDeleting(selected); setPosition(null) }} />
    {position && position.kind !== 'menu' && selected && <MissionPopover position={position} title={position.kind === 'tags' ? '编辑标签' : '使命队员'} onClose={() => setPosition(null)} className={position.kind === 'tags' ? 'mission-label-popover' : 'mission-members-popover'}>
      {position.kind === 'tags' ? <LabelsEditor key={selected.missionId} m={selected} catalog={catalog} onSave={tags => change(selected, 'update', { tags })}/> : <MissionRoster m={selected}/>}
    </MissionPopover>}
    {editing && <MissionEdit key={editing.missionId} mission={editing} onClose={() => setEditing(null)} onSave={patch => change(editing, 'update', patch)}/>}
    {deleting && <MissionDelete key={deleting.missionId} mission={deleting} onClose={() => setDeleting(null)} onDelete={async () => {
      const snapshot = await client.request<CampOpenProjection>('camps.open', { campId: deleting.campId })
      await missionCommand(client, 'camps.delete', { campId: deleting.campId, expectedVersion: snapshot.camp.version, force: true })
      await onDeleted(deleting.campId); setDeleting(null)
    }}/>}
  </Actions.Provider></MissionPeopleProvider>
}

function MissionEdit({ mission, onSave, onClose }: { mission: MissionRecord; onSave(patch: {title?: string; description?: string}): Promise<void>; onClose(): void }) {
  const [title, setTitle] = useState(mission.title), [description, setDescription] = useState(mission.description), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const id = useId()
  async function save() {
    const patch = { ...(title.trim() !== mission.title ? { title: title.trim() } : {}), ...(description !== mission.description ? { description } : {}) }
    if (!Object.keys(patch).length) { onClose(); return }
    setBusy(true); setError('')
    try { await onSave(patch); onClose() } catch (error) { setError(missionError(error)) } finally { setBusy(false) }
  }
  return <CompactDialog title="编辑使命" onClose={() => { if (!busy) onClose() }} footer={<><button className="compact-cancel" disabled={busy} onClick={onClose}>取消</button><button className="compact-primary" form={id} disabled={busy || !title.trim() || [...title.trim()].length > 200 || [...description].length > 12000}>保存</button></>}>
    <form id={id} onSubmit={event => { event.preventDefault(); void save() }} className="mission-definition-fields">
      <input aria-label="使命标题" placeholder="使命标题" value={title} onChange={e => setTitle(e.target.value)} disabled={busy} autoFocus/>
      <textarea aria-label="使命描述" placeholder="描述希望完成的使命…" value={description} onChange={e => setDescription(e.target.value)} disabled={busy} rows={6}/>
      {error && <p role="alert" className="compact-inline-error">{error}</p>}
    </form>
  </CompactDialog>
}
function MissionDelete({ mission, onDelete, onClose }: { mission: MissionRecord; onDelete(): Promise<void>; onClose(): void }) {
  const client = useCampClient(), [delivery, setDelivery] = useState<MissionDelivery | null>(null), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { let current = true; setError(''); void client.request<MissionDelivery>('missions.delivery', { missionId: mission.missionId }).then(data => { if (current) setDelivery(data) }).catch(error => { if (current) setError(missionError(error)) }); return () => { current = false } }, [client, mission.missionId, retry])
  async function remove() { setBusy(true); setError(''); try { await onDelete() } catch (error) { setError(missionError(error)) } finally { setBusy(false) } }
  return <CompactDialog title="删除使命" className="mission-delete-dialog" onClose={() => { if (!busy) onClose() }} footer={<><button className="compact-cancel" onClick={onClose} disabled={busy}>取消</button><button className="compact-primary mission-delete-confirm" onClick={() => void remove()} disabled={busy || !delivery}>{busy ? '正在删除…' : '删除使命'}</button></>}>
    <p className="mission-delete-title">{mission.title}</p><p>使命、会话和交付文件将被删除，正在执行的队员会停止。</p>
    {delivery?.workspace && <div className="mission-delete-workspaces"><p>关联工作区也会删除，Git 分支保留。</p><div><code>{delivery.workspace.worktreePath}</code><small>{delivery.workspace.branch}</small></div></div>}
    {!delivery && !error && <p role="status">正在读取关联工作区…</p>}{error && <p className="compact-inline-error" role="alert">{error}{!delivery && <button className="mission-source-link" onClick={() => setRetry(v => v + 1)}>重试</button>}</p>}
  </CompactDialog>
}

export function MissionBoard({ missions, projects, loading, error, selectedId, hidden, onRefresh, onNew, onOpen }: {
  missions: MissionRecord[]; projects: ProjectNavigationGroup[]; loading: boolean; error: string | null; selectedId?: string; hidden?: boolean; onRefresh(): Promise<void>; onNew(): void; onOpen(m: MissionRecord): void
}) {
  const actions = useMissionActions()
  const [query, setQuery] = useState(''), [stateFilter, setStateFilter] = useState<string[]>([]), [tags, setTags] = useState<string[]>([]), [projectFilter, setProjectFilter] = useState<string[]>([]), [view, setView] = useState<'board' | 'list'>('board')
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const catalog = [...new Set(missions.flatMap(m => m.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const paths = [...new Set(missions.map(m => m.projectPath))]
  const filtered = missions.filter(m => (!stateFilter.length || stateFilter.includes(m.status)) && (!tags.length || tags.some(t => m.tags.includes(t))) && (!projectFilter.length || projectFilter.includes(m.projectPath)) && `${m.title}\n${m.description}\n${m.tags.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function card(m: MissionRecord) {
    const openFromContainer = (event: MouseEvent<HTMLElement>) => {
      if (!(event.target instanceof Element) || event.target.closest('button,a,input') || window.getSelection()?.toString()) return
      event.currentTarget.querySelector<HTMLButtonElement>('.mission-card-open')?.focus({ preventScroll: true }); onOpen(m)
    }
    return <article key={m.missionId} className={`mission-board-card${selectedId === m.missionId ? ' selected' : ''}`} onClick={openFromContainer} onContextMenu={e => actions.menu(m, e)}
      onKeyDown={e => { if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); e.currentTarget.querySelector<HTMLButtonElement>('.mission-card-actions')?.click() } }}>
      <div className="mission-card-meta"><span>{m.missionId.slice(-8)}</span><button className="mission-icon-button mission-card-actions" aria-label={`${m.title}的操作`} onClick={e => actions.menu(m, e)}><Icon name="more"/></button></div>
      <button className="mission-card-open" onClick={() => onOpen(m)}><h3>{m.hasUnread && <span className="mission-unread-dot" aria-label="有未读消息"/>}{m.title}</h3></button>
      <div className="mission-project-tags"><span className="mission-card-project" title={m.projectPath}><NavigationIcon name="folder-open"/>{missionProject(m, projects)}</span><MissionTags tags={m.tags}/></div>
      <div className="mission-card-footer"><MissionAvatars m={m} onClick={e => actions.roster(m, e)}/><time dateTime={m.updatedAt} title={new Date(m.updatedAt).toLocaleString()}>{missionDate(m.updatedAt)}</time></div>
      {m.runningAgentIds.length > 0 && <div className="mission-card-presence"><span className="mission-presence"><span className="camp-loading-spinner"/>{m.runningAgentIds.length} 位队员正在执行</span></div>}
    </article>
  }
  return <section className="mission-board-content mission-board-page" hidden={hidden} aria-label="使命板">
    <header className="mission-page-header"><div><h1>使命板</h1><p>设定目标，与队伍一起推进。</p></div><button className="mission-new mission-new-entry" onClick={onNew}><Icon name="plus"/>新建使命</button></header>
    <div className="mission-toolbar"><div className="mission-filter-group">
      <MissionFilter label="状态" icon={<FilterStateIcon/>} searchable={false} values={stateFilter} onChange={setStateFilter} options={statuses.map(s => ({ id: s.id, label: s.label, icon: <StatusIcon status={s.id}/> }))}/>
      <MissionFilter label="标签" icon={<Icon name="tag"/>} values={tags} onChange={setTags} options={catalog.map(t => ({id: t, label: t, icon: <TagMark tag={t}/>}))}/>
      <MissionFilter label="项目" icon={<NavigationIcon name="folder-open"/>} values={projectFilter} onChange={setProjectFilter} options={paths.map(path => ({ id: path, keywords: path, icon: <NavigationIcon name="folder-open"/>, label: missionProject(missions.find(m => m.projectPath === path)!, projects) }))}/>
      {!!(stateFilter.length + tags.length + projectFilter.length) && <button className="mission-clear-filters" aria-label="清除筛选" onClick={() => { setStateFilter([]); setTags([]); setProjectFilter([]) }}><DialogControlIcon name="close"/></button>}
    </div><label className="mission-search"><NavigationIcon name="search"/><input aria-label="搜索使命" placeholder="搜索使命…" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <Menu.Root><Menu.Trigger asChild><button className="mission-filter mission-view-trigger" aria-label={`切换视图，当前${view === 'board' ? '看板' : '列表'}`}><Icon name={view}/><Icon name="chevron"/></button></Menu.Trigger><Menu.Portal><Menu.Content className="compact-menu" align="end" sideOffset={6}><Menu.RadioGroup value={view} onValueChange={v => setView(v as 'board' | 'list')}>{(['board', 'list'] as const).map(v => <Menu.RadioItem className="compact-option" value={v} key={v}><Icon name={v}/><span>{v === 'board' ? '看板' : '列表'}</span><Menu.ItemIndicator><Icon name="check"/></Menu.ItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup></Menu.Content></Menu.Portal></Menu.Root>
    </div>
    {error && <div className="mission-load-error" role="alert"><span>{error}</span><button onClick={() => void onRefresh()}>重试</button></div>}
    <MissionCleanupNotice/>
    <div className="mission-board-scroll">
      {loading && !missions.length && <p role="status" className="mission-section-empty">正在加载使命…</p>}
      {view === 'board' ? <div className="mission-board" style={{gridTemplateColumns: `repeat(${stateFilter.length || statuses.length}, minmax(0, 1fr))`}}>
        {statuses.filter(s => !stateFilter.length || stateFilter.includes(s.id)).map(s => <section className="mission-column" key={s.id}>
          <header><StatusIcon status={s.id}/><h2>{s.label}</h2><span>{filtered.filter(m => m.status === s.id).length}</span></header>
          <div className="mission-column-cards">{filtered.filter(m => m.status === s.id).map(card)}</div>
        </section>)}
      </div> : <div className="mission-grouped-list">{statuses.filter(s => !stateFilter.length || stateFilter.includes(s.id)).map(s => <section className="mission-list-group" key={s.id}>
        <button className="mission-group-heading" aria-expanded={!collapsedGroups.includes(s.id)} onClick={() => setCollapsedGroups(current => current.includes(s.id) ? current.filter(id => id !== s.id) : [...current, s.id])}>
          <Icon name="chevron"/><StatusIcon status={s.id}/><h2>{s.label}</h2><span>{filtered.filter(m => m.status === s.id).length}</span>
        </button>
        <div className="mission-list-cards" hidden={collapsedGroups.includes(s.id)}>{filtered.filter(m => m.status === s.id).map(card)}</div>
      </section>)}</div>}
    </div>
    {!loading && missions.length > 0 && !filtered.length && <p className="mission-section-empty" role="status">没有符合筛选条件的使命。</p>}
  </section>
}

function MissionCleanupNotice() {
  const client = useCampClient(), [rows, setRows] = useState<MissionWorkspace[]>([]), [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    const load = () => { void client.request<MissionWorkspace[]>('missions.cleanup.list').then(rows => { if (current) { setRows(rows); setError('') } }).catch(error => { if (current) setError(missionError(error)) }) }
    load()
    const poll = setInterval(load, 30_000), unsubscribe = client.onEvent?.(event => { if (event.method === 'navigation.invalidated') load() }), invalidated = client.onInvalidated?.(load)
    return () => { current = false; clearInterval(poll); unsubscribe?.(); invalidated?.() }
  }, [client])
  async function retry(workspace: MissionWorkspace) {
    setBusy(workspace.id); setError('')
    try {
      await client.request('missions.cleanup.retry', { workspaceId: workspace.id })
      setRows(await client.request<MissionWorkspace[]>('missions.cleanup.list'))
    } catch (error) { setError(missionError(error)) } finally { setBusy(null) }
  }
  return <>{(rows.length > 0 || error) && <div className="mission-cleanup-notice"><button onClick={() => setOpen(true)}>{error ? '工作区清理状态暂不可用' : `${rows.length} 个工作区待清理`}</button></div>}
    {open && <CompactDialog title="工作区清理" className="mission-cleanup-list" onClose={() => setOpen(false)}>{error && <p role="alert">{error}</p>}{rows.map(row => <section key={row.id}><div><code>{row.worktreePath}</code><small>分支保留：{row.branch}</small></div>{row.diagnostic && <p role="alert">{row.diagnostic}</p>}<button className="compact-cancel" onClick={() => void retry(row)} disabled={busy !== null}>{busy === row.id ? '正在清理…' : '重新清理'}</button></section>)}{!rows.length && !error && <p role="status">工作区已清理完成。</p>}</CompactDialog>}
  </>
}

export function MissionIntro({ mission: m, projects }: { mission: MissionRecord; projects: ProjectNavigationGroup[] }) {
  const actions = useMissionActions(), [expanded, setExpanded] = useState(false), [canExpand, setCanExpand] = useState(false)
  const description = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const node = description.current
    if (!node) return
    const measure = () => {
      // Compare the natural content height against the three-line reading limit.
      const lineHeight = parseFloat(getComputedStyle(node).lineHeight)
      setCanExpand(node.scrollHeight > lineHeight * 3 + 1)
    }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(node)
    return () => observer.disconnect()
  }, [m.description])
  return <>
    <section className="mission-intro" aria-label="会话使命">
      <div className="mission-intro-top"><span><MissionIcon/>使命</span><span className="mission-status-readonly"><StatusIcon status={m.status}/>{statuses.find(s => s.id === m.status)?.label}</span></div>
      <h2>{m.title}</h2>{m.description && <p ref={description} className={`mission-description${expanded ? ' expanded' : ''}`}>{m.description}</p>}
      {canExpand && <button className="mission-description-toggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '收起描述' : '展开描述'}<Icon name="chevron"/></button>}
      <div className="mission-project-tags"><span className="mission-card-project" title={m.projectPath}><NavigationIcon name="folder-open"/>{missionProject(m, projects)}</span><MissionTags tags={m.tags}/></div>
      <div className="mission-intro-meta"><MissionAvatars m={m}/></div>
    </section>
    {m.status === 'not_started' && !m.runningAgentIds.length && <div className="mission-start-row"><button className="mission-new mission-start" disabled={actions.busyId === m.missionId} onClick={() => actions.start(m)}><Icon name="play"/>{actions.busyId === m.missionId ? '正在开始…' : '开始使命'}</button></div>}
  </>
}
