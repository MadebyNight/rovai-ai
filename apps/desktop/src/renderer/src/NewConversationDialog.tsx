import { useCampClient } from './camp-client'
import { readErrorMessage } from './error-message'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AgentProfile,
  CampCreationPreflight,
  CreateCampRequest,
  NewConversationDefaults,
  MissionCreate,
  ProjectNavigationGroup,
  WorkspaceInspection,
  WorkspaceSelection
} from '@contracts'
import { isNewConversationMemberAvailable, newConversationMemberStatus } from './new-conversation-availability'
import { useMobileLayout } from './MobileLayout'
import { NewConversationPicker } from './NewConversationPicker'
import { NewConversationQuickHelp } from './NewConversationQuickHelp'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon } from './NavigationIcon'
import { DialogControlIcon } from './AppDialog'

type CreateCampDraft = Omit<CreateCampRequest, 'commandId' | 'activationState'>
type WorkspaceChoice = WorkspaceSelection | WorkspaceInspection
type GitInspectionStatus = 'idle' | 'loading' | 'ready' | 'failed'

export function NewConversationDialog({
  open,
  purpose = 'camp',
  recovery = null,
  initialWorkspace,
  initialSelection,
  attentionMessage,
  projects,
  preflight,
  agents,
  busy: creationBusy,
  projectAccessReady,
  onOpenChange,
  onChooseWorkspaceDirectory,
  onWorkspaceSelected,
  onCreate
}: {
  open: boolean
  purpose?: 'camp' | 'mission'
  recovery?: MissionCreate | null
  initialWorkspace: WorkspaceSelection | null
  initialSelection?: NewConversationDefaults | null
  attentionMessage?: string | null
  projects: ProjectNavigationGroup[]
  preflight: CampCreationPreflight
  agents: AgentProfile[]
  busy: boolean
  projectAccessReady: boolean
  onOpenChange(open: boolean): void
  onChooseWorkspaceDirectory(): Promise<WorkspaceSelection | null>
  onWorkspaceSelected(workspace: WorkspaceSelection): Promise<void>
  onCreate(draft: CreateCampDraft, enableOneClick: boolean, mission?: {description:string; start:boolean}): Promise<void>
}): React.JSX.Element {
  const client = useCampClient()
  const mobile = useMobileLayout()
  const [submitting, setSubmitting] = useState(false)
  const busy = creationBusy || submitting
  const [workspace, setWorkspace] = useState<WorkspaceChoice | null>(initialWorkspace)
  const [gitInspectionStatus, setGitInspectionStatus] = useState<GitInspectionStatus>('idle')
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [memberMenuOpen, setMemberMenuOpen] = useState(false)
  const [leadMenuOpen, setLeadMenuOpen] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [leadId, setLeadId] = useState('')
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const isMission = purpose === 'mission'
  const startSubmitRef = useRef<HTMLButtonElement>(null)
  const [quickHelpOpen, setQuickHelpOpen] = useState(false)
  const [enableOneClick, setEnableOneClick] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const memberTriggerRef = useRef<HTMLButtonElement>(null)
  const projectTriggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const draftInitializedRef = useRef(false)
  const profileById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent])),
    [agents]
  )
  const preferredInitialSelection = initialSelection ?? null
  const initialSelectionPlan = useMemo(
    () => planInitialCampSelection(preflight, preferredInitialSelection),
    [preferredInitialSelection, preflight.presentMembers]
  )
  const availableMembers = preflight.presentMembers.filter(isNewConversationMemberAvailable)
  const selectedMembers = preflight.presentMembers.filter((member) =>
    selectedMemberIds.includes(member.agentId)
  )
  const selectedAvailableMembers = selectedMembers.filter(isNewConversationMemberAvailable)
  const hasUnavailableSelection = selectedMemberIds.some((id) =>
    !availableMembers.some((member) => member.agentId === id)
  )
  const normalizedName = isMission ? name.trim() : normalizeDraftName(name)
  const nameLength = Array.from(normalizedName).length
  const nameError = nameLength > (isMission ? 200 : 80) ? `${isMission ? '使命标题最多 200' : '对话名称最多 80'} 个字符。` : isMission && Array.from(description).length > 12000 ? '使命描述最多 12,000 个字符。' : null
  const lead = selectedAvailableMembers.find((member) => member.agentId === leadId) ?? null
  const leadProfile = lead ? profileById.get(lead.agentId) : undefined
  const projectActionsDisabled = projectWorkspaceActionsDisabled(busy, projectAccessReady)
  const projectSubmissionBlocked = workspaceSubmissionBlocked(workspace, projectAccessReady)
  const submissionBlocked = busy || projectSubmissionBlocked || availableMembers.length === 0
    || hasUnavailableSelection || (selectedMemberIds.length > 0 && !lead) || Boolean(nameError)

  useEffect(() => {
    if (!open) {
      if (recovery) return
      draftInitializedRef.current = false
      return
    }
    if (draftInitializedRef.current) return
    draftInitializedRef.current = true
    const { memberIds, leadId: recommendedLead } = initialSelectionPlan
    setWorkspace(initialWorkspace)
    setGitInspectionStatus(hasGitObservation(initialWorkspace) ? 'ready' : 'idle')
    setProjectMenuOpen(false)
    setMemberMenuOpen(false)
    setLeadMenuOpen(false)
    setSelectedMemberIds(memberIds)
    setLeadId(recommendedLead)
    setOptionalOpen(false)
    setName('')
    setDescription('')
    setEnableOneClick(false)
    setQuickHelpOpen(false)
    setMemberError(null)
    setSubmitError(null)
  }, [initialSelectionPlan, initialWorkspace, open, recovery])

  const pendingGitInspectionPath = workspace && !hasGitObservation(workspace)
    ? workspace.projectPath
    : null

  useEffect(() => {
    if (!workspaceInspectionShouldStart(open, projectAccessReady, pendingGitInspectionPath)) return
    let cancelled = false
    setGitInspectionStatus('loading')
    void client.request<WorkspaceInspection>('workspaces.inspect', {
      path: pendingGitInspectionPath
    }).then((inspection) => {
      if (cancelled || inspection.projectPath !== pendingGitInspectionPath) return
      setWorkspace(inspection)
      setGitInspectionStatus('ready')
    }).catch(() => {
      if (cancelled) return
      setGitInspectionStatus('failed')
    })
    return () => { cancelled = true }
  }, [client, open, pendingGitInspectionPath, projectAccessReady])

  useEffect(() => {
    if (open && optionalOpen) nameInputRef.current?.focus()
  }, [open, optionalOpen])

  const toggleMember = (agentId: string): void => {
    if (busy || !availableMembers.some((member) => member.agentId === agentId)) return
    setMemberError(null)
    const next = toggleCampMemberSelection({
      memberIds: selectedMemberIds,
      leadId,
      toggledMemberId: agentId,
      stableMemberOrder: preflight.presentMembers.map((member) => member.agentId)
    })
    setSelectedMemberIds(next.memberIds)
    setLeadId(next.leadId)
  }

  const allMembersSelected = availableMembers.length > 0 && !hasUnavailableSelection
    && selectedMemberIds.length === availableMembers.length
  const toggleAllMembers = (): void => {
    if (busy || availableMembers.length === 0) return
    setSelectedMemberIds(allMembersSelected ? [] : availableMembers.map(member => member.agentId))
    setLeadId(allMembersSelected ? '' : lead?.agentId ?? availableMembers[0].agentId)
    setMemberError(null)
  }

  const chooseWorkspaceDirectory = async (): Promise<void> => {
    if (projectActionsDisabled) return
    setSubmitError(null)
    try {
      const selected = await onChooseWorkspaceDirectory()
      if (selected) {
        await onWorkspaceSelected(selected)
        setWorkspace(selected)
        setGitInspectionStatus('idle')
        setProjectMenuOpen(false)
      }
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  const selectKnownWorkspace = (project: ProjectNavigationGroup): void => {
    if (projectActionsDisabled) return
    setSubmitError(null)
    setWorkspace({ name: project.name, projectPath: project.projectPath })
    setGitInspectionStatus('idle')
    setProjectMenuOpen(false)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (
      submissionBlocked || submittingRef.current
    ) return
    if (isMission && !normalizedName) { setSubmitError('请填写使命标题。'); nameInputRef.current?.focus(); return }
    if (selectedMemberIds.length === 0) {
      setMemberError('请至少选择一位队员。')
      memberTriggerRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate({
        name: normalizedName || null,
        workspace: workspace ? { projectPath: workspace.projectPath } : null,
        memberAgentIds: selectedMemberIds,
        defaultLeadAgentId: leadId,
        collaborationMode: 'peer'
      }, enableOneClick, isMission ? {description, start:(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'start'} : undefined)
    } catch (error) {
      setSubmitError(errorMessage(error))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const projectLabel = projectAccessReady
    ? projects.find((project) => project.projectPath === workspace?.projectPath)?.name
      ?? workspace?.name ?? '使用快速对话'
    : '正在载入项目…'
  const projectDetail = projectAccessReady
    ? workspace?.projectPath ?? 'Rovai AI 管理的快速对话目录'
    : '正在确认本机项目访问状态'
  const gitPresentation = workspaceGitPresentation(workspace, gitInspectionStatus)

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!busy) onOpenChange(nextOpen) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay new-camp-dialog-overlay" />
        <Dialog.Content
          className={`new-camp-dialog compact-dialog ${isMission ? 'mission-create-dialog' : ''}`}
          aria-describedby="new-camp-dialog-description"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const target = isMission ? nameInputRef.current : projectAccessReady ? projectTriggerRef.current : closeButtonRef.current
            target?.focus()
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => { if (busy || quickHelpOpen) event.preventDefault() }}
          onPointerDownOutside={(event) => {
            if (event.target instanceof Element && event.target.closest('.new-camp-quick-tooltip')) event.preventDefault()
          }}
        >
          <header className="compact-header">
            <Dialog.Title>{isMission ? '新使命' : '新对话'}</Dialog.Title>
            <Dialog.Close asChild><button ref={closeButtonRef} className="compact-close" type="button" aria-label={isMission ? '关闭新使命' : '关闭新对话'} disabled={busy}><DialogControlIcon name="close" /></button></Dialog.Close>
          </header>
          <Dialog.Description id="new-camp-dialog-description" className="sr-only">{isMission ? '填写使命目标，选择工作目录与队伍。' : '选择工作目录、队员与负责人。对话名称可选。'}</Dialog.Description>
          <form className="compact-form" onSubmit={(event) => void submit(event)}>
            <div className="compact-body camp-fields">
              {attentionMessage && <p className="compact-inline-note" role="status">{attentionMessage}</p>}
              {recovery && !busy && <p className="compact-inline-note" role="status">上次创建结果尚未确认。<button type="button" className="mission-source-link" onClick={() => { setName(recovery.title); setDescription(recovery.description); setWorkspace(recovery.projectBindingKind === 'directory' ? {name:projects.find(p=>p.projectPath===recovery.projectPath)?.name ?? recovery.projectPath,projectPath:recovery.projectPath} : null); setSelectedMemberIds(recovery.memberAgentIds); setLeadId(recovery.defaultLeadAgentId); setSubmitError(null) }}>恢复上次内容以重试</button></p>}
              {isMission && <><input ref={nameInputRef} className="automation-name-input" aria-label="使命标题" placeholder="使命标题" value={name} disabled={busy} onChange={event=>setName(event.target.value)} aria-invalid={!!nameError} autoComplete="off"/><textarea className="automation-prompt-input" aria-label="使命描述" placeholder="告诉队员，这次要完成什么…" rows={3} value={description} disabled={busy} onChange={event=>setDescription(event.target.value)}/>{nameError && <p className="compact-inline-error" role="alert">{nameError}</p>}</>}
              <div className="compact-row">
                <span id="new-camp-workspace-label">工作目录</span>
                <NewConversationPicker mobile={mobile} open={projectMenuOpen} onOpenChange={setProjectMenuOpen} busy={busy} title="选择工作目录"
                  trigger={<button ref={projectTriggerRef} className="compact-picker new-camp-picker-trigger" type="button" aria-labelledby="new-camp-workspace-label new-camp-workspace-value" aria-busy={!projectAccessReady} disabled={projectActionsDisabled}>
                      <WorkspaceIcon kind={workspace ? 'project' : 'quick-chat'} /><span id="new-camp-workspace-value">{projectLabel}</span><DialogControlIcon name="chevron" />
                    </button>}
                  menu={<DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()} className="compact-menu workspace-menu" align="end" sideOffset={6} collisionPadding={12} aria-label="选择工作目录" loop>
                      <DropdownMenu.RadioGroup value={workspace?.projectPath ?? ''}>
                        <DropdownMenu.RadioItem className="compact-option" value="" disabled={projectActionsDisabled} onSelect={() => { setWorkspace(null); setProjectMenuOpen(false) }}>
                          <WorkspaceIcon kind="quick-chat" /><span>使用快速对话<small>由 Rovai AI 管理工作目录</small></span><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>
                        <DropdownMenu.Separator className="compact-separator" />
                        {projects.map((project) => <DropdownMenu.RadioItem key={project.projectKey} className="compact-option" value={project.projectPath} disabled={projectActionsDisabled} onSelect={() => selectKnownWorkspace(project)}>
                          <WorkspaceIcon kind="project" /><span>{project.name}<small>{project.projectPath}</small></span><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>)}
                      </DropdownMenu.RadioGroup>
                      <DropdownMenu.Separator className="compact-separator" />
                      <DropdownMenu.Item className="compact-option" disabled={projectActionsDisabled} onSelect={() => void chooseWorkspaceDirectory()}><DialogControlIcon name="plus" /><span>选择工作目录…</span></DropdownMenu.Item>
                    </DropdownMenu.Content>}>
                  <button type="button" className="compact-option" aria-pressed={!workspace} disabled={projectActionsDisabled} onClick={() => { setWorkspace(null); setProjectMenuOpen(false) }}>
                    <WorkspaceIcon kind="quick-chat" /><span>使用快速对话<small>由 Rovai AI 管理工作目录</small></span>{!workspace && <DialogControlIcon name="check" />}
                  </button>
                  {projects.map(project => <button type="button" className="compact-option" key={project.projectKey} aria-pressed={workspace?.projectPath === project.projectPath} disabled={projectActionsDisabled} onClick={() => selectKnownWorkspace(project)}>
                    <WorkspaceIcon kind="project" /><span>{project.name}<small>{project.projectPath}</small></span>{workspace?.projectPath === project.projectPath && <DialogControlIcon name="check" />}
                  </button>)}
                  <button type="button" className="compact-option" disabled={projectActionsDisabled} onClick={() => { setProjectMenuOpen(false); void chooseWorkspaceDirectory() }}><DialogControlIcon name="plus" /><span>选择工作目录…</span></button>
                </NewConversationPicker>
              </div>
              {workspace && <div className="compact-row-detail"><span title={projectDetail}>{projectDetail}</span>{gitPresentation.kind === 'metadata' && <span className="compact-git">{gitPresentation.label}</span>}{gitPresentation.kind === 'loading' && <span role="status">{gitPresentation.label}</span>}</div>}
              {gitPresentation.kind === 'warning' && <div className="new-camp-workspace-warning" role="alert"><div><strong>{gitPresentation.label}</strong><span>{gitPresentation.detail}</span></div></div>}
              <div className="compact-row">
                <span id="new-camp-members-label">队员</span>
                <NewConversationPicker mobile={mobile} open={memberMenuOpen} onOpenChange={setMemberMenuOpen} busy={busy} title="选择队员" multiple
                  trigger={<button ref={memberTriggerRef} className="compact-picker member-trigger" aria-invalid={Boolean(memberError)} aria-describedby={memberError ? 'new-camp-members-error' : undefined} type="button" aria-labelledby="new-camp-members-label new-camp-members-value" disabled={busy || !preflight.presentMembers.length}>
                      <span className="compact-avatar-stack">{selectedMembers.slice(0, 3).map((member) => <MemberAvatar key={member.agentId} agentId={member.agentId} avatarRef={profileById.get(member.agentId)?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />)}</span>
                      <span id="new-camp-members-value">{selectedMembers.length ? `${selectedMembers.length} 位队员` : availableMembers.length ? '选择队员' : '暂无可用队员'}</span><DialogControlIcon name="chevron" />
                    </button>}
                  menu={<DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()} className="compact-menu roster-menu new-camp-member-grid" align="end" sideOffset={6} collisionPadding={12} aria-label="选择队员" onKeyDownCapture={navigateMemberGrid} loop>
                      <div className="compact-menu-heading"><span>参与本次对话</span><DropdownMenu.Item asChild disabled={busy || availableMembers.length === 0} onSelect={event => { event.preventDefault(); toggleAllMembers() }}><button type="button" disabled={busy || availableMembers.length === 0}>{allMembersSelected ? '取消全选' : '全选'}</button></DropdownMenu.Item></div>
                      {preflight.presentMembers.map((member) => {
                        const profile = profileById.get(member.agentId)
                        return <DropdownMenu.CheckboxItem className="compact-option" key={member.agentId} checked={selectedMemberIds.includes(member.agentId)} disabled={busy || !isNewConversationMemberAvailable(member)} onCheckedChange={() => toggleMember(member.agentId)} onSelect={(event) => event.preventDefault()}>
                          <MemberAvatar agentId={member.agentId} avatarRef={profile?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                          <span className="new-camp-candidate-copy">{member.displayName}<small><span>{profile?.teamRole || '队员'}</span><span aria-hidden="true">·</span><span className={isNewConversationMemberAvailable(member) ? 'compact-ready' : 'new-camp-candidate-unavailable'}>{newConversationMemberStatus(member)}</span></small></span>
                          <span className="compact-checkbox"><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator></span>
                        </DropdownMenu.CheckboxItem>
                      })}
                    </DropdownMenu.Content>}>
                  <div className="compact-menu-heading"><span role="status">已选 {selectedMembers.length} 位</span><button type="button" disabled={busy || availableMembers.length === 0} onClick={toggleAllMembers}>{allMembersSelected ? '取消全选' : '全选'}</button></div>
                  {preflight.presentMembers.map(member => {
                    const profile = profileById.get(member.agentId)
                    const disabled = busy || !isNewConversationMemberAvailable(member)
                    return <label className="compact-option new-camp-mobile-member" key={member.agentId} data-disabled={disabled ? '' : undefined}>
                      <MemberAvatar agentId={member.agentId} avatarRef={profile?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                      <span className="new-camp-candidate-copy">{member.displayName}<small>{profile?.teamRole || '队员'} · <span className={isNewConversationMemberAvailable(member) ? 'compact-ready' : 'new-camp-candidate-unavailable'}>{newConversationMemberStatus(member)}</span></small></span>
                      <input type="checkbox" aria-label={member.displayName} checked={selectedMemberIds.includes(member.agentId)} disabled={disabled} onChange={() => toggleMember(member.agentId)} />
                    </label>
                  })}
                </NewConversationPicker>
              </div>
              {memberError && <p id="new-camp-members-error" role="alert" className="compact-inline-error new-camp-members-error">{memberError}</p>}
              {availableMembers.length === 0 && <p className="new-camp-empty-note">暂无可用队员，请先在「队员」中配置 Agent 运行时。</p>}
              {hasUnavailableSelection && <p className="compact-inline-error" role="alert">所选队员已不可用，请重新选择。</p>}
              <div className="compact-row">
                <span id="new-camp-lead-label">负责人</span>
                <NewConversationPicker mobile={mobile} open={leadMenuOpen} onOpenChange={setLeadMenuOpen} busy={busy} title="选择负责人"
                  trigger={<button className="compact-picker" type="button" aria-labelledby="new-camp-lead-label new-camp-lead-value" disabled={busy || selectedAvailableMembers.length === 0}>
                      {lead && <MemberAvatar agentId={lead.agentId} avatarRef={leadProfile?.avatarRef ?? null} displayName={lead.displayName} size="mention" decorative />}
                      <span id="new-camp-lead-value">{lead?.displayName ?? (selectedAvailableMembers.length ? '选择负责人' : '暂无可选负责人')}</span><DialogControlIcon name="chevron" />
                    </button>}
                  menu={<DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()} className="compact-menu roster-menu" align="end" sideOffset={6} collisionPadding={12} aria-label="选择负责人" loop>
                      <DropdownMenu.Label className="compact-menu-heading">从已选队员中选择</DropdownMenu.Label>
                      <DropdownMenu.RadioGroup value={leadId} onValueChange={setLeadId}>
                        {selectedAvailableMembers.map((member) => {
                          const profile = profileById.get(member.agentId)
                          return <DropdownMenu.RadioItem className="compact-option" value={member.agentId} key={member.agentId} disabled={busy}>
                            <MemberAvatar agentId={member.agentId} avatarRef={profile?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                            <span>{member.displayName}<small>{profile?.teamRole || '队员'}</small></span><small className="compact-ready">可用</small><DropdownMenu.ItemIndicator><DialogControlIcon name="check" /></DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                        })}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>}>
                  {selectedAvailableMembers.map(member => <button type="button" className="compact-option" key={member.agentId} aria-pressed={leadId === member.agentId} disabled={busy} onClick={() => { setLeadId(member.agentId); setLeadMenuOpen(false) }}>
                    <MemberAvatar agentId={member.agentId} avatarRef={profileById.get(member.agentId)?.avatarRef ?? null} displayName={member.displayName} size="mention" decorative />
                    <span>{member.displayName}<small>{profileById.get(member.agentId)?.teamRole || '队员'}</small></span>{leadId === member.agentId && <DialogControlIcon name="check" />}
                  </button>)}
                </NewConversationPicker>
              </div>
              {!isMission && <div className="compact-name-disclosure">
                <button className="compact-text-button" type="button" aria-expanded={optionalOpen} aria-controls="new-camp-optional-panel" disabled={busy} onClick={() => setOptionalOpen((current) => !current)}><DialogControlIcon name={optionalOpen ? 'chevron' : 'plus'} />{optionalOpen ? '对话名称' : normalizedName ? `对话名称：${normalizedName}` : '添加对话名称'}<span>可选</span></button>
                {optionalOpen && <div className="compact-name-field" id="new-camp-optional-panel">
                  <label className="sr-only" htmlFor="new-camp-name">对话名称</label>
                  <input ref={nameInputRef} id="new-camp-name" value={name} disabled={busy} aria-invalid={Boolean(nameError)} aria-describedby="new-camp-name-hint" onChange={(event) => setName(limitDraftNameInput(event.target.value))} placeholder="输入名称..." autoComplete="off" />
                  <div className="compact-field-meta"><span id="new-camp-name-hint">留空为「未命名对话」</span><span>{nameLength} / 80</span></div>
                  {nameError && <small className="compact-field-error" role="alert">{nameError}</small>}
                </div>}
              </div>
              }
              <div className="new-camp-quick-setting">
                <div className="new-camp-quick-row">
                  <label className="new-camp-quick-label">
                    <input type="checkbox" checked={enableOneClick} disabled={busy} onChange={(event) => setEnableOneClick(event.target.checked)} />
                    <span>以后使用此队伍一键新建</span>
                  </label>
                  <NewConversationQuickHelp onOpenChange={setQuickHelpOpen}>{isMission ? <>保存队员和负责人，下次新建时自动使用。<br/>使命目标和工作目录可继续调整。</> : undefined}</NewConversationQuickHelp>
                </div>
              </div>
              {submitError && <p className="compact-inline-error" role="alert">{submitError}</p>}
            </div>
            <footer className="compact-footer">
              <Dialog.Close asChild><button className="compact-cancel" type="button" disabled={busy}>取消</button></Dialog.Close>
              <div className={isMission ? 'mission-create-split' : undefined}>
                <button className="compact-primary" type="submit" value="save" disabled={submissionBlocked}>{busy ? '正在新建…' : '新建'}</button>
                {isMission && <>
                  <button ref={startSubmitRef} type="submit" value="start" hidden disabled={submissionBlocked}/>
                  <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="compact-primary mission-create-options" type="button" aria-label="新建使命选项" disabled={submissionBlocked}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button></DropdownMenu.Trigger>
                    <DropdownMenu.Portal><DropdownMenu.Content className="compact-menu" align="end" sideOffset={6}>
                      <DropdownMenu.Item className="compact-option" onSelect={() => startSubmitRef.current?.form?.requestSubmit(startSubmitRef.current)}>开始使命</DropdownMenu.Item>
                    </DropdownMenu.Content></DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </>}
              </div>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function navigateMemberGrid(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'))
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index < 0) return
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
  const candidates = horizontal ? items : items.filter((_, itemIndex) => itemIndex % 2 === index % 2)
  const start = candidates.indexOf(items[index])
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
  let next = items[index]
  for (let offset = 1; offset <= candidates.length; offset++) {
    const candidate = candidates[(start + step * offset + candidates.length) % candidates.length]
    if (!candidate.hasAttribute('data-disabled')) {
      next = candidate
      break
    }
  }
  // Capture before Radix schedules its single-column roving focus.
  event.preventDefault()
  event.stopPropagation()
  next.focus()
}

export function projectWorkspaceActionsDisabled(
  busy: boolean,
  projectAccessReady: boolean
): boolean {
  return busy || !projectAccessReady
}

export function workspaceInspectionShouldStart(
  open: boolean,
  projectAccessReady: boolean,
  pendingPath: string | null
): pendingPath is string {
  return open && projectAccessReady && pendingPath !== null
}

export function workspaceSubmissionBlocked(
  workspace: WorkspaceChoice | null,
  projectAccessReady: boolean
): boolean {
  return workspace !== null && !projectAccessReady
}

function WorkspaceIcon({ kind }: { kind: 'quick-chat' | 'project' }): React.JSX.Element {
  if (kind === 'quick-chat') return <NavigationIcon name="square-pen" />
  return (
    <svg className="new-camp-project-folder-icon" viewBox="0 0 24 24">
      <path className="folder-fill" d="M3.75 7.2c0-1.1.9-2 2-2h4.05l2.05 2.15h6.4c1.1 0 2 .9 2 2v7.4c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2Z" />
      <path d="M3.9 9.1h16.2" />
    </svg>
  )
}

export type WorkspaceGitPresentation =
  | { kind: 'none' }
  | { kind: 'loading', label: string }
  | { kind: 'metadata', label: string }
  | { kind: 'warning', label: string, detail: string }

export function workspaceGitPresentation(
  workspace: WorkspaceChoice | null,
  inspectionStatus: GitInspectionStatus = 'ready'
): WorkspaceGitPresentation {
  if (!workspace) return { kind: 'none' }
  if (workspace && !hasGitObservation(workspace)) {
    return inspectionStatus === 'failed'
      ? {
          kind: 'warning',
          label: 'Git 检测失败',
          detail: '未能完成 Git 检测。目录仍可使用；执行前会重新检查 Git 状态。'
        }
      : {
          kind: 'loading',
          label: '检测 Git…'
        }
  }
  if (workspace.gitObservation.state === 'not_git') return { kind: 'none' }
  if (workspace.gitObservation.state === 'git_invalid') {
    return {
      kind: 'warning',
      label: 'Git 状态异常',
      detail: '无法读取当前 Git 状态。目录仍可使用；执行前会重新检查 Git 状态。'
    }
  }
  if (!workspace.gitObservation.headCommit) {
    return { kind: 'metadata', label: 'Git · 尚无提交' }
  }
  return {
    kind: 'metadata',
    label: `Git · ${workspace.gitObservation.branch ?? 'detached'}`
  }
}

function hasGitObservation(
  workspace: WorkspaceChoice | null
): workspace is WorkspaceInspection {
  return workspace !== null && 'gitObservation' in workspace
}

export function initialCampSelection(
  preflight: CampCreationPreflight,
  preferred: NewConversationDefaults | null = null
): {
  memberIds: string[]
  leadId: string
} {
  const { memberIds, leadId } = planInitialCampSelection(preflight, preferred)
  return { memberIds, leadId }
}

export interface InitialCampSelectionPlan {
  memberIds: string[]
  leadId: string
}

export function planInitialCampSelection(
  preflight: CampCreationPreflight,
  preferred: NewConversationDefaults | null = null
): InitialCampSelectionPlan {
  const presentMemberIds = preflight.presentMembers.filter(isNewConversationMemberAvailable).map((member) => member.agentId)
  const preferredMemberIds = preferred?.memberAgentIds.filter((agentId) =>
    presentMemberIds.includes(agentId)
  ) ?? []
  const memberIds = preferredMemberIds.length > 0 ? preferredMemberIds : presentMemberIds
  const leadId = preferred && memberIds.includes(preferred.defaultLeadAgentId)
    ? preferred.defaultLeadAgentId
    : memberIds[0] ?? ''
  return {
    memberIds,
    leadId
  }
}

export function normalizeDraftName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function limitDraftNameInput(value: string): string {
  const normalized = normalizeDraftName(value)
  if (Array.from(normalized).length <= 80) return value
  return Array.from(normalized).slice(0, 80).join('')
}

export function toggleCampMemberSelection({
  memberIds,
  leadId,
  toggledMemberId,
  stableMemberOrder
}: {
  memberIds: string[]
  leadId: string
  toggledMemberId: string
  stableMemberOrder: string[]
}): {
  memberIds: string[]
  leadId: string
} {
  if (!memberIds.includes(toggledMemberId)) {
    return {
      memberIds: stableMemberOrder.filter(
        (id) => id === toggledMemberId || memberIds.includes(id)
      ),
      leadId: leadId || toggledMemberId,
    }
  }
  const nextMemberIds = memberIds.filter((id) => id !== toggledMemberId)
  return {
    memberIds: nextMemberIds,
    leadId: leadId === toggledMemberId ? nextMemberIds[0] ?? '' : leadId,
  }
}

function errorMessage(error: unknown): string {
  return readErrorMessage(error)
}
