import { useLayoutEffect } from 'react'
import type { CampSnapshot, MissionRecord } from '@contracts'
import { AppHeader } from './AppHeader'
import { DialogControlIcon } from './AppDialog'
import { Icon } from './MissionControls'
import { useFilePreview } from './FilePreviewContext'

export function MissionHeader({ mission, drawer, projectName, camp, openRequest, onExpand, onFold, onClose, onFocusApprovals, detailEntryHostRef }: {
  mission: MissionRecord; drawer: boolean; projectName: string | null; camp: CampSnapshot; openRequest: number
  onExpand(): void; onFold(): void; onClose(): void; onFocusApprovals(): void
  detailEntryHostRef(host: HTMLDivElement | null): void
}): React.JSX.Element {
  const preview = useFilePreview()
  const activityTab = preview.tabs.find(tab => tab.kind === 'mission_activity')
  const activitySelected = preview.paneVisible && !!activityTab
  // Presentation changes do not remount this header or reset the selected tab.
  useLayoutEffect(() => { preview.openMissionActivity(mission.missionId) }, [mission.missionId, openRequest, preview.openMissionActivity])
  return <AppHeader campTitle={mission.title} contextLabel={projectName} camp={camp} detailEntryHostRef={detailEntryHostRef}
    onFocusApprovals={onFocusApprovals} hideTitle={drawer}
    leading={<div className="mission-session-leading">
      <button className="file-preview-toggle" aria-label={drawer ? '关闭使命抽屉' : '返回使命板'} title={drawer ? '关闭使命抽屉' : '返回使命板'} onClick={onClose}>
        {drawer ? <DialogControlIcon name="close"/> : <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 4-6 6 6 6M3 10h14"/></svg>}
      </button>
      <button className="file-preview-toggle" aria-label={drawer ? '展开为完整会话' : '折叠为使命抽屉'} title={drawer ? '展开为完整会话' : '折叠为使命抽屉'} onClick={drawer ? onExpand : onFold}>
        <Icon name={drawer ? 'expand' : 'collapse'}/>
      </button>
    </div>}
    conversationActions={<button className="mission-activity-entry" aria-pressed={activitySelected} onClick={() => {
      if (activitySelected && activityTab) preview.close(activityTab.id)
      else preview.openMissionActivity(mission.missionId)
    }}><Icon name="history"/><span>活动</span></button>}
  />
}
