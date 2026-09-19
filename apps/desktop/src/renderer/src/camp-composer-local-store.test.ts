import type { CampComposerDraftView, CampSnapshot } from '@contracts'
import { describe, expect, it } from 'vitest'
import {
  clearLocalCampComposerDraft,
  emptyLocalCampComposerDraft,
  loadLocalCampComposerDraft,
  materializeLocalContinuation,
  nextLocalCampComposerDraftAfterSend,
  saveLocalCampComposerDraft
} from './camp-composer-local-store'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const members = [
  {
    agentId: 'lead', displayName: '队长', isDefaultLead: true,
    membershipStatus: 'active', profilePresence: 'present'
  },
  {
    agentId: 'reviewer', displayName: '审查员', isDefaultLead: false,
    membershipStatus: 'active', profilePresence: 'present'
  }
] as CampSnapshot['members']

describe('local Camp Composer drafts', () => {
  it('keeps independent unsent state for each Camp and clears only the selected Camp', () => {
    const storage = new MemoryStorage()
    const campA: CampComposerDraftView = {
      ...emptyLocalCampComposerDraft('camp-a'),
      body: '@审查员 检查迁移',
      content: {
        version: 2,
        segments: [
          { kind: 'atom', atom: { type: 'member', agentId: 'reviewer' } },
          { kind: 'text', text: ' 检查迁移' },
          { kind: 'atom', atom: { type: 'skill', skillId: 'review', nameAtSend: 'review' } }
        ]
      },
      attachments: [{
        id: '11111111-1111-4111-8111-111111111111', displayName: 'schema.png', kind: 'file', fileCount: 1,
        mediaType: 'image/png', byteSize: 12, previewKind: 'image',
        availability: 'available', sourcePath: '/tmp/schema.png'
      }],
      quotes: [{
        version: 1,
        quoteId: 'quote-a',
        source: { scope: 'camp', campId: 'camp-a', messageId: 'message-quote' },
        authorAtCapture: { type: 'agent', agentId: 'reviewer', displayName: '审查员' },
        text: '先检查这一段',
        format: 'plain_text',
        capturedAt: '2026-09-19T08:00:00Z',
        sourceContentDigest: 'sha256:source',
        snapshotDigest: 'sha256:snapshot'
      }],
      replyIntent: {
        replyToCampMessageId: 'message-old', targetState: 'available',
        author: { authorType: 'agent', authorId: 'reviewer', displayName: '审查员', recipientAvailability: 'available' },
        excerpt: '旧消息', recipientSelectionRequired: false
      }
    }
    const campB = {
      ...emptyLocalCampComposerDraft('camp-b'),
      body: '另一个会话',
      content: { version: 2 as const, segments: [{ kind: 'text' as const, text: '另一个会话' }] }
    }
    saveLocalCampComposerDraft(campA, storage)
    saveLocalCampComposerDraft(campB, storage)

    expect(loadLocalCampComposerDraft('camp-a', storage)).toEqual(campA)
    expect(loadLocalCampComposerDraft('camp-b', storage)).toEqual(campB)

    clearLocalCampComposerDraft('camp-a', storage)
    expect(loadLocalCampComposerDraft('camp-a', storage)).toBeNull()
    expect(loadLocalCampComposerDraft('camp-b', storage)).toEqual(campB)
  })

  it('rejects malformed local records instead of partially restoring them', () => {
    const storage = new MemoryStorage()
    storage.setItem('rovai.camp-composer-draft.v1:camp-a', JSON.stringify({
      ...emptyLocalCampComposerDraft('camp-a'),
      content: { version: 2, segments: [{ kind: 'atom', atom: { type: 'member' } }] }
    }))
    expect(loadLocalCampComposerDraft('camp-a', storage)).toBeNull()
  })

  it('continues only the last accepted unique explicit non-Lead route', () => {
    const sent: CampComposerDraftView = {
      ...emptyLocalCampComposerDraft('camp-a', 4),
      body: '@审查员 检查迁移',
      content: {
        version: 2,
        segments: [
          { kind: 'atom', atom: { type: 'member', agentId: 'reviewer' } },
          { kind: 'text', text: ' 检查迁移' }
        ]
      }
    }
    const next = nextLocalCampComposerDraftAfterSend({
      sent,
      campMessageId: 'message-1',
      addressedAgentIds: ['reviewer'],
      members
    })
    expect(next.continuationIntent).toMatchObject({
      sourceCampMessageId: 'message-1',
      recipient: { agentId: 'reviewer', displayName: '审查员' }
    })

    const typed = {
      ...next,
      body: '还有数据库迁移也看看',
      content: { version: 2 as const, segments: [{ kind: 'text' as const, text: '还有数据库迁移也看看' }] }
    }
    const continued = materializeLocalContinuation(typed, members)
    expect(continued).toMatchObject({
      body: '@审查员 还有数据库迁移也看看',
    })
    expect(continued.content.segments[0]).toEqual({
      kind: 'atom', atom: { type: 'member', agentId: 'reviewer' }
    })

    const lead = {
      ...sent,
      content: { version: 2 as const, segments: [{ kind: 'atom' as const, atom: { type: 'member' as const, agentId: 'lead' } }] }
    }
    expect(nextLocalCampComposerDraftAfterSend({
      sent: lead, campMessageId: 'message-2', addressedAgentIds: ['lead'], members
    }).continuationIntent).toBeNull()
  })
})
