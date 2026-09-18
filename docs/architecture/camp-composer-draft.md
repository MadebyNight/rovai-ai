---
document_type: architecture
architecture: camp-composer-draft
authority: renderer-local-public-camp-composer
status: accepted
last_updated: 2026-09-18
---

# Public Camp Composer

公开 Camp Composer 的当前权威只有已挂载 Renderer 中的编辑状态。合同见
[Camp Composer Draft v14](../contracts/camp-composer-draft-v14.md)。Single Chat 的私有 Draft/Pending 不在本架构范围。

## 组件边界

| 组件 | 职责 |
| --- | --- |
| Lexical Editor | 节点树、selection、composition、undo/redo 与当前未发送内容 |
| Composer shell | 成员/Skill picker、引用、回复锚点、附件选择、发送状态和错误反馈 |
| Composer adapters | `EditorState` 与 `ComposerDocument`/Structured Content 的确定性转换 |
| Core publication | 校验一次发送快照并原子创建 CampMessage、附件关系和目标 Deliveries |
| Delivery queue | 已公开消息的目标等待责任；不是草稿或下一轮输入缓存 |

Core 不保存 public Camp Draft、revision、autosave、编辑租约、恢复锁或未公开 Pending。Renderer 不需要 Core Draft
协调器，也不存在跨窗口/客户端合并。普通按键路径只更新本地编辑器。

## 发送

```text
mounted Renderer edit
  → snapshot content / quotes / reply anchor / targets / Skills / source refs
  → one idempotent publication command
  → CampMessage + waiting Deliveries
```

提交期间 Composer 防止重复发送。成功后清空当前编辑；明确失败时保留原内容供用户修正或再次发送。未知提交结果通过
原 command ID 查询/回放，不能先清空再猜测。附件继续是源文件引用；发送不会移动或删除用户文件。

Camp 切换、刷新、窗口关闭或退出不会把未发送内容写入 Core，也不会在下次启动恢复。Renderer 可以实现轻量 dirty
warning，但该选择不能创建持久 Draft 模型、恢复列表或第二份本地副本。

## 撤回不是草稿恢复

发送后的本地 Principal 消息在首次目标 claim 前可以撤回。撤回操作针对已发布 CampMessage，原子取消 waiting Delivery
并擦除受控原文；它不会把内容放回 Composer，也不是 Undo Send/草稿恢复。首次 claim 后撤回资格永久关闭。

## 升级

Migration 163 一次性删除旧 public Composer Draft、未公开 Pending 及编辑/恢复状态，且不提供 legacy recovery UI。
删除引用不删除用户源文件；已发布消息和其附件不受影响。历史合同只用于解释旧数据库，不再作为当前入口。
