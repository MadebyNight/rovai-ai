import type { AgentProfile, CampComposerDraftView, CampMessageView, CampPendingInputsView, CampSnapshot, CoreEvent, LocalAttachmentOwnerLocator, LocalAttachmentSourceView, PendingInputEditAction, RovaiApi } from '@contracts'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CampWorkspace, type CampMessageSendReceipt, type CampLeaveGuard } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { composerDocumentFromText, emptyComposerDocument } from '../../../apps/desktop/src/renderer/src/composer-document'
import '../../../apps/desktop/src/renderer/src/styles.css'

const campId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const timestamp = '2026-08-31T00:00:00Z'
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
const calls: string[] = []
const savedContinuationSources: unknown[] = []
const attachmentCalls: { owner: string; file: string }[] = []
const previewLocators: LocalAttachmentOwnerLocator[] = []
let releasePreparation: (() => void) | null = null
let pausePreparation = false
let leaveGuard: CampLeaveGuard | null = null
let returnFailure: 'rejected' | 'unknown' | null = null
let releaseReturn: (() => void) | null = null
let pauseReturn = false
const editActions: string[] = []
const listeners = new Set<(event: CoreEvent) => void>()
const emit = (method: string, params: Record<string, unknown>) => {
  for (const listener of listeners) listener({ method, params })
}
const neverSend = async (): Promise<CampMessageSendReceipt> => { throw new Error('This scenario must not submit messages') }
let send: (draft: CampComposerDraftView) => Promise<CampMessageSendReceipt> = neverSend
const drafts = new Map<string, CampComposerDraftView>()
let root: Root | null = null
let snapshot: CampSnapshot
let initialComposerDraft: CampComposerDraftView | null = null
let queue: CampPendingInputsView
let nextRead: { promise: Promise<CampComposerDraftView>; resolve(value: CampComposerDraftView): void } | null = null
const agents: AgentProfile[] = ['叮叮', '芝士'].map((displayName, index) => ({
  agentId: `agent_${index + 1}`, displayName, avatarRef: null, accent: '#39777a', teamRole: '开发者',
  professionalResponsibilities: '实现和验证', personalityTraits: ['严谨'], workingPrinciples: '遵循项目规范',
  growthTopic: '', defaultCapabilities: [], presence: 'present', memberOrder: index, version: 1,
  runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'runtime_default' },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, createdAt: timestamp, updatedAt: timestamp, removedAt: null
}))

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function flush() { await frames(); check(errors.length === 0, errors.join('\n')) }
async function until(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await flush()
    if (condition()) return
  }
  throw new Error(message)
}
const continuation = () => document.querySelector('.composer-continuation')?.getAttribute('aria-label') ?? null
const editor = () => document.getElementById('camp-message')!
const draftReads = () => calls.filter(call => call === 'camp.composerDraft.get').length
const emptyDraft = (id = campId): CampComposerDraftView => ({
  campId: id, body: '', content: emptyComposerDocument(), revision: 0, attachments: [], quotes: [], replyIntent: null,
  continuationIntent: null, updatedAt: null, expiresAt: null
})
const continuedDraft = (messageId: string): CampComposerDraftView => ({
  ...emptyDraft(), continuationIntent: { sourceCampMessageId: messageId,
    recipient: { agentId: 'agent_2', displayName: '芝士', recipientAvailability: 'available' },
    recipientSelectionRequired: false }
})

