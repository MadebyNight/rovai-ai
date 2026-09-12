import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { PanelToggleIcon } from './PanelToggleIcon'
import { clampNavigationWidth, navigationDragLayout, navigationMaxWidth, parseNavigationLayout, NAVIGATION_DEFAULT_WIDTH, NAVIGATION_LAYOUT_KEY, NAVIGATION_MIN_WIDTH, type NavigationLayout } from './navigation-layout'

const NavigationContext = createContext(false)
export const useNavigationCollapsed = (): boolean => useContext(NavigationContext)

// Layout state stays below App so resizing does not rebuild the Camp or Composer children.
export function NavigationShell({ platform, disabled = false, className = '', children, ...attributes }: HTMLAttributes<HTMLDivElement> & {
  platform: NodeJS.Platform
  disabled?: boolean
}): React.JSX.Element {
  const [layout, setLayout] = useState<NavigationLayout>(() => {
    try { return parseNavigationLayout(window.localStorage.getItem(NAVIGATION_LAYOUT_KEY)) }
    catch { return parseNavigationLayout(null) }
  })
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth)
  const [resizing, setResizing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null)
  const handle = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ id: number; x: number; width: number; before: NavigationLayout; moved: boolean } | null>(null)
  const frame = useRef<number | null>(null)
  const maximum = navigationMaxWidth(viewport)
  const width = layout.collapsed ? 0 : clampNavigationWidth(layout.width, maximum)
  const label = layout.collapsed ? '展开导航侧栏' : '收起导航侧栏'
  const toggle = (): void => setLayout(current => ({ ...current, collapsed: !current.collapsed }))
  const resizeTo = (value: number): void => setLayout({ width: clampNavigationWidth(value, maximum), collapsed: false })
  const cancelFrame = (): void => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null }
  const finish = (cancel = false): void => {
    const active = gesture.current
    if (!active) return
    cancelFrame(); gesture.current = null
    if (cancel) setLayout(active.before)
    setResizing(false)
    if (handle.current?.hasPointerCapture(active.id)) handle.current.releasePointerCapture(active.id)
  }
  const resizeAt = (clientX: number): void => {
    const active = gesture.current
    if (active) setLayout(navigationDragLayout(active.width + clientX - active.x, active.before, navigationMaxWidth(window.innerWidth)))
  }
  useLayoutEffect(() => {
    setChromeSlot(platform === 'win32' ? document.getElementById('navigation-chrome-toggle-slot') : null)
  }, [platform])
  useEffect(() => {
    const resize = (): void => { finish(true); setViewport(window.innerWidth) }
    const cancel = (): void => finish(true)
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel() } }
    window.addEventListener('resize', resize); window.addEventListener('blur', cancel); window.addEventListener('keydown', escape)
    return () => { cancelFrame(); window.removeEventListener('resize', resize); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => {
    if (resizing) return
    try { window.localStorage.setItem(NAVIGATION_LAYOUT_KEY, JSON.stringify(layout)) } catch { /* Preferences may be unavailable; in-window layout still works. */ }
  }, [layout, resizing])
  useEffect(() => { if (disabled) { finish(true); setMenuOpen(false) } }, [disabled])
  const control = <button className="navigation-collapse-button" type="button" disabled={disabled} title={label} aria-label={label} aria-expanded={!layout.collapsed} aria-controls="global-navigation" onClick={toggle}>
    <PanelToggleIcon side="left" visible={!layout.collapsed} />
  </button>
  const shellStyle = useMemo(() => ({ ...attributes.style, '--rail-width': `${width}px` }) as CSSProperties, [attributes.style, width])
  return <NavigationContext.Provider value={layout.collapsed}>
    <div {...attributes} className={`app-shell navigation-shell ${className}${layout.collapsed ? ' navigation-collapsed' : ''}${resizing ? ' navigation-resizing' : ''}`} style={shellStyle}>
      {platform === 'win32' ? chromeSlot && createPortal(control, chromeSlot) : <div className="navigation-macos-control">{control}</div>}
      {children}
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          <div ref={handle} className="navigation-resize-handle" role="separator" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
            aria-label="导航侧栏宽度" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={width}
            aria-valuetext={layout.collapsed ? '已完全收起' : `${width} 像素`} aria-controls="global-navigation" aria-describedby="navigation-resize-help"
            title="拖动调宽，低于 200px 完全收起；双击复位；右键选择宽度"
            onPointerDown={event => {
              event.preventDefault()
              if (disabled || event.button !== 0 || !event.isPrimary || gesture.current) return
              event.currentTarget.setPointerCapture(event.pointerId)
              gesture.current = { id: event.pointerId, x: event.clientX, width, before: layout, moved: false }
              setResizing(true)
            }}
            onPointerMove={event => {
              const active = gesture.current
              if (!active || active.id !== event.pointerId || (!active.moved && Math.abs(event.clientX - active.x) < 3)) return
              active.moved = true
              const x = event.clientX
              cancelFrame(); frame.current = requestAnimationFrame(() => { frame.current = null; resizeAt(x) })
            }}
            onPointerUp={event => {
              const active = gesture.current
              if (!active || active.id !== event.pointerId) return
              if (active.moved || Math.abs(event.clientX - active.x) >= 3) resizeAt(event.clientX)
              finish()
            }}
            onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
            onDoubleClick={() => { if (!disabled) resizeTo(NAVIGATION_DEFAULT_WIDTH) }}
            onContextMenu={event => { event.preventDefault(); if (!disabled) setMenuOpen(true) }}
            onKeyDown={event => {
              if (disabled || event.nativeEvent.isComposing || gesture.current) { event.preventDefault(); return }
              const step = event.shiftKey ? 40 : 10
              switch (event.key) {
                case 'ArrowLeft': if (!layout.collapsed) setLayout(navigationDragLayout(width - step, layout, maximum)); break
                case 'ArrowRight': resizeTo(layout.collapsed ? layout.width : width + step); break
                case 'Home': resizeTo(NAVIGATION_MIN_WIDTH); break
                case 'End': resizeTo(maximum); break
                case 'Enter': toggle(); break
                default: return
              }
              event.preventDefault()
            }} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="sidebar-action-menu" side="right" sideOffset={4} collisionPadding={8}>
          {[[200, '紧凑宽度'], [270, '默认宽度'], [360, '宽侧栏']].map(([value, text]) => <DropdownMenu.Item key={value} className="sidebar-action-menu-item" onSelect={() => resizeTo(Number(value))}>{text}</DropdownMenu.Item>)}
          <DropdownMenu.Separator className="sidebar-action-menu-separator" />
          <DropdownMenu.Item className="sidebar-action-menu-item" onSelect={toggle}>{label}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span id="navigation-resize-help" className="sr-only">方向键调宽，Shift 加速，Home 最窄，End 最宽，Enter 折叠，空格选择宽度。低于 200 像素完全收起；从左边缘拖出恢复。Escape 取消拖拽。</span>
    </div>
  </NavigationContext.Provider>
}
