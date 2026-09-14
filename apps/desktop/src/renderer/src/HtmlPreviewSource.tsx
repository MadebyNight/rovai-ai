import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'
import { useEffect } from 'react'
import type { ResolvedFilePreview, ResolvedTheme } from '@contracts'
import { ReadonlyCodeViewer } from './ReadonlyCodeViewer'

/** Source requests and loaded pages belong to the preview session. */
export function HtmlPreviewSource({ file, theme, tab }: {
  file: ResolvedFilePreview; theme: ResolvedTheme; tab: FilePreviewTabModel
}): React.JSX.Element {
  const { loadHtmlSource, isCurrentCamp, activeTabId, paneVisible } = useFilePreview()
  const source = tab.htmlSource
  const visible = isCurrentCamp !== false && paneVisible && activeTabId === tab.id
  useEffect(() => { if (visible && !source) void loadHtmlSource(tab.id).catch(() => undefined) }, [visible, tab.id, file.handleId, file.contentGeneration, source, loadHtmlSource])
  if (!source) return <div className="file-preview-loading" role="status">正在读取源码…</div>
  return <div className="file-preview-html-source">
    <ReadonlyCodeViewer fileName={file.fileName} text={source.text} startLine={source.page?.startLine} theme={theme} findScopeLabel={source.page ? '当前页源码' : 'HTML 源码'} />
    {source.page && <footer className="file-preview-page-controls"><span>第 {source.page.startLine} 行起</span><div>
      <button type="button" disabled={source.index === 0} onClick={() => void loadHtmlSource(tab.id, source.index - 1)}>上一页</button>
      <button type="button" disabled={!source.page.hasNext} onClick={() => void loadHtmlSource(tab.id, source.index + 1)}>下一页</button>
    </div></footer>}
  </div>
}
