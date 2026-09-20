import { describe, expect, it } from 'vitest'
import { unreadMissionCount } from './useMissions'

describe('unreadMissionCount', () => {
  it('counts unread Mission replies independently of Mission status', () => {
    expect(unreadMissionCount([
      { status: 'needs_you', hasUnread: false },
      { status: 'running', hasUnread: true },
      { status: 'completed', hasUnread: true }
    ])).toBe(2)
  })
})
