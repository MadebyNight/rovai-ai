---
document_type: version-overview
version: v1.62
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-20
---

# Rovai-ai v1.62：Mission 状态与来源消息解耦

前置：[v1.61](../v1.61/README.md)。本版让 Mission 业务状态成为真正独立的操作：有权修改当前
Mission 的 Agent 可直接设置任一状态，`sourceMessageId` 对所有状态都只是可选关联。

## 目标

- `needs_you` 与 `completed` 不再要求 Agent 先发布消息并取得消息 ID。
- 显式来源仍必须是同 Camp、已公开且未删除的消息；无效来源原子拒绝。
- 省略来源会清除旧关联；状态与关联共同决定 `changed`，Replay 与活动幂等保持不变。
- catalog、真实 CLI help、实际错误恢复和 Core 使用同一语义。
- 不改变 Mission 修改权限、执行生命周期、数据库、Bootstrap、Run Facts、ContextManifest 或 UI wire。

字段级协议见 [Mission v6](../../contracts/mission-v6.md)与
[Built-in Tool Transport v30](../../contracts/builtin-tool-transport-v30.md)，实施与验证见
[实施计划](implementation-plan.md)，取舍理由见[版本决定](decisions.md)。

## 当前状态

Core、catalog、CLI help、错误目录与隔离 Mission smoke 已完成实现；本地 Rust/TypeScript/文档门禁已
执行，时间敏感用例的独立复跑均通过。required PR gate、合并与远端祖先验证仍待交付收口。本版不轮换
data contract：继续使用 v1.61/schema 116，不新增 Migration。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.61 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v1.62 |
| Decisions | 已更新 | [V1.62-D01](decisions.md#v1-62-d01)记录状态操作与消息发布解耦、显式关联继续验证的取舍 |
| Contracts | 已更新 | 发布 [Mission v6](../../contracts/mission-v6.md)与[Built-in Tool Transport v30](../../contracts/builtin-tool-transport-v30.md) |
| Architecture | 已更新 | Mission 与 Built-in Tool Runtime 明确独立状态操作、可选来源和 catalog-owned recovery |
| UI | 已更新 | [使命板 UI](../../ui/components/mission-board.md)仅切换当前 Mission 合同引用；既有 nullable 来源展示已满足，无交互或视觉变化 |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Runtime Activity 分类、证据来源或展示映射 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter 行为或平台资格；只轮换 Rovai-owned Built-in capability |
| Documentation routing | 已更新 | 文档任务入口、合同索引、当前决定导航和版本索引指向 v1.62 当前权威 |
| Root README | 确认无需更新 | Mission 状态输入约束不改变项目定位、安装方式或公开支持范围 |
