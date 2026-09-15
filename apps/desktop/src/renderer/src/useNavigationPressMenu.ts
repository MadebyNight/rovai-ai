import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react'

type Pointer = { pointerId: number; pointerType: string; isPrimary: boolean; button: number; clientX: number; clientY: number }

// The same gesture governs project and conversation rows. It never activates a row.
export function createNavigationPressGesture(onOpen: () => void) {
  let pointer: Pointer | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let suppressClick = false
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pointer = null
  }
  return {
    cancel,
    start(event: Pointer): boolean {
      cancel()
      suppressClick = false
      if (!event.isPrimary || event.button !== 0 || !['touch', 'pen'].includes(event.pointerType)) return false
      pointer = event
      timer = setTimeout(() => {
        timer = null
        suppressClick = true
        onOpen()
      }, 480)
      return true
    },
    move(event: Pick<Pointer, 'pointerId' | 'clientX' | 'clientY'>): void {
      if (!pointer || event.pointerId !== pointer.pointerId) return
      if (Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > 10) {
        suppressClick = true
        cancel()
      }
    },
    openContext(): void {
      cancel()
      suppressClick = true
      onOpen()
    },
    consumeClick(): boolean {
      const suppressed = suppressClick
      suppressClick = false
      return suppressed
    }
  }
}

export function useNavigationPressMenu(enabled: boolean) {
  const [open, setOpen] = useState(false)
  const ignoreMenuRelease = useRef(false)
  const gesture = useMemo(() => createNavigationPressGesture(() => {
    ignoreMenuRelease.current = true
    setOpen(true)
  }), [])
  const stopWatching = useRef(() => {})
  const cancel = (): void => { gesture.cancel(); stopWatching.current() }

  useEffect(() => {
    if (!enabled) setOpen(false)
    return () => { gesture.cancel(); stopWatching.current() }
  }, [enabled, gesture])

  const rowProps: HTMLAttributes<HTMLButtonElement> = enabled ? {
    'aria-haspopup': 'menu',
    'aria-description': '长按或按 Shift+F10 显示操作',
    onPointerDown: event => {
      cancel()
      if (!gesture.start(event)) return
      const otherPointer = (next: PointerEvent): void => { if (!next.isPrimary) cancel() }
      document.addEventListener('scroll', cancel, true)
      document.addEventListener('visibilitychange', cancel)
      document.addEventListener('pointerdown', otherPointer, true)
      window.addEventListener('blur', cancel)
      stopWatching.current = () => {
        document.removeEventListener('scroll', cancel, true)
        document.removeEventListener('visibilitychange', cancel)
        document.removeEventListener('pointerdown', otherPointer, true)
        window.removeEventListener('blur', cancel)
      }
    },
    onPointerMove: event => gesture.move(event),
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: event => {
      if (gesture.consumeClick()) { event.preventDefault(); event.stopPropagation() }
    },
    onContextMenu: event => {
      event.preventDefault()
      cancel()
      gesture.openContext()
    },
    onKeyDown: event => {
      gesture.consumeClick()
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        cancel()
        setOpen(true)
      }
    }
  } : {}
  const menuProps: HTMLAttributes<HTMLDivElement> = {
    onPointerDownCapture: () => { ignoreMenuRelease.current = false; cancel() },
    onPointerUpCapture: event => {
      // Releasing the original long press must not select the item under the finger.
      if (ignoreMenuRelease.current) { event.preventDefault(); event.stopPropagation() }
      ignoreMenuRelease.current = false
      cancel()
    }
  }
  return { open, setOpen, rowProps, menuProps }
}
