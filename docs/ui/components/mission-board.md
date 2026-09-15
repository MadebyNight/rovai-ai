---
document_type: ui-contract
authority: mission-renderer-presentation
status: accepted
last_updated: 2026-09-15
---

# Mission board

Desktop and wide Web add a Mission entry using the existing shell and theme. Its badge counts `needs_you`
Missions, independently of unread messages and running Agents. Ordinary project/recent/pin navigation does
not duplicate Mission Camps. Mobile has no Mission entry; a Mission deep link directs the user to desktop.

Cards open from their entire surface, including keyboard activation; nested avatar/menu controls keep
their own actions. Show all member avatars with the lead first, project followed by tags, and a plain
relative timestamp such as “昨天”. Right-click shows only 状态、查看队员、队长、标签、删除. Click opens
submenus; chevrons use the existing 16px icon rhythm. Tags use a lightweight search/create/check popover.
Status/tag/project filters and search share a compact toolbar; board/list is a low-frequency menu.

Creation reuses the production New Conversation directory, membership, lead and default-team controls.
Title/description follow Automation's field hierarchy without repeated miniheadings. Cancel remains on
the right with the save/start actions. No independent-workspace checkbox is offered; Core decides from
the selected project. Failed/uncertain creation retains its draft and command identity for safe retry.

Card opening shows a right drawer with conversation, delivery and activity tabs. Expanding uses the same
CampWorkspace/composer and draft. The full conversation keeps AppHeader directly in NavigationShell, so
title and collapse controls align exactly as an ordinary conversation. A Mission board begins the timeline
with title/description, roster, tags, status and explicit start. Mission edits do not submit messages.

Delivery shows the actual directory and, for Git, associated branch/base and cumulative changes. It has no
“工作区信息” wrapper or explanatory net-change subtitle. Overview loads file Diff on demand, preserving
binary/type/rename/Git-mode information and explicit computation failures. Agent files reuse AttachmentCard,
file preview and source-message navigation. Activity displays actual Mission history. Deletion identifies
the associated workspace and retained branch; failed cleanup remains visible and retryable.

Business and ownership rules are defined by [Mission v1](../../contracts/mission-v1.md), not this presentation
contract. Theme and ordinary conversation behavior remain under [DESIGN.md](../../../DESIGN.md) and
[Camp workspace](conversation-workspace.md).
