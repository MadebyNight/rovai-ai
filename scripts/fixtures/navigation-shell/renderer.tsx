import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NavigationShell } from '../../../apps/desktop/src/renderer/src/NavigationShell'
import { WindowsApplicationMenu } from '../../../apps/desktop/src/renderer/src/WindowsApplicationMenu'
import { CampNavigation } from '../../../apps/desktop/src/renderer/src/CampNavigation'
import { WindowDragStrip } from '../../../apps/desktop/src/renderer/src/App'
import '../../../apps/desktop/src/renderer/src/styles.css'

const noop = (): void => undefined
Object.assign(window, { rovai: { platform: 'win32', windowControls: { popupApplicationMenu: async () => undefined } } })
let renders = 0
function Content(): React.JSX.Element { renders++; return <textarea aria-label="保留的草稿" defaultValue="未发送内容" /> }
function Fixture(): React.JSX.Element {
  const [settings, setSettings] = useState(false)
  const [platform, setPlatform] = useState<'win32' | 'darwin'>('win32')
  const [disabled, setDisabled] = useState(false)
  document.documentElement.dataset.rovaiPlatform = platform
  Object.assign(window, { navigationTest: {
    renders: () => renders, setSettings, setPlatform, setDisabled,
    settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 90))))
  } })
  return <><WindowsApplicationMenu /><NavigationShell platform={platform} disabled={disabled}>
    <CampNavigation platform={platform} view={settings ? 'settings' : 'compose'} state="ready" navigation={null} activeCampId={null} pendingMemoryCount={0}
      onNewConversation={noop} onMembers={noop} onMemory={noop} onSettings={() => setSettings(true)} onSettingsBack={() => setSettings(false)}
      onOpenProject={noop} onCamp={noop} onRemoveProject={async () => undefined} onRename={async () => undefined} onDelete={async () => undefined} onError={noop} />
    <WindowDragStrip page={settings ? 'settings' : 'compose'} /><main className={`content task-content ${settings ? 'settings-content' : 'compose-content'}`}><Content /></main>
  </NavigationShell></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
