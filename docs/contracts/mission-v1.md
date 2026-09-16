---
document_type: protocol-contract
contract: mission-v1
authority: mission-lifecycle-workspace-and-delivery
status: accepted
version: 1
last_updated: 2026-09-15
---

# Mission v1

## Identity and lifecycle

A Mission owns a stable `rvm_<UUIDv7>` identity and exactly one main public Camp. Its definition is
`missionId`, `title`, `description`, `status`, and nullable `sourceMessageId`. Status is one of
`needs_you`, `not_started`, `in_progress`, `completed`; it is independent of Task and AgentRun status.
The main Camp owns membership, lead, messages, drafts, execution, attachments and unread state.
There is no ordinary-Camp conversion operation. Mission Camps are excluded from ordinary navigation.

Saving atomically creates an active Camp and a `not_started` Mission. It does not create a Run, Git
branch or worktree. Start is a user command: after execution admission it sets `in_progress` and
persists a public commission message with an immutable title/description snapshot. An already active
queued/running/waiting Run prevents a duplicate commission. A replay uses the same command result.
Ordinary messages retain ordinary input semantics and can schedule Runs without changing Mission status.

All current Camp members and the user may edit title/description/status. There is no lead-only policy
or model-visible revision. Patches preserve omitted fields; the last committed edit wins on a shared
field. Equal values are a no-op. Definition, tags, roster, lead and status changes do not schedule or
cancel execution. Completed Missions retain their workspaces and running Agents.

Agent transitions to `needs_you` or `completed` require `sourceMessageId`: an existing, non-tombstoned,
durably published message in the same public Camp. Publish the complete explanation first, then set
status using its ID. Retrying status does not require publishing the explanation again. Manual user
status changes may omit the source. Status changes never substitute for a public answer.

Title is 1–200 Unicode scalars after trimming; description is at most 12,000. User tags are trimmed,
case-insensitively deduplicated, at most 30 entries and 24 scalars each. User PR associations accept
HTTP(S) URLs without embedded credentials. Activity stores actual definition/status/roster/lead/PR
changes. Historical commission cards are never regenerated from the latest definition.

## Workspace preparation

Only Core prepares the workspace, when an admitted Run receives an execution opportunity and enters
preparing. Queue admission and context preflight perform no worktree filesystem mutation. The claim
rechecks cancellation, membership, configuration, execution and budget fences after preparation.

For Git projects, resolve the selected starting ref to a commit once and retain that `base_sha`.
Create branch `rovai/mission/<mission_id>` and sibling directory `<repo>-mission-<mission_id>` from
that commit, without copying dirty files from the original project. A project subdirectory maps to
the same relative subdirectory in the repository-wide worktree. Parent/child Missions remain siblings.
If either path or branch is occupied, try the paired suffix `-2`, `-3`, etc. A creation race is retried
only when it is a name collision; other errors are explicit.

Persist the plan and an ownership token before Git side effects. Core uses private staging to recover
an interrupted creation and verifies Git common directory, registration, path and its ownership marker
before moving/reusing/removing the worktree. A matching name alone never proves ownership. Subsequent
Runs, recovery and member changes use the recorded path/branch; `base_sha` never moves. A missing or
invalid associated workspace is an error, not an instruction to create another copy.

Non-Git projects use the configured original directory. They have no Mission branch, Git Diff or saved
content baseline. A missing Git executable in a Git project is an explicit failure, not a non-Git fallback.
Every Git command uses the execution Host's resolved absolute executable path.

Mission completion, Run termination and archive keep the workspace. User deletion first settles/stops
users of the Camp, then deletes the Camp/Mission and cleans the verified associated worktree and Git
registration. Branches remain. Independent cleanup records survive cascading deletion and restart;
failures remain visible and retryable. Cleanup never deletes unrelated paths or prunes other registrations.

## Cumulative changes

The comparison is always fixed `base_sha` versus current worktree content: committed, staged and
unstaged changes form one final net result. Reverting content to the base removes that difference.
Each query uses a private temporary index, copies the actual index, registers untracked non-ignored
files with intent-to-add, then invokes Git Diff. The real index and HEAD are not mutated. Git exclusions
apply to untracked files; tracked files remain part of the comparison.

Overview returns opaque file ID, path/old path, kind, line counts, binary flag and old/new Git mode.
Single-file Diff is loaded on demand with hunks and line numbers. Renames, deletions, type changes and
Git executable-bit changes are retained; arbitrary filesystem permission/ACL changes are outside Git's
contract. Binary files have file-level records without ordinary text hunks. No complete patch history or
per-Turn snapshots are stored. Missing Git/worktree/base, unreadable output, or a disappeared file returns
an explicit reason, never a false empty Diff.

## Surfaces

Desktop and wide Web share `missions.list|get|activity|delivery|changes|fileDiff`, user commands
`missions.create|update|status|start|linkPr`, and orphan cleanup `missions.cleanup.list|retry`.
User commands use the existing command envelope and receipts. Deletion uses `camps.delete`.
Delivery includes current directory, Git association, linked PRs, and same-Camp available Agent-published
files with their source message. It never manufactures files from narrative claims.

Agent CLI exposes only `mission get|update|status` in the authenticated current public Camp, with no
Mission selector, workspace or version. Private Single Chat and stale/removed membership are rejected.
See [Transport v26](builtin-tool-transport-v26.md), [context evidence v25](context-manifest-evidence-v25.md)
and the [desktop UI contract](../ui/components/mission-board.md). Mobile has no Mission entry in v1.

Migration 157 upgrades either admitted v1.59/schema 106 predecessor to schema 107, adding any missing
definition, activity, commission, PR, Host/workspace association, cleanup records and context workspace
evidence. Existing business data and frozen context bytes are retained; no workspace is created during migration.
