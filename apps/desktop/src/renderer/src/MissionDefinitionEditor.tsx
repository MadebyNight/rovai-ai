import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ButtonHTMLAttributes, type DragEvent, type ReactNode, type RefObject } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { LocalAttachmentSourceView, MissionAttachmentDraft } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { useCampClient } from './camp-client'
import { DialogControlIcon } from './AppDialog'
import { Icon, TagMark } from './MissionControls'
import { NavigationIcon } from './NavigationIcon'

export type MissionDraftAttachment =
  | { kind: 'stored'; attachment: LocalAttachmentSourceView }
  | { kind: 'local'; id: string; file: File }

export type MissionWritingPlaneHandle = { chooseFiles(): void }

export function missionAttachmentDrafts(attachments: MissionDraftAttachment[]): MissionAttachmentDraft[] {
  return attachments
    .filter((attachment): attachment is Extract<MissionDraftAttachment, {kind: 'local'}> => attachment.kind === 'local')
    .map(({ id, file }) => ({ id, file }))
}

export function keptMissionAttachmentIds(attachments: MissionDraftAttachment[]): string[] {
  return attachments
    .filter((attachment): attachment is Extract<MissionDraftAttachment, {kind: 'stored'}> => attachment.kind === 'stored')
    .map(({ attachment }) => attachment.id)
}

export function storedMissionAttachments(attachments: LocalAttachmentSourceView[] | undefined): MissionDraftAttachment[] {
  return (attachments ?? []).map(attachment => ({ kind: 'stored', attachment }))
}

function attachmentIdentity(attachment: MissionDraftAttachment): string {
  return attachment.kind === 'stored'
    ? `stored:${attachment.attachment.id}`
    : `local:${attachment.id}`
}

function attachmentName(attachment: MissionDraftAttachment): string {
  return attachment.kind === 'stored' ? attachment.attachment.displayName : attachment.file.name
}

function attachmentExtension(name: string): string {
  const match = name.match(/\.([^.]+)$/)
  return match?.[1]?.slice(0, 5).toLocaleUpperCase() ?? 'FILE'
}

function LocalImage({ file }: { file: File }): React.JSX.Element {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return <img src={url} alt="" />
}

function FileGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.8h8l4 4V21H6z"/><path d="M14 2.8V7h4M9 12h6M9 15h5"/></svg>
}

function MissionAttachmentItem({ attachment, mission, disabled, onRemove, onNotify }: {
  attachment: MissionDraftAttachment
  mission?: {campId: string; missionId: string}
  disabled: boolean
  onRemove(): void
  onNotify(message: string): void
}): React.JSX.Element {
  const client = useCampClient()
  const name = attachmentName(attachment)
  const isImage = attachment.kind === 'local' && attachment.file.type.startsWith('image/')
  const open = async (): Promise<void> => {
    if (attachment.kind !== 'stored' || !mission) return
    try {
      const result = client.attachments.kind === 'native'
        ? await client.attachments.open({ owner: 'mission', ...mission, attachmentRefId: attachment.attachment.id })
        : await client.attachments.download({ owner: 'mission', ...mission, attachmentRefId: attachment.attachment.id })
      if (result.error) onNotify('此附件当前不可用。')
    } catch {
      onNotify('无法打开此附件。')
    }
  }
  return <div className={`mission-editor-file${isImage ? ' is-image' : ''}`}>
    <button type="button" className="mission-editor-file-open" title={name} onClick={() => void open()} disabled={attachment.kind === 'local'}>
      {attachment.kind === 'local' && isImage
        ? <LocalImage file={attachment.file}/>
        : <><span className="mission-editor-file-glyph"><FileGlyph/></span><span className="mission-editor-file-name">{name}</span><span className="mission-editor-file-ext">{attachmentExtension(name)}</span></>}
    </button>
    <button type="button" className="mission-editor-file-remove" aria-label={`移除附件 ${name}`} onClick={onRemove} disabled={disabled}><DialogControlIcon name="close"/></button>
  </div>
}

