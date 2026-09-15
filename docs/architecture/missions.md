---
document_type: architecture
authority: mission-architecture
status: accepted
last_updated: 2026-09-15
---

# Missions

Mission is the durable purpose of a public team Camp. Core owns its definition, independent business
status, history and execution workspace. Camp remains the sole owner of conversation, membership, lead,
drafts, published files and execution. Renderer does not create a parallel conversation model.

`MissionService` applies atomic commands through the existing gateway. The scheduler enters preparing
only after execution admission; the application coordinator then resolves or recovers the Mission workspace
outside the SQLite lock. It serializes preparation and deletion, persists association before Git work, and
rechecks claim fences before launching the Runtime. Non-Git projects retain their original cwd. A worktree
is retained throughout Mission life; independent orphan cleanup records survive deletion and restart.

`MissionGit` uses the Host-resolved Git executable and verified ownership to create/reuse/clean worktrees.
It computes cumulative changes against a fixed initial commit with a temporary index. Git and actual files
are the authority, not Agent narratives. The worktree is an execution location, not an Agent capability.

Context materialization projects compact identity/status and trusted start intent. The actual workspace
snapshot has its own dynamic section and acceptance marker, fenced to the native binding/generation.
No Mission business version is taught to Agents; field patches use last-committed values.

Desktop/wide Web share Mission navigation and the existing CampWorkspace. Drawer and full conversation
preserve one mounted composer/preview owner. Mobile is intentionally outside this increment. Protocol and
failure behavior live in [Mission v1](../contracts/mission-v1.md); UI in [Mission board](../ui/components/mission-board.md).
Reasons for the durable workspace and simplified model interface: [V1.59-D08](../versions/v1.59/decisions.md#v1-59-d08).
