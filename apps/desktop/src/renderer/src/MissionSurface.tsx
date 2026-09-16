import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'

const WIDTH_KEY = 'rovai.mission-drawer-width'
const minimum = 640
const snapGap = 48
const clamp = (value: number, available: number) => Math.max(Math.min(minimum, available), Math.min(value, available))

export function MissionSurface({ enabled = true, full, onExpand, onClose, children }: {
  enabled?: boolean; full: boolean; onExpand(): void; onClose(): void; children: ReactNode
}) {
  const root = useRef<HTMLElement>(null), handle = useRef<HTMLDivElement>(null)
  const preferred = useRef<number | null>(null)
  const [available, setAvailable] = useState(1170)
  const [width, setWidth] = useState(1040)
  const [dragging, setDragging] = useState(false), [armed, setArmed] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const gesture = useRef<{ id: number; before: number; width: number; moved: boolean; x: number; available: number; scale: number; right: number } | null>(null)
  const onExpandRef = useRef(onExpand); onExpandRef.current = onExpand
  function save(value: number) {
    preferred.current = value
    try { localStorage.setItem(WIDTH_KEY, String(value)) } catch {}
  }
  function finish(cancel = false) {
    const current = gesture.current
    if (!current) return
    gesture.current = null; setDragging(false); setArmed(false)
    document.documentElement.classList.remove('mission-drawer-resizing')
    if (handle.current?.hasPointerCapture(current.id)) handle.current.releasePointerCapture(current.id)
    if (cancel) { setWidth(current.before); return }
    if (current.moved && current.width >= current.available - snapGap) {
      setWidth(current.before); onExpandRef.current()
    } else { setWidth(current.width); if (current.moved) save(current.width) }
  }
  useLayoutEffect(() => {
    const shell = root.current?.closest<HTMLElement>('.navigation-shell')
    if (!shell) return
    try { const stored = Number(localStorage.getItem(WIDTH_KEY)); if (stored >= minimum) preferred.current = stored } catch {}
    const measure = () => {
      if (gesture.current) finish(true)
      const rail = parseFloat(getComputedStyle(shell).getPropertyValue('--rail-width')) || 0
      const next = Math.max(1, shell.clientWidth - rail)
      setAvailable(next)
      setWidth(clamp(preferred.current ?? Math.min(1040, next - 64), next - snapGap - 1))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    const nav = document.getElementById('global-navigation'); if (nav) observer.observe(nav)
    measure()
    return () => { observer.disconnect(); document.documentElement.classList.remove('mission-drawer-resizing') }
  }, [enabled])
  useEffect(() => {
    const cancel = () => finish(true)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopImmediatePropagation(); finish(true) }
    }
    window.addEventListener('blur', cancel); window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape, true) }
  }, [])
  function resize(clientX: number) {
    const current = gesture.current
    if (!current || (!current.moved && Math.abs(clientX - current.x) < 3)) return
    current.moved = true
    current.width = clamp((current.right - clientX) / current.scale, current.available)
    setWidth(current.width); setArmed(current.width >= current.available - snapGap)
  }
  function chooseWidth(value: number) { const next = clamp(value, available - snapGap - 1); save(next); setWidth(next) }
  if (!enabled) return <div className="ordinary-workspace-host">{children}</div>
  return <section ref={root} className={`${full ? 'mission-full mission-workspace-host' : 'mission-drawer mission-workspace-host'}${dragging ? ' is-resizing' : ''}${armed ? ' is-expand-armed' : ''}`}
    style={{ '--mission-drawer-width': `${width}px` } as React.CSSProperties}
    role={full ? undefined : 'dialog'} aria-modal={full ? undefined : false} aria-label={full ? undefined : '使命会话'}
    onKeyDown={event => { if (!full && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose() } }}>
    {!full && <>
      <div ref={handle} className="mission-drawer-resize-handle" role="separator" tabIndex={0} aria-label="调整使命抽屉宽度" aria-orientation="vertical"
        aria-valuemin={Math.min(minimum, available)} aria-valuemax={available} aria-valuenow={Math.round(width)} aria-valuetext={armed ? '松开展开为完整会话' : `${Math.round(width)} 像素`}
        aria-describedby="mission-drawer-resize-help" title="拖动调整宽度，拖到左侧展开；双击展开；右键选择宽度"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || gesture.current) return
          event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId)
          const shell = root.current!.closest<HTMLElement>('.navigation-shell')!, rect = shell.getBoundingClientRect()
          gesture.current = { id: event.pointerId, before: width, width, moved: false, x: event.clientX, available, scale: rect.width / shell.clientWidth, right: rect.right }
          setDragging(true); document.documentElement.classList.add('mission-drawer-resizing')
        }} onPointerMove={event => { if (gesture.current?.id === event.pointerId) resize(event.clientX) }}
        onPointerUp={event => { if (gesture.current?.id !== event.pointerId) return; resize(event.clientX); finish() }}
        onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} onDoubleClick={onExpand}
        onContextMenu={event => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: event.clientX || rect.right, y: event.clientY || 54 }) }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === 'End') { event.preventDefault(); onExpand(); return }
          if (event.key === 'Home') { event.preventDefault(); chooseWidth(minimum); return }
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          const next = width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 80 : 32)
          if (next >= available - snapGap) onExpand(); else chooseWidth(next)
        }}>
        {armed && <span className="mission-drawer-expand-tip">松开展开为完整会话</span>}
      </div>
      <span className="sr-only" id="mission-drawer-resize-help">左右方向键调整宽度，Shift 加速；Enter 或 End 展开；Home 最小宽度；拖动时 Escape 取消。</span>
      <span className="sr-only" role="status">{armed ? '松开展开为完整会话' : ''}</span>
      <Menu.Root open={!!menu} onOpenChange={open => { if (!open) setMenu(null) }}><Menu.Trigger asChild><span className="attachment-context-anchor" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}/></Menu.Trigger><Menu.Portal><Menu.Content className="compact-menu" aria-label="使命抽屉宽度" side="right" align="start" collisionPadding={10} onCloseAutoFocus={event => { event.preventDefault(); handle.current?.focus({ preventScroll: true }) }}>
        {([['紧凑', 640], ['适中', 880], ['宽敞', 1040]] as const).map(([label, size]) => <Menu.Item className="compact-option" key={size} onSelect={() => chooseWidth(size)}>{label}</Menu.Item>)}
        <Menu.Separator className="compact-separator"/><Menu.Item className="compact-option" onSelect={onExpand}>展开为完整会话</Menu.Item>
      </Menu.Content></Menu.Portal></Menu.Root>
    </>}
    {children}
  </section>
}
