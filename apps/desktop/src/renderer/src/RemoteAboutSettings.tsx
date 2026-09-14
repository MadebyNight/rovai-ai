import { useEffect, useState } from 'react'
import { useCampClient } from './camp-client'
import { SettingsPageHeader } from './SettingsPageHeader'

// A remote browser cannot drive the native Desktop updater. Server updates use
// the existing native installer; no simulated download/restart state is exposed.
export function RemoteAboutSettings(): React.JSX.Element {
  const client = useCampClient()
  const desktopHosted = Boolean(client.channels)
  const [version, setVersion] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    void client.request<{ version: string }>('app.info').then(info => { if (current) setVersion(info.version) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [client])
  return <section className="remote-about-settings">
    <SettingsPageHeader eyebrow="Settings / About" title={desktopHosted ? '关于' : '关于与更新'} description="Rovai AI" />
    <div className="about-identity">
      <svg className="about-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 13.16 7.3 17.76 8.84 13.16 10.38 12 15.68 10.84 10.38 6.24 8.84 10.84 7.3Z" fill="currentColor"/><path d="M3 20.96Q12 15.96 21 20.96" fill="none" stroke="currentColor" strokeWidth="2.08" strokeLinecap="round"/></svg>
      <div><strong>Rovai AI</strong><p>{version ? `版本 ${version}` : failed ? '版本暂不可用' : '读取版本…'} · {desktopHosted ? 'Desktop' : 'Server'}</p></div>
    </div>
    {!desktopHosted && <section className="server-update-entry" aria-labelledby="server-update-title">
      <h2 id="server-update-title">Server 更新</h2>
      <p>在运行 Server 的电脑上，使用原生安装器更新，再以原数据目录启动。</p>
      <a className="quiet-button" href="https://github.com/murray17/rovai-ai/blob/main/docs/development/server-preview.md#安装和启动" target="_blank" rel="noopener noreferrer">查看安装与更新方法 ↗</a>
    </section>}
  </section>
}
