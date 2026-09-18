---
document_type: architecture
authority: mission-architecture
status: accepted
last_updated: 2026-09-18
---

# Missions

Mission is the durable purpose of a public team Camp. Core owns its opaque identity, stable public number,
latest definition, independent business status, activity facts and execution workspace. Camp remains the sole owner of conversation, membership, lead,
drafts, published files and execution. Renderer does not create a parallel conversation model.

`MissionService` applies atomic commands through the existing gateway. The scheduler enters preparing
only after execution admission; the application coordinator then resolves or recovers the Mission workspace
outside the SQLite lock. It serializes preparation, explicit cleanup and deletion, persists association before
Git work, and rechecks claim fences before launching the Runtime. Non-Git projects retain their original cwd.
A worktree is retained throughout ordinary Mission use. Standalone cleanup records two foreground steps in its
existing association; a later preparing phase restores the branch/worktree according to actual resource state.

`MissionGit` reads the source checkout's current local branch and `HEAD` when the first admitted Run enters
preparing, and again only when both previously managed Git resources have been removed. It uses the resolved
commit, the Host-resolved Git executable and verified ownership to create, restore or clean worktrees. Cleanup
removes the verified worktree before conditionally deleting the local Mission branch at its captured OID.
It computes cumulative changes against a fixed initial commit with an independent temporary index. Opening
the cumulative-change browser establishes a bounded, expiring process-local snapshot containing the file-ID
to old/new-path mapping and that index. A single-file request resolves only through this snapshot and runs a
path-scoped Diff; it never rediscovers the full change list. Refresh replaces the snapshot, and closing the
browser releases it. Git and actual files are the authority, not Agent narratives. The worktree is an execution
location, not an Agent capability; the snapshot stores neither patch history nor historical file content.

User definition edits use an internal optimistic revision so stale dialogs cannot overwrite newer title or
description. Agent updates remain field patches with last-commit-wins semantics and never see that revision.
Only the latest title/description are retained; activity and start evidence keep field-change/reference facts,
not historical definition bodies. Each Agent conversation keeps the latest Mission detail version successfully
delivered to Runtime. After its first accepted Mission input, a newer definition adds one exact `updateNotice`
to Mission Run Facts until an input carrying that version is accepted. `mission get` is a pure read.

Mission keeps its shared UI projection path-free. The dedicated `MissionAgentInfo` projection is the only
seam that joins current definition fields with ordered `source_attachments[].source_path`; it is built only
after current-Run/current-member authorization for `mission get`. It does no filesystem observation, so
stored references remain discoverable even when the source later disappears. Built-in invocation evidence
continues to project definition facts without the raw attachment paths.

The opaque ID remains the relational key. A monotonic integer is the human/Git naming identity: UI renders
`M-018`, while the paired branch and sibling worktree use `rovai/mission/018` and `<repo>-mission-018`.
Deleted numbers are never reused; collision suffixes do not change the number. Context materialization projects compact identity/status and trusted start intent. The actual workspace
snapshot has its own dynamic section and acceptance marker, fenced to the native binding/generation.
No Mission business version is taught to Agents; field patches use last-committed values.

Desktop/wide Web share Mission navigation and the existing CampWorkspace. Drawer and full conversation
preserve one mounted composer/preview owner. Mobile is intentionally outside this increment. Renderer consumes
Core's cleanup capability and does not infer it from Mission status. Deletion defaults to leaving worktree and
branch in place; optional cleanup must finish before the Mission is deleted and has no retained-resource UI or
background retry. Protocol and failure behavior live in [Mission v3](../contracts/mission-v3.md); UI in
[Mission board](../ui/components/mission-board.md). Reasons for the durable workspace and simplified model
interface are in [V1.59-D11](../versions/v1.59/decisions.md#v1-59-d11); the explicit minimal cleanup choice is in
[V1.59-D14](../versions/v1.59/decisions.md#v1-59-d14).