// Core's projection is supplied explicitly per scenario. This fixture tests the
// production Renderer lifecycle, not a second implementation of route calculation.
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: (listener: (event: CoreEvent) => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  async request(method: string, params: Record<string, unknown> = {}) {
    calls.push(method)
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camps.members.fast.check') return null
    if (method === 'camp.pendingInputs.get') return structuredClone({ ...queue, campId: params.campId })
    if (method === 'camp.pendingInputs.edit') {
      const command = params.command as { pendingInputId: string; expectedRevision: number; editToken: string | null; action: PendingInputEditAction }
      const item = queue.items.find(item => item.id === command.pendingInputId)!
      check(item?.revision === command.expectedRevision, 'Pending edit must use the canonical revision')
      const action = command.action
      editActions.push(action.type)
      if (action.type === 'takeover') {
        check(command.editToken === queue.editSession?.editToken, 'Takeover must use the current lease')
        queue.editSession = { pendingInputId: item.id, editToken: 'taken-over', basePendingRevision: item.revision,
          recoveryRequired: false, foreignClient: false, workingQuotes: [], workingAttachments: structuredClone(item.attachments) }
        return { status: 'applied', code: 'pending_input.edit_started', payload: { editToken: 'taken-over' } }
      }
      if (action.type === 'return_to_composer') {
        const current = drafts.get(campId)!
        check(current.revision === action.expectedDraftRevision, 'Withdrawal must use the flushed Draft revision')
        if (pauseReturn) await new Promise<void>(resolve => { releaseReturn = resolve })
        if (returnFailure === 'rejected') return { status: 'rejected', code: 'pending_input.changed', payload: {} }
        drafts.set(campId, { ...current, content: structuredClone(item.content), body: item.body,
          revision: current.revision + 1, attachments: structuredClone(item.attachments), quotes: item.quotes,
          replyIntent: item.replyIntent, continuationIntent: null })
        queue.items = queue.items.filter(candidate => candidate.id !== item.id)
        queue.editSession = null
        if (returnFailure === 'unknown') throw new Error('连接中断，结果尚未确认')
        return { status: 'applied', code: 'pending_input.returned_to_composer', payload: { pendingInputId: item.id, draftRevision: current.revision + 1 } }
      }
      check(action.type === 'delete', 'The current page must not begin a separate editor')
      queue.items = queue.items.filter(candidate => candidate.id !== item.id)
      return { status: 'applied', code: 'pending_input.deleted', payload: {} }
    }
    if (method === 'camp.composerDraft.removeAttachment') {
      const current = drafts.get(String(params.campId))!
      check(current.revision === params.expectedRevision, 'Removal uses the current Draft revision')
      const next = { ...current, revision: current.revision + 1, attachments: current.attachments.filter(a => a.id !== params.attachmentId) }
      drafts.set(next.campId, next)
      return structuredClone(next)
    }
    if (method === 'camp.composerDraft.get') {
      if (nextRead) { const held = nextRead; nextRead = null; return held.promise }
      return structuredClone(drafts.get(String(params.campId)))
    }
    if (method === 'camp.composerDraft.save') {
      savedContinuationSources.push(params.continuationSourceMessageId)
      const current = drafts.get(String(params.campId))!
      const content = params.content as CampComposerDraftView['content']
      const saved = { ...current, content, body: content.segments.map(segment => segment.kind === 'text' ? segment.text : '').join(''),
        revision: current.revision + 1 }
      drafts.set(saved.campId, saved)
      return structuredClone(saved)
    }
    errors.push(`Unexpected RPC: ${method}`)
    throw new Error(`Unexpected RPC: ${method}`)
  },
  composerAttachments: {
    async prepare(id: string, revision: number, file: File) {
      const current = drafts.get(id)!
      check(current.revision === revision, 'Ordinary attachment must use the current Draft revision')
      attachmentCalls.push({ owner: 'composer', file: file.name })
      if (pausePreparation) await new Promise<void>(resolve => { releasePreparation = resolve })
      if (file.name === 'unreadable.txt') throw new Error('文件当前无法读取')
      const next = { ...current, revision: revision + 1, attachments: [...current.attachments, sourceAttachment(file)] }
      drafts.set(id, next)
      return structuredClone(next)
    },
    async preview(locator: LocalAttachmentOwnerLocator) {
      previewLocators.push(locator)
      return { availability: 'available', preview: { mediaType: 'image/svg+xml',
        bytes: Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#49858b"/><circle cx="105" cy="40" r="20" fill="#f2cd81"/><path d="M0 120 55 50 110 120" fill="#d1e6da"/></svg>')) } }
    }
  },
  attachments: {
    async open(locator: LocalAttachmentOwnerLocator) { previewLocators.push(locator); return { availability: 'available', error: null } },
    async reveal(locator: LocalAttachmentOwnerLocator) { previewLocators.push(locator); return { availability: 'available', error: null } }
  }
} as unknown as RovaiApi })

function sourceAttachment(file: File): LocalAttachmentSourceView {
  return { id: crypto.randomUUID(), displayName: file.name, kind: 'file', mediaType: file.type || null,
    byteSize: file.size, fileCount: null, previewKind: file.type.startsWith('image/') ? 'image' : 'none', availability: 'unknown' }
}

function message(sequence: number, agentId: string): CampMessageView {
  return { id: `message-${sequence}`, sequence, timelineGlobalSequence: sequence,
    authorType: 'user', authorId: 'local_user', sourceAgentRunId: null,
    body: `消息 ${sequence}`, content: [{ kind: 'member_mention', agentId }, { kind: 'text', text: `消息 ${sequence}` }],
    addressMode: 'explicit', attachments: [], quotes: [], addressedAgentIds: [agentId], replyToCampMessageId: null,
    campTurnId: `turn-${sequence}`, presentation: null, createdAt: timestamp }
}

