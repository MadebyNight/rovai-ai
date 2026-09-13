import type { MemoryScopeKind, RestorableLocation, SettingsSection } from '@contracts'

export type MemoryNavigationTarget = {
  kind: 'memory'
  memoryId: string | null
  scope?: MemoryScopeKind
  governance?: 'all' | 'agent' | 'review' | 'stopped'
  search?: string
}

export type NavigationTarget = Exclude<RestorableLocation, { kind: 'memory' }>
  | MemoryNavigationTarget
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'automations' }

export type NavigationState = { entries: readonly NavigationTarget[]; index: number }
export const MAX_NAVIGATION_ENTRIES = 50

export function sameNavigationDestination(a: NavigationTarget, b: NavigationTarget): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'camp': return b.kind === 'camp' && a.campId === b.campId
    case 'settings': return b.kind === 'settings' && a.section === b.section
    case 'members': return b.kind === 'members' && a.agentId === b.agentId && a.tab === b.tab
    case 'memory': return b.kind === 'memory' && a.memoryId === b.memoryId
    default: return true
  }
}

export type NavigationTransaction = {
  isCurrent(): boolean
  /** Ends guarded waiting when a newer destination takes ownership. */
  superseded: Promise<void>
  /** Commit only after leave guards succeed, in the same turn as the page setters. */
  commit(target?: NavigationTarget): boolean
}

/** One window-owned history. Pending intent is transactional, never a second router history. */
export function createDesktopNavigation<Context = undefined>(
  apply: (target: NavigationTarget, transaction: NavigationTransaction, context?: Context) => Promise<void>
) {
  let state: NavigationState = { entries: [], index: -1 }
  let intent = state
  let generation = 0
  let supersede: (() => void) | undefined
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }

  const navigate = async (next: NavigationState, context?: Context): Promise<boolean> => {
    if (next === intent) return false
    intent = next
    const request = ++generation
    supersede?.()
    const superseded = new Promise<void>(resolve => { supersede = resolve })
    let committed = false
    const transaction: NavigationTransaction = {
      isCurrent: () => request === generation,
      superseded,
      commit: (target = next.entries[next.index]) => {
        if (request !== generation) return false
        const entries = [...next.entries]
        entries[next.index] = target
        state = intent = { entries, index: next.index }
        committed = true
        publish()
        return true
      }
    }
    try {
      await apply(next.entries[next.index], transaction, context)
      return committed && request === generation
    } finally {
      if (request === generation && !committed) intent = state
    }
  }

  return {
    getSnapshot: (): NavigationState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reset(target?: NavigationTarget): void {
      ++generation
      supersede?.()
      supersede = undefined
      state = intent = target ? { entries: [target], index: 0 } : { entries: [], index: -1 }
      publish()
    },
    push(target: NavigationTarget, context?: Context): Promise<boolean> {
      const current = state.entries[state.index]
      if (current && sameNavigationDestination(current, target)) {
        // Clicking the displayed page cancels an unfinished departure without adding a step.
        return intent === state ? Promise.resolve(false) : navigate(state, context)
      }
      // A superseded destination that never rendered must not become a phantom entry.
      const entries = [...state.entries.slice(0, state.index + 1), target].slice(-MAX_NAVIGATION_ENTRIES)
      return navigate({ entries, index: entries.length - 1 }, context)
    },
    replace(target: NavigationTarget, context?: Context): Promise<boolean> {
      const entries = [...intent.entries]
      const index = Math.max(0, intent.index)
      entries[index] = target
      return navigate({ entries, index }, context)
    },
    back(): Promise<boolean> {
      return intent.index > 0 ? navigate({ ...intent, index: intent.index - 1 }) : Promise.resolve(false)
    },
    forward(): Promise<boolean> {
      return intent.index < intent.entries.length - 1
        ? navigate({ ...intent, index: intent.index + 1 }) : Promise.resolve(false)
    }
  }
}

export type DesktopNavigation = ReturnType<typeof createDesktopNavigation>
