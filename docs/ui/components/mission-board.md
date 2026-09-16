---
document_type: ui-contract
authority: mission-renderer-presentation
status: accepted
last_updated: 2026-09-16
---

# Mission board

Desktop and wide Web add a 使命板 entry using the existing shell and theme. Its badge counts `needs_you`
Missions, independently of unread messages and running Agents. Ordinary project/recent/pin navigation does
not duplicate Mission Camps. Mobile has no Mission entry; a Mission deep link directs the user to desktop.

Cards open from their entire surface, including keyboard activation; nested avatar/menu controls keep
their own actions. Show all member avatars with the lead first, project followed by tags, and a plain
relative timestamp such as “昨天”. Right-click shows only 状态、查看队员、队长、标签、删除. Click opens
submenus; chevrons use the existing 16px icon rhythm. Tags use a lightweight search/create/check popover.
Status/tag/project filters use matching icon triggers and neutral filled multi-select checkboxes. No selection
means all, without an extra “all” option. Project and tag pickers have search; status does not. Search and the
low-frequency board/list menu share the toolbar without vertical separators. The page uses the white home
surface in Day and its Night equivalent, a title/subtitle aligned with shell controls, and four equally tall,
very light neutral rounded lanes, including empty lanes. List mode groups and folds rows by status.
Lanes retain at least 200px at narrow widths or increased zoom; the board scrolls horizontally rather than squeezing card content.
Tags reuse the eight stable identity colors, independent of Mission status.

Creation reuses the production New Conversation directory, membership, lead and default-team controls.
Title/description follow Automation's field hierarchy without repeated miniheadings. Cancel remains on
the right. Description is optional. The split primary button defaults to 新建; its dropdown offers 开始使命.
Both paths stay on the board without opening the new Camp. Creation buttons retain their position when pressed.
No independent-workspace checkbox is offered; Core decides from the selected project. Failed/uncertain
creation retains its draft and command identity for safe retry.

Card opening shows a right conversation drawer with Activity selected in the shared file preview. The left
edge supports pointer and keyboard resizing, a width menu, cancellation and double-click expansion. It
defaults to 1040px, leaving at least 64px of board when possible, with a 640px minimum. Releasing within
48px of the main workspace's left edge expands to the full conversation; folding restores the previous
drawer width. This is workspace presentation, not operating-system fullscreen. The same CampWorkspace,
Composer and preview owner stay mounted across these changes.

The drawer hides the conversation title and places close/expand at the left. Full presentation shows
project › conversation title, preceded by return-to-board and fold-to-drawer. Both use one full-width
AppHeader with 执行、任务、队员、单聊、活动 and the preview toggle on the right. Drawer runs do not
automatically open the execution inspector or overlay; explicit execution entry remains available.

The timeline begins with a read-only 使命 card: title, description clamped to three lines with overflow
expansion, roster, tags and read-only status. It has no edit, context menu, or detail/delivery/activity links.
An unstarted Mission has a 36px neutral primary 开始使命 action below the card (black in Day).

Activity is a real closeable preview tab containing delivery and Mission history in one scrolling document.
Clicking the Activity entry activates or reopens it; clicking while it is selected and visible closes it.
Closing selects an adjacent remaining file; closing the last tab also hides the preview. Hiding the whole
preview retains all tabs and reading state. Activity acquires no file handle and remains scoped to its Camp.
In Mission conversations the shared preview tab strip sits below the full-width conversation header.
Compact preview replacement and source-message navigation preserve the conversation and draft.

Delivery shows the actual directory and, for Git, associated branch/base and cumulative changes. It has no
“工作区信息” wrapper or explanatory net-change subtitle. Overview loads file Diff on demand, preserving
binary/type/rename/Git-mode information and explicit computation failures. Agent files reuse AttachmentCard,
file preview and source-message navigation. Activity displays actual Mission history. Deletion identifies
the associated workspace and retained branch; failed cleanup remains visible and retryable.

Business and ownership rules are defined by [Mission v1](../../contracts/mission-v1.md), not this presentation
contract. Theme and ordinary conversation behavior remain under [DESIGN.md](../../../DESIGN.md) and
[Camp workspace](conversation-workspace.md).
