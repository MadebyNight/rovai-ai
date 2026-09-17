import { describe, expect, it } from 'vitest'
import { missionAttachmentDrafts, missionLocalAttachmentView, type MissionDraftAttachment } from './MissionDefinitionEditor'
import { attachmentFormatLabel } from './attachment-presentation'

describe('Mission attachment presentation', () => {
  it('preserves a dragged directory hint for retry and presents it as DIR', () => {
    const file = new File([], '需求资料')
    const attachment: MissionDraftAttachment = {
      kind: 'local',
      id: 'mission-directory',
      file,
      kindHint: 'directory'
    }

    expect(missionAttachmentDrafts([attachment])).toEqual([{
      id: 'mission-directory',
      file,
      kindHint: 'directory'
    }])
    const view = missionLocalAttachmentView(attachment)
    expect(view).toEqual({
      id: 'mission-directory',
      displayName: '需求资料',
      kind: 'directory',
      fileCount: null,
      mediaType: 'inode/directory',
      byteSize: null,
      previewKind: 'none',
      availability: 'unknown'
    })
    expect(attachmentFormatLabel(view.displayName, view.kind)).toBe('DIR')
  })
})
