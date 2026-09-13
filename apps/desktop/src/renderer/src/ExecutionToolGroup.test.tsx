import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompactionEventRow, ExecutionToolGroupStateContext, ToolActivityGroup, ToolCallRow } from './ExecutionToolGroup'
import type { ToolProgressItem } from './execution-tool-grouping'
import type { ActivityIconKind } from './ui-model'

const tool = (id: string, iconKind: ActivityIconKind, status: ToolProgressItem['step']['status']): ToolProgressItem => ({
  kind: 'tool', key: `tool:${id}`, step: {
    id, iconKind, status, title: `指令 ${id}`, publicCommand: null, publicResult: null,
    detail: `指令 ${id} 结果`, activityDomain: 'shell', toolName: null, credibility: 'runtime_structured'
  }
})
const renderGroup = (items: ToolProgressItem[], expanded = false, liveTail = false) => renderToStaticMarkup(
  <ExecutionToolGroupStateContext.Provider value={{
    expanded: new Set(expanded ? items.map(item => `run:${item.key}`) : []), change() {}
  }}>
    <ToolActivityGroup items={items} runId="run" runStatus="running" campId="camp" liveTail={liveTail}
      cancelling={false} completeEvidence={{ byToolId: new Map() }} onFileOpenError={() => {}} />
  </ExecutionToolGroupStateContext.Provider>
)

describe('command disclosure presentation', () => {
  it.each(['terminal', 'file-read', 'file-write', 'web'] as ActivityIconKind[])(
    'selects the same %s instruction for both the current title and icon', icon => {
      const markup = renderGroup([tool('old', 'terminal', 'completed'), tool('current', icon, 'running'), tool('later', 'unknown', 'completed')])
      expect(markup).toContain(`data-icon-domain="${icon}"`)
      expect(markup).toContain('data-text="指令 current"')
      expect(markup).not.toContain('<strong>执行中</strong>')
      expect(markup).not.toContain('tool-group-disclosure')
      expect(markup).not.toContain('tool-group-items')
    }
  )
  it('stops the group highlight on expansion and keeps child commands and results static', () => {
    const markup = renderGroup([tool('current', 'web', 'running')], true)
    expect(markup).not.toContain('running-text-highlight')
    expect(markup).toContain('command-expand-cue')
    expect(markup).toContain('tool-call-state status-running')
    expect(markup).not.toContain('tool-call-disclosure-slot')
  })
  it('keeps waiting, failed and stopped states static, and restores the completed group icon/count', () => {
    for (const status of ['waiting', 'failed', 'stopped', 'recorded', 'skipped'] as const) {
      expect(renderGroup([tool('current', 'terminal', status)])).not.toContain('running-text-highlight')
    }
    const settled = renderGroup([tool('one', 'file-read', 'completed'), tool('two', 'web', 'completed')])
    expect(settled).toContain('已完成 2 个步骤')
    expect(settled).toContain('tool-group-icon')
    expect(settled).toContain('tool-group-disclosure')
    expect(settled).not.toContain('tool-group-state')
    const provisional = renderGroup([tool('one', 'file-read', 'completed')], false, true)
    expect(provisional).toContain('data-icon-domain="file-read"')
    expect(provisional).toContain('data-text="指令 one"')
  })
  it('omits expansion cues on commands without detail and retains independent read-file buttons', () => {
    const step = { ...tool('read', 'file-read', 'completed').step, detail: '',
      shellReadSummary: { title: '阅读 a.ts，b.ts', paths: ['src/a.ts', 'src/b.ts'], displayPaths: ['a.ts', 'b.ts'] } }
    const markup = renderToStaticMarkup(<ToolCallRow campId="camp" step={step} runId="run" runStatus="running" onFileOpenError={() => {}} />)
    expect(markup).not.toContain('command-expand-cue')
    expect(markup.match(/class="tool-file-link shell-read-file-link"/g)).toHaveLength(2)
    expect(markup).toContain('打开文件预览：src/a.ts')
  })
  it('highlights only an active Compact and never infers completion from a finished Run', () => {
    for (const runStatus of ['running', 'waiting', 'succeeded', 'failed', 'cancelled'] as const) {
      const markup = renderToStaticMarkup(<CompactionEventRow campId="camp" runId="run" runStatus={runStatus}
        compaction={{ id: 'compact', phase: 'started', completionEvidence: null, adapterKind: 'codex-cli', tokens: {}, messages: {}, summaryText: null }} />)
      expect(markup.includes('running-text-highlight')).toBe(runStatus === 'running')
      expect(markup).not.toContain('status-completed')
      expect(markup).not.toContain('command-expand-cue')
      expect(markup).toContain('data-icon-domain="compaction"')
    }
  })
})
