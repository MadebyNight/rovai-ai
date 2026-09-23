import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterKind, AgentProfile, NativeSkillScan, NativeSkillView, StoredCommandResult, ToolboxSkillView } from '@contracts'
import { useCampClient } from './camp-client'
import { MemberAvatar } from './MemberAvatar'
import { RuntimeGlyph } from './MemberRuntimePicker'
import { SkillIdentityMark } from './SkillIdentityMark'
import { SafeMarkdown } from './SafeMarkdown'
import { skillReadingContent } from './SkillContentPreview'
import { adapterLabel, VISIBLE_PRODUCT_RUNTIMES } from './runtime-products'
import { readErrorMessage } from './error-message'
import './rebuilt-skills-settings.css'

export function NativeSkillsSettings(): React.JSX.Element {
  const client = useCampClient()
  const [runtime, setRuntime] = useState<AdapterKind>('codex-cli')
  const [scan, setScan] = useState<NativeSkillScan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)
  const [contentRevision, setContentRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [detailVisible, setDetailVisible] = useState(false)
  const listRequest = useRef(0)
  const load = useCallback(async (refresh: boolean): Promise<void> => {
    const request = ++listRequest.current
    setLoading(true)
    setError(null)
    try {
      const next = await client.request<NativeSkillScan>('nativeSkills.list', { adapterKind: runtime, refresh })
      if (request !== listRequest.current) return
      setScan(next)
      setSelectedId((current) => next.skills.some((skill) => skill.id === current) ? current : next.skills[0]?.id ?? null)
      setContentRevision((revision) => revision + 1)
    } catch (reason) {
      if (request === listRequest.current) setError(readErrorMessage(reason))
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }, [client, runtime])
  useEffect(() => {
    setScan(null)
    setSelectedId(null)
    void load(false)
    return () => { listRequest.current += 1 }
  }, [load])
  const selected = scan?.skills.find((skill) => skill.id === selectedId) ?? null
  useEffect(() => {
    if (!selected) { setContent(null); setContentError(null); return }
    let cancelled = false
    setContent(null)
    setContentError(null)
    void client.request<{ content: string }>('nativeSkills.read', { skillId: selected.id })
      .then((value) => { if (!cancelled) setContent(value.content) })
      .catch((reason) => { if (!cancelled) setContentError(readErrorMessage(reason)) })
    return () => { cancelled = true }
  }, [client, runtime, selected?.id, contentRevision])
  const visible = useMemo(() => (scan?.skills ?? []).filter((skill) =>
    `${skill.name} ${skill.description} ${skill.entryPath}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ), [scan, query])
  const copyPath = async (skill: NativeSkillView): Promise<void> => {
    try { await navigator.clipboard.writeText(skill.entryPath) }
    catch (reason) { setContentError(readErrorMessage(reason)) }
  }
  return <div className="rebuilt-skills-page">
    <header className="rebuilt-skills-header">
      <div><h1>Skills</h1><p>查看各运行时的 Skills。</p></div>
      <Menu.Root>
        <Menu.Trigger asChild><button className="member-runtime-picker rebuilt-runtime-trigger" type="button" aria-label={`选择运行时，当前为 ${adapterLabel(runtime)}`}><RuntimeGlyph kind={runtime} />{adapterLabel(runtime)}<span aria-hidden="true">⌄</span></button></Menu.Trigger>
        <Menu.Portal><Menu.Content className="runtime-model-picker-menu member-runtime-menu" align="end" sideOffset={5} loop>
          <Menu.RadioGroup value={runtime} onValueChange={(value) => setRuntime(value as AdapterKind)}>
            <div className="runtime-picker-scroll">{VISIBLE_PRODUCT_RUNTIMES.map((kind) => <Menu.RadioItem key={kind} value={kind} textValue={adapterLabel(kind)} className="runtime-model-picker-item member-runtime-menu-item"><RuntimeGlyph kind={kind} /><span className="runtime-model-picker-copy"><strong>{adapterLabel(kind)}</strong></span><Menu.ItemIndicator className="runtime-model-picker-check">✓</Menu.ItemIndicator></Menu.RadioItem>)}</div>
          </Menu.RadioGroup>
        </Menu.Content></Menu.Portal>
      </Menu.Root>
    </header>
    <div className="rebuilt-skills-columns">
      <aside className={`rebuilt-skills-list ${detailVisible ? 'is-detail-visible' : ''}`}>
        <div className="rebuilt-skills-toolbar"><strong>当前来源</strong><span>{scan?.skills.length ?? '—'} 项</span><button type="button" onClick={() => void load(true)} disabled={loading}>刷新</button></div>
        <label className="rebuilt-skills-search"><span className="sr-only">搜索 Skills</span><input type="search" placeholder="搜索 Skill" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {error && <div className="rebuilt-skills-error" role="alert">执行端暂不可读：{error}<button type="button" onClick={() => void load(true)}>重试</button></div>}
        {scan?.errors.length ? <div className="rebuilt-skills-error" role="status">部分来源暂不可读。已发现的 Skill 仍可查看。<button type="button" onClick={() => void load(true)}>重试</button></div> : null}
        {loading && !scan && <p className="rebuilt-skills-empty">正在读取 Skills…</p>}
        {!loading && scan && scan.skills.length === 0 && <p className="rebuilt-skills-empty">这个运行时尚未发现 Skills。</p>}
        {scan && visible.length === 0 && scan.skills.length > 0 && <p className="rebuilt-skills-empty">没有匹配的 Skill。</p>}
        <div className="rebuilt-skills-list-scroll">{visible.map((skill) => <button type="button" key={skill.id} className={`rebuilt-skill-row ${selectedId === skill.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(skill.id); setDetailVisible(true) }}><SkillIdentityMark skillId={skill.id} name={skill.name} /><span><strong>{skill.name}</strong><small>{skill.description}</small></span></button>)}</div>
      </aside>
      <section className={`rebuilt-skills-detail ${detailVisible ? 'is-detail-visible' : ''}`} aria-label="Skill 预览">
        <button type="button" className="rebuilt-skills-back" onClick={() => setDetailVisible(false)}>返回列表</button>
        {selected ? <><header><h2>{selected.name}</h2><p>{selected.description}</p></header><div className="rebuilt-skill-source"><span title={selected.entryPath}>{selected.entryPath}</span><button type="button" onClick={() => void copyPath(selected)}>复制路径</button></div><div className="rebuilt-skill-file-label">SKILL.md</div>{contentError ? <div className="rebuilt-skills-error" role="alert">正文暂不可读：{contentError}<button type="button" onClick={() => setContentRevision((revision) => revision + 1)}>重试</button></div> : content === null ? <p className="rebuilt-skills-empty">正在读取正文…</p> : <div className="rebuilt-skills-content"><SafeMarkdown className="capability-reading" mode="document">{skillReadingContent(content)}</SafeMarkdown></div>}</> : <p className="rebuilt-skills-empty">选择一项 Skill 查看正文。</p>}
      </section>
    </div>
  </div>
}