function running(current: CampMessageView): Pick<CampSnapshot, 'turns' | 'agentRuns'> {
  const agentId = current.addressedAgentIds[0]
  return {
    turns: [{ id: current.campTurnId!, triggerType: 'camp_message', triggerId: current.id, status: 'running',
      cancelRequestedAt: null, aggregateReasonCode: null, executionBudget: { schemaVersion: 1,
        acceptedAt: timestamp, deadlineAt: '2026-08-31T01:00:00Z', elapsedSeconds: 3600,
        maxAgentRunResponsibilities: 32, maxAcceptedA2a: 16, allocatedAgentRunResponsibilities: 1,
        acceptedA2a: 0, exhaustedAt: null, exhaustionReason: null, exhaustionCommandId: null },
      version: 1, createdAt: timestamp, updatedAt: timestamp, endedAt: null }],
    agentRuns: [{ id: `run-${current.sequence}`, campTurnId: current.campTurnId!, conversationId: `conversation-${agentId}`,
      agentId, taskId: null, responsibilityKey: `direct:${agentId}`, responsibilityGeneration: 0, purpose: current.body,
      completionRole: 'required', status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: null, terminalReasonCode: null, failure: null,
      runtimeModel: null, permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 0,
      hasUnsettledExternalEffects: false, workspace: { path: '/fixture' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: timestamp, startedAt: timestamp, endedAt: null, updatedAt: timestamp }]
  }
}

async function render() {
  flushSync(() => root!.render(<CampWorkspace snapshot={snapshot} projectName={null} agents={agents}
    initialComposerDraft={initialComposerDraft}
    onInitialComposerDraftConsumed={() => { initialComposerDraft = null }}
    busy={false} stopping={false} worldMapEnabled={false}
    onSend={(draft) => send(draft)} onStop={() => undefined}
    onChangeLead={async () => undefined} onTasksChanged={async () => undefined} onResolveApproval={() => undefined}
    onCampLeaveGuardChange={(_campId, guard) => { leaveGuard = guard }} />))
  await flush()
}

async function reset(draft = emptyDraft(), holdInitialRead = false, entryDraft: CampComposerDraftView | null = null) {
  if (root) {
    flushSync(() => root!.unmount())
    await new Promise(resolve => setTimeout(resolve, 0))
    await flush()
  }
  calls.length = 0
  attachmentCalls.length = 0
  previewLocators.length = 0
  releasePreparation = null
  pausePreparation = false
  pauseReturn = false
  releaseReturn = null
  returnFailure = null
  editActions.length = 0
  savedContinuationSources.length = 0
  drafts.clear()
  drafts.set(campId, draft)
  nextRead = null
  initialComposerDraft = entryDraft
  send = neverSend
  queue = { campId, executionActive: true, items: [], editSession: null }
  const first = message(1, 'agent_1')
  snapshot = { schemaVersion: 34, throughGlobalSequence: 1,
    camp: { id: campId, title: '续发目标回归', activationState: 'active', projectBindingKind: 'quick_chat',
      projectPath: '/fixture', defaultLeadAgentId: 'agent_1', membershipGeneration: 1, version: 1,
      createdAt: timestamp, updatedAt: timestamp },
    members: agents.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName,
      teamRole: agent.teamRole, avatarRef: null, accent: agent.accent ?? '#39777a', membershipStatus: 'active', leaveRequestedAt: null,
      profilePresence: 'present', memberOrder: index, isDefaultLead: index === 0, version: 1 })),
    membershipReconciliations: [], tasks: [], messages: [first], messageDeliveries: [], ...running(first),
    executionEvidence: [], agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: [] }
  const held = holdInitialRead ? holdRead() : null
  if (entryDraft) snapshot = { ...snapshot, messages: [], turns: [], agentRuns: [] }
  if (held) {
    snapshot = { ...snapshot, turns: [], agentRuns: [] }
    queue = { ...queue, executionActive: false }
  }
  root = createRoot(document.getElementById('root')!)
  await render()
  await flush()
  return held
}

async function publish(agentId: string, projected: CampComposerDraftView) {
  drafts.set(snapshot.camp.id, projected)
  const next = message(snapshot.messages.at(-1)!.sequence + 1, agentId)
  snapshot = { ...snapshot, throughGlobalSequence: snapshot.throughGlobalSequence + 1,
    messages: [...snapshot.messages, next], ...running(next) }
  queue = { ...queue, items: queue.items.slice(1) }
  emit('camp.pendingInputs.changed', { campId: snapshot.camp.id, reason: 'published' })
  await render()
}

function holdRead() {
  let resolve!: (draft: CampComposerDraftView) => void
  const held = { promise: new Promise<CampComposerDraftView>(accept => { resolve = accept }), resolve: (draft: CampComposerDraftView) => resolve(draft) }
  nextRead = held
  return held
}

const pendingEditor = editor
const pendingCards = () => document.querySelectorAll('.composer .composer-attachment-card')
const pendingReady = () => editor()?.isContentEditable === true && editor()?.getAttribute('aria-disabled') !== 'true'
const imageFile = (name = '粘贴图片.png') => new File(['fixture image'], name, { type: 'image/png' })
const textFile = (name: string) => new File(['fixture text'], name, { type: 'text/plain' })

function dragFiles(target: Element, files: File[], drop = true): DragEvent {
  const dataTransfer = new DataTransfer()
  // Constructed DataTransfer has no native drag operation to retain dropEffect.
  // Keep the handler's chosen cursor observable while using real FileList/items.
  Object.defineProperty(dataTransfer, 'dropEffect', { value: 'none', writable: true })
  files.forEach(file => dataTransfer.items.add(file))
  target.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true, cancelable: true }))
  const over = new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true })
  target.dispatchEvent(over)
  if (drop) target.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  return over
}

async function beginPending(index = 0) {
  const count = queue.items.length
  document.querySelectorAll<HTMLButtonElement>('.pending-input-edit')[index].click()
  await until(() => queue.items.length === count - 1 && pendingReady(), 'Withdrawal must replace the normal Composer and release the queue')
}

async function setupPendingAttachments() {
  const draft = emptyDraft()
  draft.body = '独立保留的普通草稿'
  draft.content = composerDocumentFromText(draft.body)
  draft.attachments = [sourceAttachment(imageFile('普通图片.png'))]
  await reset(draft)
  const attachments = [sourceAttachment(imageFile('原有图片.png')), sourceAttachment(textFile('设计说明.txt'))]
  queue.items = [
    { id: 'pending-with-body', campId, enqueueSequence: 1, revision: 1, state: 'queued',
      content: composerDocumentFromText('请看这份设计说明'), body: '请看这份设计说明', attachments,
      replyIntent: null, quotes: [], recipientSelectionRequired: false, lastAttemptErrorCode: null },
    { id: 'pending-attachment-only', campId, enqueueSequence: 2, revision: 1, state: 'queued',
      content: emptyComposerDocument(), body: '', attachments: [sourceAttachment(imageFile('仅附件.png'))],
      replyIntent: null, quotes: [], recipientSelectionRequired: false, lastAttemptErrorCode: null }
  ]
  emit('camp.pendingInputs.changed', { campId, reason: 'enqueued' })
  await until(() => document.querySelectorAll('.pending-input-row').length === 2, 'Both queued messages must appear')
  return draft
}

