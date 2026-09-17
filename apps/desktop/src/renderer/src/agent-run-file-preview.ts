import type { AgentRunExecutionEvidenceView, AgentRunFileChangesView } from '@contracts'
import type { FilePreviewContextValue } from './FilePreviewContext'

const CURRENT_FILE_OPEN_ERROR = '无法打开该文件'

export async function openAgentRunCurrentFilePreview({
  filePreview,
  campId,
  changes,
  evidenceFileId,
  onError
}: {
  filePreview: Pick<FilePreviewContextValue, 'open'> | null
  campId: string
  changes: AgentRunFileChangesView
  evidenceFileId: string
  onError(message: string): void
}): Promise<boolean> {
  const file = changes.files.find((candidate) => candidate.evidenceFileId === evidenceFileId)
  if (!filePreview || !file) {
    onError(CURRENT_FILE_OPEN_ERROR)
    return false
  }
  try {
    const outcome = await filePreview.open({
      kind: 'run_evidence',
      campId,
      agentRunId: changes.agentRunId,
      executionEpoch: changes.executionEpoch,
      evidenceFileId,
      action: 'open_current'
    }, undefined, { fileName: file.path }, { commitOnSuccess: true, previewOnly: true })
    if (outcome.kind === 'preview') return true
  } catch {
    // The public failure stays intentionally stable and does not expose host details.
  }
  onError(CURRENT_FILE_OPEN_ERROR)
  return false
}

export async function openAgentRunActivityFilePreview({
  filePreview,
  campId,
  evidence,
  path,
  onError
}: {
  filePreview: Pick<FilePreviewContextValue, 'open'> | null
  campId: string
  evidence?: Pick<AgentRunExecutionEvidenceView, 'agentRunId' | 'executionEpoch'> & {
    canonical?: {
      diffProjection?: { sourceEvidenceIds: string[] } | null
    } | null
  }
  path: string
  onError(message: string): void
}): Promise<boolean> {
  if (!filePreview) {
    onError(CURRENT_FILE_OPEN_ERROR)
    return false
  }
  try {
    const diffProjection = evidence?.canonical?.diffProjection
    const evidenceId = diffProjection?.sourceEvidenceIds[0]
    if (diffProjection && !evidenceId) {
      onError(CURRENT_FILE_OPEN_ERROR)
      return false
    }
    const request = evidence && evidenceId
      ? {
          kind: 'run_activity_file' as const,
          campId,
          agentRunId: evidence.agentRunId,
          executionEpoch: evidence.executionEpoch,
          evidenceId,
          rawReference: path
        }
      : { kind: 'camp_workspace' as const, campId, rawReference: path }
    const outcome = await filePreview.open(
      request,
      undefined,
      { fileName: path },
      { commitOnSuccess: true, previewOnly: true }
    )
    if (outcome.kind === 'preview') return true
  } catch {
    // The public failure stays intentionally stable and does not expose host details.
  }
  onError(CURRENT_FILE_OPEN_ERROR)
  return false
}