export const MissionWritingPlane = forwardRef<MissionWritingPlaneHandle, {
  title: string
  description: string
  attachments: MissionDraftAttachment[]
  disabled: boolean
  attachmentsDisabled?: boolean
  titleInputRef?: RefObject<HTMLInputElement | null>
  titleError?: string
  descriptionError?: string
  mission?: {campId: string; missionId: string}
  onTitleChange(value: string): void
  onDescriptionChange(value: string): void
  onAttachmentsChange(value: MissionDraftAttachment[]): void
  onNotify(message: string): void
}>(({
  title, description, attachments, disabled, attachmentsDisabled = false, titleInputRef, titleError, descriptionError,
  mission, onTitleChange, onDescriptionChange, onAttachmentsChange, onNotify
}, ref) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  useImperativeHandle(ref, () => ({ chooseFiles: () => inputRef.current?.click() }), [])
  const addFiles = (files: File[]): void => {
    if (disabled || attachmentsDisabled || !files.length) return
    const existing = new Set(attachments
      .filter((attachment): attachment is Extract<MissionDraftAttachment, {kind: 'local'}> => attachment.kind === 'local')
      .map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`))
    const unique = files.filter(file => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
    const remaining = 10 - attachments.length
    if (remaining <= 0) { onNotify('使命附件最多 10 个。'); return }
    const accepted = unique.slice(0, remaining).map(file => ({ kind: 'local' as const, id: newCommandId(), file }))
    if (accepted.length) onAttachmentsChange([...attachments, ...accepted])
    if (unique.length > accepted.length) onNotify('使命附件最多 10 个。')
    else if (!accepted.length) onNotify('这些文件已经添加。')
  }
  const withFiles = (event: DragEvent<HTMLElement>): boolean => Array.from(event.dataTransfer.types).includes('Files')
  return <section className="mission-editor-writing-plane"
    onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); addFiles(files) } }}
    onDragEnter={event => { if (!withFiles(event)) return; event.preventDefault(); if (disabled || attachmentsDisabled) return; dragDepth.current += 1; setDragging(true) }}
    onDragOver={event => { if (!withFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = disabled || attachmentsDisabled ? 'none' : 'copy' }}
    onDragLeave={event => { if (!withFiles(event)) return; event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
    onDrop={event => { if (!withFiles(event)) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(Array.from(event.dataTransfer.files)) }}>
    <label className="sr-only" htmlFor="mission-editor-title">使命名称</label>
    <input ref={titleInputRef} id="mission-editor-title" className="mission-editor-title" aria-label="使命名称" placeholder="使命名称" autoComplete="off" value={title} disabled={disabled} aria-invalid={!!titleError} onChange={event => onTitleChange(event.target.value)}/>
    {!!attachments.length && <div className="mission-editor-attachments" role="group" aria-label="使命附件">
      {attachments.map((attachment, index) => <MissionAttachmentItem key={attachmentIdentity(attachment)} attachment={attachment} mission={mission} disabled={disabled || attachmentsDisabled} onNotify={onNotify} onRemove={() => onAttachmentsChange(attachments.filter((_, candidate) => candidate !== index))}/>) }
    </div>}
    <label className="sr-only" htmlFor="mission-editor-description">使命描述</label>
    <textarea id="mission-editor-description" className="mission-editor-description" aria-label="使命描述" placeholder="告诉队员，这次要完成什么…" spellCheck={false} value={description} disabled={disabled} aria-invalid={!!descriptionError} onChange={event => onDescriptionChange(event.target.value)}/>
    {(titleError || descriptionError) && <p className="mission-editor-field-error" role="alert">{titleError || descriptionError}</p>}
    {dragging && <div className="mission-editor-drop-overlay"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/></svg><span>松开以添加到使命</span></div></div>}
    <input ref={inputRef} type="file" multiple hidden disabled={disabled || attachmentsDisabled} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }}/>
  </section>
})
MissionWritingPlane.displayName = 'MissionWritingPlane'

export function MissionAttachmentButton({ onClick, disabled }: {onClick(): void; disabled: boolean}): React.JSX.Element {
  return <button type="button" className="mission-editor-icon-button" aria-label="添加附件" title="添加附件 · 支持粘贴或拖入" onClick={onClick} disabled={disabled}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 13.5 7-7a3 3 0 0 1 4.25 4.25l-9 9a5 5 0 0 1-7.08-7.08l9-9"/><path d="m16 10-7 7a2 2 0 0 1-2.83-2.83l7-7"/></svg>
  </button>
}

type MissionPropertyChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode
  children: ReactNode
  locked?: boolean
}

export const MissionPropertyChip = forwardRef<HTMLButtonElement, MissionPropertyChipProps>(function MissionPropertyChip({ icon, children, locked = false, disabled = false, className = '', onClick, ...buttonProps }, ref) {
  return <button ref={ref} {...buttonProps} type="button" className={`mission-editor-property${locked ? ' is-locked' : ''}${className ? ` ${className}` : ''}`} disabled={disabled || locked} onClick={locked ? undefined : onClick}>
    {icon}<span className="mission-editor-property-copy">{children}</span>{locked ? <svg className="mission-editor-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg> : <DialogControlIcon name="chevron"/>}
  </button>
})

export function MissionTagPicker({ tags, catalog, disabled, onChange }: {
  tags: string[]
  catalog: string[]
  disabled: boolean
  onChange(tags: string[]): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const normalized = query.trim().replace(/\s+/g, ' ')
  const all = useMemo(() => [...new Set([...catalog, ...tags])].sort((a, b) => a.localeCompare(b, 'zh-CN')), [catalog, tags])
  const found = all.filter(tag => tag.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()))
  const exact = all.some(tag => tag.toLocaleLowerCase() === normalized.toLocaleLowerCase())
  const tooLong = [...normalized].length > 24
  const toggle = (tag: string): void => onChange(tags.includes(tag) ? tags.filter(candidate => candidate !== tag) : [...tags, tag])
  const create = (): void => {
    if (!normalized || exact || tooLong || tags.length >= 30) return
    onChange([...tags, normalized]); setQuery('')
  }
  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery('') }}>
    <Popover.Trigger asChild><MissionPropertyChip icon={<TagMark tag={tags[0] ?? '使命标签'}/>} disabled={disabled}>{tags.length ? tags.join('、') : '添加标签'}</MissionPropertyChip></Popover.Trigger>
    <Popover.Portal><Popover.Content className="compact-menu mission-editor-tag-popover" align="start" sideOffset={6} collisionPadding={12}>
      <label className="mission-tag-search"><NavigationIcon name="search"/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索或新建标签" placeholder="搜索或新建标签…" onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); create() } }}/></label>
      <div className="mission-tag-options" role="group" aria-label="可选标签">
        {found.map(tag => <button type="button" className="compact-option" key={tag} role="checkbox" aria-checked={tags.includes(tag)} onClick={() => toggle(tag)}><TagMark tag={tag}/><span>{tag}</span>{tags.includes(tag) && <Icon name="check"/>}</button>)}
        {normalized && !exact && <button type="button" className="compact-option" onClick={create} disabled={tooLong || tags.length >= 30}><Icon name="plus"/><span>新建“{normalized}”</span></button>}
        {tooLong && <p className="compact-inline-error" role="alert">标签最多 24 个字符。</p>}
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

export function ProjectGlyph(): React.JSX.Element { return <NavigationIcon name="folder-open"/> }
export function TeamGlyph(): React.JSX.Element { return <NavigationIcon name="users"/> }