// Pending v4 retires the separate save/cancel editor. Legacy token/revision and
// working-ref behavior remains covered by the Core owner; these cases own the
// current Renderer transfer, ordinary attachment and navigation seams.
async function runPendingAttachmentCases(): Promise<string[]> {
  const cases: string[] = []
  await setupPendingAttachments()
  const summaries = document.querySelectorAll('.pending-input-copy')
  check(summaries[0].textContent === '请看这份设计说明' && summaries[1].textContent === '', 'Queue summaries contain only body, including empty attachment-only body')
  check(!document.querySelector('.pending-input-list .attachment-card'), 'Queue rows must not load attachment cards')
  check(!previewLocators.some(locator => locator.owner === 'pending'), 'Queue rows do not read attachment previews')
  cases.push('body-only queue summaries do not read files')

  await beginPending()
  await until(() => pendingCards().length === 2, 'Canonical attachments must replace the previous Draft attachments')
  check(editor().textContent === '请看这份设计说明' && !document.querySelector('.pending-input-editor'), 'Withdrawal uses only the normal Composer')
  check(queue.items.length === 1 && editActions.join() === 'return_to_composer', 'Withdrawal releases the selected queue row without beginning a legacy edit')
  cases.push('canonical body and files replace only the selected Draft and release the queue')

  pausePreparation = true
  const clipboardData = new DataTransfer(); clipboardData.items.add(imageFile())
  editor().dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  await until(() => releasePreparation !== null, 'Pasted image must reach ordinary Composer ingress')
  check(document.querySelector('.attachment-preparing'), 'Preparation must render shared loading feedback')
  pausePreparation = false; releasePreparation!()
  await until(() => pendingCards().length === 3 && !document.querySelector('.attachment-preparing'), 'Prepared image must join the Draft')
  check(previewLocators.some(locator => locator.owner === 'composer'), 'Thumbnail reads the current Composer owner')
  cases.push('paste uses ordinary preparation feedback and owner-scoped previews')

  dragFiles(editor(), [textFile('拖入文件.txt'), textFile('补充说明.md')])
  await until(() => pendingCards().length === 5, 'Multiple dropped files join the returned Draft')
  document.querySelector<HTMLButtonElement>('[aria-label="移除附件 拖入文件.txt"]')!.click()
  await until(() => pendingCards().length === 4, 'Removal must update the current Draft')
  check(attachmentCalls.every(call => call.owner === 'composer') && queue.items[0].attachments.length === 1, 'New files must not mutate the remaining Pending input')
  cases.push('multi-file drag and remove affect only the returned Composer')

  dragFiles(editor(), [textFile('unreadable.txt')])
  await until(() => document.body.textContent?.includes('文件当前无法读取') === true, 'Import failure must remain actionable')
  dragFiles(editor(), [textFile('恢复后的文件.txt')])
  await until(() => drafts.get(campId)!.attachments.length === 5, 'Import can recover after failure')
  cases.push('failed ingress preserves existing files and permits another import')

  await beginPending()
  await until(() => pendingCards().length === 1 && !editor().textContent?.trim(), 'Attachment-only withdrawal clears old text and refs')
  document.querySelector<HTMLButtonElement>('.composer .attachment-remove')!.click()
  await until(() => drafts.get(campId)!.attachments.length === 0, 'The last source ref can be removed')
  check(document.querySelector<HTMLButtonElement>('.composer-send')!.disabled, 'Empty text and empty attachments cannot send')
  cases.push('attachment-only withdrawal and empty-send guard remain intact')
  return cases
}

