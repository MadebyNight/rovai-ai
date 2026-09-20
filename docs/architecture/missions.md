---
document_type: architecture
authority: mission-architecture
status: accepted
last_updated: 2026-09-20
---

# Missions

Mission is the durable purpose of a public team Camp. Core owns its opaque relational identity, stable display number,
latest definition, independent business status, activity facts and execution workspace. Camp remains the sole owner of conversation, membership, lead,
drafts, published files and execution. Renderer does not create a parallel conversation model.

`MissionService` applies atomic commands through the existing gateway. The scheduler enters preparing
only after execution admission; the application coordinator then resolves or recovers the Mission workspace
outside the SQLite lock. Preparation and cleanup admission share a short fence so an accepted cleanup intent
cannot race reuse of the same workspace. The durable intent then runs under a separate serialized cleanup worker,
so Git removal does not hold preparation or ordinary Mission operations for unrelated workspaces. Preparation
persists association before Git work and rechecks claim fences before launching the Runtime. Non-Git projects
retain their original cwd. A worktree is retained throughout ordinary Mission use. Standalone cleanup records
two asynchronous steps in its existing association; a later preparing phase restores the branch/worktree
according to actual resource state.

`MissionGit` reads the source checkout's current local branch and `HEAD` when the first admitted Run enters
preparing, and again only when both previously managed Git resources have been removed. It uses the resolved
commit, the Host-resolved Git executable and verified ownership to create, restore or clean worktrees. Cleanup
verifies the owned resource set once, persists the branch OID on the first attempt, and removes the verified
worktree before checking branch use and conditionally deleting the local Mission branch at that OID. Its two
durable checkpoints let retries skip the completed worktree step and reuse the saved OID; an absent resource is
idempotent without widening cleanup beyond the verified path, registration or staging root.
The command commits `cleanup_pending` before notifying the worker; startup/periodic recovery scans unfinished
pending rows only. Failure becomes `cleanup_failed` and is never automatically retried. Successful live cleanup
keeps both completed checkpoints for reconstruction; successful orphan cleanup removes the workspace row.
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

Mission keeps its shared UI projection path-free. The Agent read side has two deliberately deep projections:
`mission.list` queries only number, Camp, title, status and update time, while `MissionAgentInfo` joins one current
definition with ordered structured source attachments. Both are available to every effective authenticated
AgentRun across all Missions and do not reuse the target Camp's mutation authorization. Omitted-ID `mission.get`
resolves only the authenticated Run's current Camp; an explicit internal `rvm_...` ID resolves directly and never
switches the current Mission. `mission.update` and `mission.status` accept no target selector and still require
the current active membership and exact execution fence.

Status mutation is independent from message publication. `sourceMessageId` is an optional association for every
status; when present it must resolve to a current public message in the same Camp, and when omitted it clears any
previous association. Core never publishes, searches for or implicitly chooses a message during a status update.
This does not weaken mutation authorization or change Run admission, cancellation or completion.

Mission execution presentation is derived from Camp-owned queue facts rather than business status. A dedicated
Mission start Delivery in `waiting`/`claimed`, or any non-terminal AgentRun in the Mission Camp, makes the start
entry unavailable; the same predicate is enforced by `missions.start` in its command transaction. Only
`queued`/`running`/`waiting` AgentRuns contribute executing members, so an unclaimed Delivery hides an accepted
start without claiming that execution has begun. Delivery claim emits the ordinary navigation invalidation,
allowing the board, drawer and full conversation to observe the queued Run before Runtime connection or output.

Database relations, internal events, Agent results and new Run Facts share that same internal ID. The stable number
is not returned to Agents; Renderer alone formats it as `M-xxx` for user-facing Mission surfaces and managed
workspace names. No Agent-side ID translation layer exists.

The read side does no filesystem observation, so registered attachment identity, saved metadata and original
path remain discoverable even when the source later disappears. Built-in invocation evidence continues to
project definition facts without raw attachment paths. The opaque internal ID is shared by relations, audit,
Agent-facing results and Context.

The opaque ID remains the relational and Agent key. A monotonic integer is the human and Git naming identity:
UI renders `M-018`, while the paired branch and sibling worktree use `rovai/mission/018` and `<repo>-mission-018`.
Deleted numbers are never reused; collision suffixes do not change the number. Context materialization projects compact identity/status and trusted start intent. The actual workspace
snapshot has its own dynamic section and acceptance marker, fenced to the native binding/generation.
No Mission business version is taught to Agents; field patches use last-committed values.

Desktop/wide Web share Mission navigation and the existing CampWorkspace. Drawer and full conversation
preserve one mounted composer/preview owner. Mobile is intentionally outside this increment. Renderer consumes
Core's cleanup capability and does not infer it from Mission status. Deletion defaults to leaving worktree and
branch in place. Optional cleanup records its intent in the same transaction that deletes the Mission, removes
the card immediately, and exposes only failed orphan work through the existing cleanup route; retained resources
never enter that route. Protocol and failure behavior live in [Mission v8](../contracts/mission-v8.md); UI in
[Mission board](../ui/components/mission-board.md). Reasons for the durable workspace and simplified model
interface are in [V1.59-D11](../versions/v1.59/decisions.md#v1-59-d11); the explicit minimal cleanup choice is in
[V1.59-D14](../versions/v1.59/decisions.md#v1-59-d14). Global discovery and current-only mutation are explained
by [V1.61-D01](../versions/v1.61/decisions.md#v1-61-d01). Status/message decoupling is explained by
[V1.62-D01](../versions/v1.62/decisions.md#v1-62-d01); asynchronous cleanup ordering is explained by
[V1.62-D02](../versions/v1.62/decisions.md#v1-62-d02).
