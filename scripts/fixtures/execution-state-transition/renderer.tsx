import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdapterInstallation, CampSnapshot, ExecutionConsolePlacement } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { CampWorkspace, type CampInspectorTab } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { CampClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { MobileLayoutProvider, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { createReviewModel } from '../host-web-parity/model'
import { agents, initial, initialDraft, installations, now, run } from '../host-web-parity/data'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'

type Phase = 'connecting' | 'thinking' | 'body' | 'tools'
declare global {
  interface Window {
    executionTransition: { setPhase(phase: Phase): void }
  }
}
const params = new URL(location.href).searchParams
const mode = params.get('mode') ?? 'bottom'
document.documentElement.dataset.theme = params.get('theme') ?? 'day'
const model = createReviewModel('web', 'running')

function Fixture() {
  const mobile = useMobileViewport(mode === 'mobile')
  const [phase, setPhase] = useState<Phase>('connecting')
  const [placement, setPlacement] = useState<ExecutionConsolePlacement>(mode === 'bottom' ? 'bottom' : 'inspector')
  const [inspector, setInspector] = useState<CampInspectorTab | null>(null)
  const [entry, setEntry] = useState<HTMLElement | null>(null)
  useEffect(() => { window.executionTransition = { setPhase } }, [])
  const snapshot = useMemo<CampSnapshot>(() => ({
    ...initial,
    agentRuns: [{
      ...run, status: phase === 'connecting' ? 'queued' : 'running',
      startedAt: phase === 'connecting' ? null : now,
      executionEvidenceCount: phase === 'body' ? 1 : phase === 'tools' ? 3 : 0
    }],
    executionEvidence: phase === 'body' ? [{
      ...model.get().snapshot.executionEvidence[0],
      payload: { itemId: 'first-narration', delta: '开始检查。' }
    }] : phase === 'tools' ? model.get().snapshot.executionEvidence : []
  }), [phase])
  return <MobileLayoutProvider value={mobile}><CampClientProvider client={model.client}>
    <div className="app-shell app-shell-camp" data-mobile-view={mobile ? 'camp' : undefined}>
      <aside className="unified-sidebar" aria-label="Fixture sidebar" />
      <AppHeader campTitle={snapshot.camp.title} contextLabel="Fixture" camp={snapshot} detailEntryHostRef={setEntry} onFocusApprovals={() => {}} />
      <main className="content task-content camp-content">
        <CampWorkspace snapshot={snapshot} projectName="Fixture" agents={agents} installations={installations as AdapterInstallation[]}
          initialComposerDraft={initialDraft} busy={false} onSend={model.send} onChangeLead={async () => {}}
          onTasksChanged={async () => {}} onResolveApproval={() => {}} stopping={false} onStop={() => {}}
          onCancelAgentRun={async () => {}} executionPlacement={placement}
          onExecutionPlacementChange={async next => { setPlacement(next); return next }}
          worldMapEnabled={false} inspectorVisible={inspector !== null} inspectorTab={inspector ?? 'members'}
          detailEntryHost={entry} onOpenInspector={setInspector} onCloseInspector={() => setInspector(null)}
          onInspectorTabChange={setInspector} onOpenSingleChat={() => {}} onConfigureRuntime={() => {}}
          onNotify={() => {}} onNotifyError={message => { throw Error(message) }} />
      </main>
    </div>
  </CampClientProvider></MobileLayoutProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