async function runPendingNavigationCases(): Promise<string[]> {
  const cases: string[] = []
  await setupPendingAttachments()
  const originalSnapshot = snapshot
  queue.items[0].content.segments.unshift({ kind: 'atom', atom: { type: 'member', agentId: 'agent_1' } })
  emit('camp.pendingInputs.changed', { campId, reason: 'fixture-ready' }); await flush()
  pauseReturn = true
  document.querySelector<HTMLButtonElement>('.pending-input-edit')!.click()
  await until(() => releaseReturn !== null, 'The transfer must reach its command')
  let blocked = false
  try { await leaveGuard!() } catch { blocked = true }
  check(blocked && !pendingReady(), 'Navigation and editing are fenced while transfer is pending')
  pauseReturn = false; releaseReturn!()
  await until(() => pendingReady() && queue.items.length === 1, 'Transfer must finish')
  cases.push('in-flight transfer fences navigation and editing')

  editor().focus(); const selection = window.getSelection()!
  selection.selectAllChildren(editor()); selection.collapseToEnd()
  document.execCommand('insertText', false, '，回来后继续修改'); await flush()
  const text = editor().textContent
  const aborted = await leaveGuard!(); aborted.complete(false)
  await until(pendingReady, 'Aborted navigation unlocks the same Composer')
  check(editor().textContent === text, 'Aborted navigation preserves text')
  cases.push('aborted navigation preserves returned Draft text')

  const remount = async (nextSnapshot: CampSnapshot, nextQueue: CampPendingInputsView) => {
    flushSync(() => root!.unmount()); snapshot = nextSnapshot; queue = nextQueue
    root = createRoot(document.getElementById('root')!); await render()
    await until(pendingReady, 'Remounted Composer must load')
  }
  const originalQueue = queue, otherId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec1'
  drafts.set(otherId, { ...emptyDraft(otherId), content: composerDocumentFromText('另一会话草稿'), body: '另一会话草稿' })
  const mutationCount = editActions.length
  const leave = await leaveGuard!(); leave.complete(true)
  await remount({ ...snapshot, camp: { ...snapshot.camp, id: otherId } }, { campId: otherId, executionActive: false, items: [], editSession: null })
  check(editor().textContent?.includes('另一会话草稿'), 'Returned Draft cannot leak into another Camp')
  const back = await leaveGuard!(); back.complete(true); await remount(originalSnapshot, originalQueue)
  check(editor().textContent === text && pendingCards().length === 2, 'Returned text and attachments survive ordinary navigation')
  check(editor().querySelector('[data-token-kind="member_mention"][data-agent-id="agent_1"]') && editActions.length === mutationCount, 'Atom identity survives without another withdrawal')
  cases.push('ordinary Draft persistence owns cross-Camp navigation after withdrawal')

  await setupPendingAttachments(); returnFailure = 'rejected'
  const before = editor().textContent
  document.querySelector<HTMLButtonElement>('.pending-input-edit')!.click()
  await until(() => Boolean(document.querySelector('.pending-input-notice')), 'A rejected transfer must explain its failure')
  check(pendingReady() && editor().textContent === before && queue.items.length === 2, 'Rejection preserves both owners')
  returnFailure = null; await beginPending()
  cases.push('rejection preserves both owners and explicit retry succeeds')

  await setupPendingAttachments(); returnFailure = 'unknown'
  document.querySelector<HTMLButtonElement>('.pending-input-edit')!.click()
  await until(() => Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重新加载草稿')), 'Unknown outcome requires explicit reload')
  check(!pendingReady(), 'Unknown transfer outcome cannot autosave stale text')
  returnFailure = null
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === '重新加载草稿')!.click()
  await until(() => pendingReady() && editor().textContent === '请看这份设计说明', 'Reload resolves the already committed transfer')
  check(editActions.filter(a => a === 'return_to_composer').length === 1, 'Recovery reads instead of repeating withdrawal')
  cases.push('unknown outcome blocks stale edits and reloads the committed Draft')

  await setupPendingAttachments()
  queue.editSession = { pendingInputId: queue.items[0].id, editToken: 'foreign-token', basePendingRevision: 1,
    foreignClient: true, recoveryRequired: true, workingQuotes: [], workingAttachments: [] }
  emit('camp.pendingInputs.changed', { campId, reason: 'foreign-edit' }); await flush()
  check(editActions.length === 0 && document.querySelector<HTMLButtonElement>('.pending-input-delete')!.disabled, 'Reading a foreign edit neither takes over nor enables delete')
  check(document.querySelector('.pending-input-edit')?.getAttribute('title')?.includes('接管'), 'Takeover must be explicit in the action')
  await beginPending()
  check(editActions.join() === 'takeover,return_to_composer', 'Explicit takeover precedes withdrawal')
  cases.push('foreign ownership requires explicit takeover before withdrawal')

  await setupPendingAttachments()
  queue.editSession = { pendingInputId: queue.items[0].id, editToken: 'own-legacy', basePendingRevision: 1,
    recoveryRequired: true, workingQuotes: [], workingAttachments: [sourceAttachment(textFile('未保存.txt'))] }
  emit('camp.pendingInputs.changed', { campId, reason: 'legacy-edit' }); await flush()
  check(editActions.length === 0 && !document.querySelector('.pending-input-editor'), 'Legacy recovery does not mount or mutate an editor')
  await beginPending()
  check(!drafts.get(campId)!.attachments.some(a => a.displayName === '未保存.txt'), 'Withdrawal restores canonical refs, not unsaved legacy working refs')
  cases.push('legacy recovery explicitly restores canonical content without importing unsaved edits')
  return cases
}