export function ToolboxSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const client = useCampClient()
  const [skills, setSkills] = useState<ToolboxSkillView[] | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [memberQuery, setMemberQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedSave, setFailedSave] = useState<{ skillName: string; memberIds: string[]; expectedVersion: string; commandId: string } | null>(null)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [detailVisible, setDetailVisible] = useState(false)
  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await client.request<ToolboxSkillView[]>('toolbox.list')
      setSkills(next)
      setSelectedName((name) => next.some((skill) => skill.name === name) ? name : next[0]?.name ?? null)
      setLoadingError(null)
    } catch (reason) { setLoadingError(readErrorMessage(reason)) }
  }, [client])
  useEffect(() => { void load() }, [load])
  const selected = skills?.find((skill) => skill.name === selectedName) ?? null
  const members = agents.filter((agent) => agent.presence !== 'removed')
  const visibleMembers = members.filter((agent) => `${agent.displayName} ${agent.teamRole}`.toLocaleLowerCase().includes(memberQuery.toLocaleLowerCase()))
  const visibleSkills = (skills ?? []).filter((skill) => `${skill.name} ${skill.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const save = async (memberIds: string[], skillName = selected?.name, retry?: typeof failedSave): Promise<void> => {
    if (!skillName || busy) return
    const name = skillName
    const before = skills
    const expectedVersion = retry?.expectedVersion ?? before?.find((skill) => skill.name === name)?.version
    if (!expectedVersion) return
    const commandId = retry?.commandId ?? crypto.randomUUID()
    setError(null)
    setFailedSave(null)
    setBusy(true)
    setSkills((current) => current?.map((skill) => skill.name === name ? { ...skill, memberIds } : skill) ?? null)
    try {
      const result = await client.request<StoredCommandResult>('toolbox.setMembers', {
        commandId,
        command: { skillName: name, memberIds, expectedVersion }
      })
      if (result.status !== 'applied') {
        setSkills(before)
        setError(result.code === 'toolbox.members.conflict'
          ? '配置已在其他位置更新，请按新状态重试。'
          : '队员配置已变化，请重新选择。')
        await load()
      } else {
        const version = result.payload.version
        if (typeof version === 'string') {
          setSkills((current) => current?.map((skill) => skill.name === name ? { ...skill, memberIds, version } : skill) ?? null)
        }
      }
    } catch (reason) {
      setSkills(before)
      setError(readErrorMessage(reason))
      setFailedSave({ skillName: name, memberIds, expectedVersion, commandId })
    }
    finally { setBusy(false) }
  }
  const selectedMembers = new Set(selected?.memberIds ?? [])
  const bulk = (enabled: boolean): void => {
    const next = new Set(selectedMembers)
    for (const member of visibleMembers) enabled ? next.add(member.agentId) : next.delete(member.agentId)
    void save([...next])
  }
  return <div className="rebuilt-skills-page">
    <header className="rebuilt-skills-header"><div><h1>工具箱</h1><p>为队员配置多人协作常用的 Skills 与工具。</p></div></header>
    <div className="rebuilt-skills-columns">
      <aside className={`rebuilt-skills-list ${detailVisible ? 'is-detail-visible' : ''}`}><div className="rebuilt-skills-toolbar"><strong>协作 Skills</strong><span>{skills?.length ?? '—'} 项</span></div><label className="rebuilt-skills-search"><span className="sr-only">搜索协作 Skills</span><input type="search" placeholder="搜索 Skill" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {loadingError && <div className="rebuilt-skills-error" role="alert">工具箱暂不可读：{loadingError}<button type="button" onClick={() => void load()}>重试</button></div>}
        {!skills && !loadingError && <p className="rebuilt-skills-empty" role="status">正在读取工具箱…</p>}
        {skills && visibleSkills.length === 0 && <p className="rebuilt-skills-empty">没有匹配的 Skill。</p>}
        <div className="rebuilt-skills-list-scroll">{visibleSkills.map((skill) => <button type="button" key={skill.name} className={`rebuilt-skill-row ${selectedName === skill.name ? 'is-selected' : ''}`} onClick={() => { setSelectedName(skill.name); setError(null); setFailedSave(null); setDetailVisible(true) }}><SkillIdentityMark skillId={skill.name} name={skill.name} /><span><strong>{skill.name}</strong><small>{skill.description ?? '说明暂不可读'}</small></span><em>{skill.memberIds.length ? `已选 ${skill.memberIds.length} 人` : '未分配'}</em></button>)}</div>
      </aside>
      <section className={`rebuilt-skills-detail ${detailVisible ? 'is-detail-visible' : ''}`} aria-label="工具箱队员配置"><button type="button" className="rebuilt-skills-back" onClick={() => setDetailVisible(false)}>返回列表</button>{selected ? <><header className="rebuilt-toolbox-heading"><div><h2>{selected.name}</h2><p>{selected.description ?? '说明暂不可读'}</p></div><button type="button" onClick={() => setDescriptionOpen(true)}>查看说明</button></header><div className="rebuilt-skills-toolbar"><strong>提供给队员</strong><span>已选 {selected.memberIds.length} 人</span><button type="button" disabled={busy || !visibleMembers.length} onClick={() => bulk(true)}>全选{memberQuery ? '当前结果' : ''}</button><button type="button" disabled={busy || !visibleMembers.length} onClick={() => bulk(false)}>取消全选{memberQuery ? '当前结果' : ''}</button></div><label className="rebuilt-skills-search"><span className="sr-only">搜索队员</span><input type="search" placeholder="搜索队员姓名或角色" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} /></label>{busy && <p role="status" className="rebuilt-skills-status">正在保存…</p>}{error && <div className="rebuilt-skills-error" role="alert">保存失败：{error}{failedSave && <button type="button" disabled={busy} onClick={() => void save(failedSave.memberIds, failedSave.skillName, failedSave)}>重试</button>}</div>}{!members.length && <p className="rebuilt-skills-empty">暂无队员。</p>}{members.length > 0 && visibleMembers.length === 0 && <p className="rebuilt-skills-empty">没有匹配的队员。</p>}<div className="rebuilt-toolbox-members">{visibleMembers.map((agent) => <label key={agent.agentId} className="rebuilt-toolbox-member"><MemberAvatar agentId={agent.agentId} displayName={agent.displayName} avatarRef={agent.avatarRef} /><span><strong>{agent.displayName}</strong><small>{agent.teamRole}</small></span><input type="checkbox" checked={selectedMembers.has(agent.agentId)} disabled={busy} onChange={(event) => { const next = new Set(selectedMembers); event.target.checked ? next.add(agent.agentId) : next.delete(agent.agentId); void save([...next]) }} /></label>)}</div><p className="rebuilt-toolbox-note">选择后，Rovai 会在队员后续运行时提供这份指南。未选择的队员仍可正常参与协作。</p><Dialog.Root open={descriptionOpen} onOpenChange={setDescriptionOpen}><Dialog.Portal><Dialog.Overlay className="app-dialog-overlay" /><Dialog.Content className="app-dialog rebuilt-description-dialog"><Dialog.Title>{selected.name}</Dialog.Title><Dialog.Description>{selected.description ?? '说明暂不可读'}</Dialog.Description><Dialog.Close asChild><button type="button" className="quiet-button">关闭</button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></> : <p className="rebuilt-skills-empty">{loadingError ? '工具箱暂不可读，请从列表区重试。' : skills ? '选择一项 Skill 配置队员。' : '正在读取工具箱…'}</p>}</section>
    </div>
  </div>
}
