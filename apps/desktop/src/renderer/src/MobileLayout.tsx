import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { NavigationIcon, type NavigationIconName } from './NavigationIcon'

// Presentation only. Host capabilities and editing identity still come from CampClient.
const MobileLayout = createContext(false)
const query = '(max-width: 767px), (max-width: 1039px) and (max-height: 560px) and (pointer: coarse)'
const subscribe = (notify: () => void): (() => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
export function useMobileViewport(enabled: boolean): boolean {
  const matches = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
  return enabled && matches
}
export const useMobileLayout = (): boolean => useContext(MobileLayout)

export function MobileLayoutProvider({ value, children }: { value: boolean; children: ReactNode }): React.JSX.Element {
  useEffect(() => {
    if (!value) return
    const root = document.documentElement
    root.dataset.mobileWeb = 'true'
    const update = (): void => {
      if (window.visualViewport && window.visualViewport.scale !== 1) return
      root.style.setProperty('--mobile-viewport-height', `${window.visualViewport?.height ?? window.innerHeight}px`)
      root.style.setProperty('--mobile-viewport-top', `${window.visualViewport?.offsetTop ?? 0}px`)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      delete root.dataset.mobileWeb
      root.style.removeProperty('--mobile-viewport-height')
      root.style.removeProperty('--mobile-viewport-top')
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [value])
  return <MobileLayout.Provider value={value}>{children}</MobileLayout.Provider>
}

export function MobileBack({ onClick, label = '返回' }: { onClick(): void; label?: string }): React.JSX.Element {
  return <button className="mobile-icon-button mobile-back" type="button" aria-label={label} onClick={onClick}><NavigationIcon name="arrow-left" /></button>
}

export type MobileRoot = 'compose' | 'members' | 'memory' | 'automations' | 'settings'
const roots: Array<{ view: MobileRoot; label: string; icon: NavigationIconName }> = [
  { view: 'compose', label: '对话', icon: 'messages' },
  { view: 'members', label: '队员', icon: 'users' },
  { view: 'memory', label: '记忆', icon: 'brain' },
  { view: 'automations', label: '定时', icon: 'calendar-clock' },
  { view: 'settings', label: '设置', icon: 'settings' }
]
export function MobileNavigation({ view, disabled, onNavigate }: { view: MobileRoot; disabled: boolean; onNavigate(view: MobileRoot): void }): React.JSX.Element {
  return <nav className="mobile-bottom-navigation" aria-label="主要页面">
    {roots.map(item => <button key={item.view} type="button" disabled={disabled} aria-current={view === item.view ? 'page' : undefined} onClick={() => onNavigate(item.view)}><NavigationIcon name={item.icon} /><span>{item.label}</span></button>)}
  </nav>
}