Object.assign(window, { continuationTest: { async run() {
  const cases: string[] = []
  await reset()
  const queueReads = () => calls.filter(call => call === 'camp.pendingInputs.get').length
  check(queueReads() === 1, 'Mount must read the queue once')
  await new Promise(resolve => setTimeout(resolve, 1_200))
  await flush()
  check(queueReads() === 1, 'An unchanged queue must not be polled every second')
  snapshot = { ...snapshot, throughGlobalSequence: 2 }
  await render()
  check(queueReads() === 1, 'Unrelated public evidence must not reread the private queue')
  cases.push('idle queues do not poll or refresh for unrelated public evidence')

  const initialReads = draftReads()
  queue.items = [{ id: 'pending-B', campId, enqueueSequence: 1, revision: 1, state: 'queued',
    content: composerDocumentFromText('给芝士的 B'), body: '给芝士的 B', replyIntent: null, quotes: [],
    recipientSelectionRequired: false, lastAttemptErrorCode: null, attachments: [] }]
  emit('camp.pendingInputs.changed', { campId, reason: 'enqueued' })
  await flush()
  check(document.querySelector('.pending-input-list'), 'B must be visible in the private queue')
  check(continuation() === null && draftReads() === initialReads, 'Queue admission or Run progress must not recalculate the route')
  cases.push('private queue admission leaves the published route unchanged')

  await publish('agent_2', continuedDraft('message-2'))
  await until(() => continuation() === '继续发给 芝士', 'Publishing queued B must refresh the visible continuation before B finishes')
  check(snapshot.agentRuns[0].status === 'running' && snapshot.agentRuns[0].endedAt === null, 'B must still be running')
  cases.push('published B changes the target while its Run is still active')

  await publish('agent_1', emptyDraft())
  await until(() => continuation() === null, 'Publishing to Lead must clear the stale non-Lead continuation')
  check(document.querySelector('.composer-route-rail')?.textContent?.includes('叮叮'), 'The route must return to the Lead')
  cases.push('the next published Lead message clears the previous continuation')

  await reset()
  const held = holdRead()
  await publish('agent_2', continuedDraft('message-2'))
  check(nextRead === null, 'Publication must request a fresh Draft projection')
  const activeEditor = editor()
  activeEditor.focus()
  document.execCommand('insertText', false, '不要覆盖的草稿')
  await flush()
  held.resolve(continuedDraft('message-2'))
  await flush()
  check(editor() === activeEditor && editor().textContent?.includes('不要覆盖的草稿'), 'Late reads must preserve the live editor and text')
  check(continuation() === null, 'A late response must not change the target after typing began')
  cases.push('a late publication read cannot replace locally edited text or route')

  const explicit = emptyDraft()
  explicit.content = { version: 2, segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent_1' } }, { kind: 'text', text: '已有草稿' }] }
  explicit.body = '@叮叮 已有草稿'
  explicit.attachments = [{ id: 'attachment-1', displayName: '验收文件.txt', kind: 'file', fileCount: 1,
    mediaType: 'text/plain', byteSize: 42, previewKind: 'none', availability: 'unknown' }]
  await reset(explicit)
  const retainedEditor = editor()
  await publish('agent_2', explicit)
  check(editor() === retainedEditor && editor().textContent?.includes('已有草稿'), 'Publication must preserve the existing Draft text')
  check(document.querySelector('.composer-attachment-strip strong')?.getAttribute('title') === '验收文件.txt', 'Publication must preserve attachments')
  check(continuation() === null && editor().querySelector('[data-token-kind="member_mention"][data-agent-id="agent_1"]'), 'Explicit recipient must remain authoritative')
  cases.push('publication preserves an existing explicit recipient, text and attachment')

  const frozen = continuedDraft('older-message')
  frozen.body = '继续给芝士的草稿'
  frozen.content = composerDocumentFromText(frozen.body)
  await reset(frozen)
  await publish('agent_1', frozen)
  check(continuation() === '继续发给 芝士' && editor().textContent?.includes(frozen.body), 'A started Draft must retain its frozen continuation')
  cases.push('a started Draft retains its own continuation source')

  await reset()
  const previousCampRead = holdRead()
  await publish('agent_2', continuedDraft('message-2'))
  const otherCampId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec1'
  drafts.set(otherCampId, emptyDraft(otherCampId))
  snapshot = { ...snapshot, camp: { ...snapshot.camp, id: otherCampId } }
  await render()
  await flush()
  previousCampRead.resolve(continuedDraft('message-2'))
  await flush()
  check(continuation() === null, 'A late read from the previous Camp must not change this Camp')
  cases.push('late publication responses are scoped to their Camp')

  await reset()
  editor().focus()
  document.execCommand('insertText', false, '已经自动保存的下一条')
  await until(() => calls.includes('camp.composerDraft.save'), 'Typing must autosave the Draft')
  await flush()
  const savesBefore = calls.filter(call => call === 'camp.composerDraft.save').length
  const readsBefore = draftReads()
  let submissions = 0
  send = async (draft) => {
    check(draft.body === '已经自动保存的下一条' && draft.revision > 0, 'Send must use the saved exact Draft')
    submissions += 1
    drafts.set(campId, emptyDraft())
    queue = { ...queue, items: [{ id: 'pending-send', campId, enqueueSequence: 1, revision: 1, state: 'queued',
      content: draft.content, body: draft.body, replyIntent: null, quotes: [], recipientSelectionRequired: false, lastAttemptErrorCode: null, attachments: draft.attachments }] }
    emit('camp.pendingInputs.changed', { campId, reason: 'enqueued' })
    return { pendingInputId: 'pending-send', agentRunIds: [], campTurnId: null, addressedAgentIds: ['agent_1'] }
  }
  editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
  await until(() => submissions === 1 && !editor().textContent?.trim(), 'The pending send must consume the ordinary Draft')
  await flush()
  check(calls.filter(call => call === 'camp.composerDraft.save').length === savesBefore, 'Send must not save an identical autosaved Draft again')
  check(draftReads() === readsBefore + 1, 'A successful send must read the next Draft only once')
  check(document.querySelector('.pending-input-list')?.textContent?.includes('已经自动保存的下一条'), 'Admission must appear in the private queue')
  check(snapshot.messages.length === 1, 'Private admission must not add a public message')
  cases.push('an autosaved pending send avoids duplicate Draft saves and reads')

  for (const admission of ['pending', 'published', 'published-lagging']) {
    const published = admission !== 'pending'
    await reset(continuedDraft('message-1'))
    const previous = message(1, 'agent_2')
    snapshot = { ...snapshot, messages: [previous], ...running(previous) }
    if (published) {
      snapshot = { ...snapshot, turns: [], agentRuns: [] }
      queue = { ...queue, executionActive: false }
    }
    await render()
    editor().focus()
    document.execCommand('insertText', false, '第一条继续给芝士')
    await until(() => savedContinuationSources.length === 1, 'The first Draft must autosave its continuation')
    const source = published ? 'message-2' : 'message-1'
    const nextDraft = continuedDraft(source)
    let heldNextDraft: ReturnType<typeof holdRead> | null = null
    let sends = 0
    const publishSnapshot = async () => {
      const sent = message(2, 'agent_2')
      snapshot = { ...snapshot, throughGlobalSequence: 2, messages: [...snapshot.messages, sent], ...running(sent) }
      await render()
    }
    send = async (draft) => {
      sends += 1
      check(draft.continuationIntent?.recipient.agentId === 'agent_2', 'Both sends must retain the non-Lead recipient')
      drafts.set(campId, nextDraft)
      if (sends === 1) {
        if (admission === 'published') {
          await publishSnapshot()
        }
        heldNextDraft = holdRead()
      }
      return { ...(published ? { publishedMessageSequence: 2 } : { pendingInputId: 'queued-next' }),
        agentRunIds: [], campTurnId: null, addressedAgentIds: ['agent_2'] }
    }
    const beforeSendReads = draftReads()
    const pressEnter = () => editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    pressEnter()
    await until(() => heldNextDraft !== null && nextRead === null, 'Send must initialize the next authoritative route')
    check(editor().getAttribute('aria-disabled') === 'true' && !editor().isContentEditable,
      'A fast next keystroke must not freeze a null route before the next Draft is initialized')
    pressEnter()
    await flush()
    check(sends === 1, 'A second send must wait for the route initialization')
    heldNextDraft!.resolve(nextDraft)
    await until(() => editor().getAttribute('aria-disabled') !== 'true' && continuation() === '继续发给 芝士',
      'The next editor must restore the non-Lead route')
    check(draftReads() === beforeSendReads + 1, 'Route initialization must not trigger a duplicate publication read')
    if (admission === 'published-lagging') {
      await publishSnapshot()
      check(draftReads() === beforeSendReads + 1, 'A late public projection must reuse the already initialized route')
    }
    editor().focus()
    document.execCommand('insertText', false, '第二条还是给芝士')
    await until(() => savedContinuationSources.length === 2, 'The second Draft must autosave')
    check(savedContinuationSources[1] === source, 'A quick following Draft must persist the initialized continuation source')
    pressEnter()
    await until(() => sends === 2 && editor().getAttribute('aria-disabled') !== 'true', 'The second send must complete')
  }
  cases.push('delayed next-Draft initialization preserves the recipient across two quick sends')

  flushSync(() => root!.unmount())
  root = createRoot(document.getElementById('root')!)
  const activations: string[] = []
  const markdown = '# 标题\n\n[跳转](#标题)\n\n打开 [README](./README.md)\n\n![image](./image.png)'
  const asset = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
  const firstImage = () => `${asset}#first`
  const drawMarkdown = (label: string, localImageUrl = firstImage, content = markdown) => {
    flushSync(() => root!.render(<SafeMarkdown
      onFileReference={(reference) => activations.push(`${label}:${reference}`)}
      onHeadingTargetResult={(found) => activations.push(`${label}:heading:${found}`)}
      localImageUrl={localImageUrl}>{content}</SafeMarkdown>))
  }
  drawMarkdown('old')
  await flush()
  const fileLink = document.querySelector<HTMLElement>('.markdown-file-reference')!
  check(fileLink, 'Markdown must render its file link')
  drawMarkdown('latest')
  await flush()
  check(document.querySelector('.markdown-file-reference') === fileLink, 'Unchanged Markdown must retain its rendered tree when callbacks change')
  fileLink.click()
  document.querySelector<HTMLAnchorElement>('.safe-markdown a[href^="#"]:not(.markdown-file-reference)')!.click()
  check(activations.join(',') === 'latest:./README.md,latest:heading:true', 'Cached links must invoke the latest file and heading callbacks')
  drawMarkdown('latest', () => `${asset}#second`)
  check(document.querySelector('img')?.getAttribute('src') === `${asset}#second`, 'A changed image projection must update cached Markdown')
  drawMarkdown('latest', firstImage, 'Updated [App](src/app.ts)')
  check(document.querySelector('.markdown-file-reference')?.getAttribute('title') === 'src/app.ts', 'Changed Markdown content must be reparsed')
  cases.push('Markdown caching preserves fresh callbacks, image authority and changed content')
  await flush()
  return { ok: true, cases }
}, async pendingAttachments() { return { ok: true, cases: await runPendingAttachmentCases() } },
async pendingNavigation() { return { ok: true, cases: await runPendingNavigationCases() } },
async routeLoading() {
  const layout = () => ({
    composerTop: editor().closest('.composer-box')!.getBoundingClientRect().top,
    timelineBottom: document.querySelector('.timeline-scroll')!.getBoundingClientRect().bottom
  })
  const explicit = emptyDraft()
  explicit.content = { version: 2, segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent_2' } }] }
  explicit.body = '@芝士'
  const layouts = []
  for (const theme of ['day', 'night']) {
    document.documentElement.dataset.theme = theme
    let defaultRecipientColor: string | null = null
    for (const [name, draft] of [['default', emptyDraft()], ['continuation', continuedDraft('message-1')], ['explicit', explicit]] as const) {
      const held = await reset(draft, true)
      check(held && draftReads() === 1, 'The initial Draft read must remain pending')
      const before = layout()
      check(before.composerTop > 0 && before.timelineBottom > 0, 'Measure the visible conversation and input')
      check(editor().getAttribute('aria-disabled') === 'true', 'Loading must keep the editor disabled')
      check(document.querySelector('.composer-route-placeholder') && document.querySelector('.composer-route-rail')?.getAttribute('aria-busy') === 'true',
        'Loading must present the placeholder as busy')
      check(!document.querySelector('.composer-route-rail')?.textContent?.trim(), 'Loading must not guess the recipient')
      held.resolve(draft)
      await until(() => editor().getAttribute('aria-disabled') !== 'true', 'The authoritative Draft enables the editor')
      const after = layout()
      check(Math.abs(after.composerTop - before.composerTop) <= 1 && Math.abs(after.timelineBottom - before.timelineBottom) <= 1,
        `Route loading must not move the conversation: ${JSON.stringify({ theme, name, before, after })}`)
      check(!document.querySelector('.composer-route-placeholder'), 'Ready replaces the placeholder')
      const route = document.querySelector('.composer-route-rail')?.textContent ?? ''
      if (name === 'default') check(route.includes('默认由队长 @叮叮 接收'), 'Show the default recipient')
      if (name === 'default' || name === 'continuation') {
        const recipient = document.querySelector<HTMLElement>('.composer-route-rail strong')!
        check(recipient.textContent?.startsWith('@'), 'Both route modes mark the recipient with @')
        const color = getComputedStyle(recipient).color
        if (name === 'default') defaultRecipientColor = color
        else check(color === defaultRecipientColor, 'Both route modes use the same mention color')
        check(color !== getComputedStyle(recipient.parentElement!).color, 'The recipient is visually distinct from route copy')
      }
      if (name === 'continuation') check(continuation() === '继续发给 芝士', 'Show the authoritative continuation')
      if (name === 'explicit') check(!route.trim(), 'Explicit recipients hide the route')
      layouts.push({ theme, name, before, after })
    }
    const fresh = emptyDraft()
    await reset(fresh, false, fresh)
    check(draftReads() === 0, 'New Camp entry must reuse its authoritative Draft without a second route read')
    check(initialComposerDraft === null, 'Entry Draft must be consumed, not cached for later navigation')
    check(!document.querySelector('.composer-route-placeholder'), 'New Camp entry must not flash a loading placeholder')
    check(editor().isContentEditable && document.querySelector('.mention-target-summary')?.textContent?.includes('默认由队长 @叮叮 接收'),
      'The first new Camp presentation must have a ready editor and default recipient')
    editor().focus()
    document.execCommand('insertText', false, '第一次输入')
    await until(() => savedContinuationSources.length === 1, 'New Camp entry must support immediate editing and autosave')
    check(drafts.get(campId)?.body === '第一次输入', 'The initial authoritative revision must support saving')

    const restored = await reset(explicit, true)
    check(document.querySelector('.composer-route-placeholder'), 'Reopening a Camp must read its current Draft')
    restored!.resolve(explicit)
    await until(() => editor().isContentEditable, 'Restored Draft must enable editing')
    check(!document.querySelector('.mention-target-summary'), 'A saved explicit recipient must not show the default route')
  }
  return { ok: true, cases: ['delayed Draft retains conversation geometry'], layouts }
} } })

// The same isolated production-Renderer fixture can also run in a browser when
// the host cannot initialize a nested Electron sandbox. This is not native IPC coverage.
const browserMode = new URLSearchParams(location.search)
if (browserMode.has('browser')) {
  const runBrowserFixture = async () => {
    if (browserMode.get('browser') === 'route-review') {
      document.documentElement.dataset.theme = browserMode.get('theme') === 'night' ? 'night' : 'day'
      const fresh = emptyDraft()
      await reset(fresh, false, fresh)
      return
    }
    if (browserMode.get('browser') === 'review') {
      document.documentElement.dataset.theme = browserMode.get('theme') === 'night' ? 'night' : 'day'
      await setupPendingAttachments()
      await beginPending()
      dragFiles(pendingEditor(), [imageFile(), textFile('项目补充说明与下一轮排队消息需要使用的文件.txt')])
      await until(() => pendingReady() && pendingCards().length === 4, 'Review attachments must be ready')
      return
    }
    const report = document.createElement('pre')
    document.body.append(report)
    try {
      const fixture = (window as unknown as { continuationTest: {
        run(): Promise<unknown>; pendingAttachments(): Promise<unknown>; routeLoading(): Promise<unknown>
      } }).continuationTest
      const result = await (browserMode.get('browser') === 'route'
        ? fixture.routeLoading()
        : browserMode.get('browser') === 'pending' ? fixture.pendingAttachments() : fixture.run())
      report.textContent = JSON.stringify(result, null, 2)
    } catch (error) {
      report.textContent = String(error instanceof Error ? error.stack : error)
    }
  }
  void runBrowserFixture()
}
