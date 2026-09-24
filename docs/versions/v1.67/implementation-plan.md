---
document_type: implementation-plan
version: v1.67
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-09-24
---

# v1.67 实施与验收

## 实施切片

1. 在 `camp_history.rs` 的显式 read/search 查询中允许 recallable 和本队员 waiting Delivery；保留 Camp 存续、publication、tombstone 及各工具原有的实时/冻结边界。自动上下文与 quote-source 过滤不改。
2. `camp.read` 将撤回行在原 sequence 投影为只有 `messageId`、`sequence`、`withdrawn: true`、`displayText: "Message withdrawn"` 的状态项；按 ID 与时间线共用投影，线程 anchor 保留不可恢复处理。
3. 更新 Built-in 输出 Schema、CLI 帮助、Camp History 合同、当前 Architecture 和文档路由；撤回事务与首个 claim 条件不改。
4. 使用现有 `camp_history`、`team_tool_catalog` 和 `context` 测试 owner 验证读取、搜索、Schema、撤回后重读与跨 Camp 边界；运行 Rust、文档和提交门禁。

## 验收矩阵

| 验收项 | 证据 | 状态 |
| --- | --- | --- |
| 当前 Camp claim 前正常读取和搜索，读取不领取 Delivery | `camp_history::slow_tests::camp_read_returns_the_selected_page_and_item_body_without_size_clipping` | 已通过 |
| 撤回后 `camp.read` 状态项占原序号且无原文，搜索不再命中 | 同一 `camp_history` owner 与 `team_tool_catalog::tests::camp_read_output_contract_distinguishes_original_and_withdrawn_items` | 已通过 |
| 跨 Camp 搜索仍受冻结发布边界，跨 Camp 读取仍实时 | `context::slow_tests::public_history_is_readable_without_target_camp_membership_or_live_recheck` 与 `history_snapshot_order_and_titles_remain_frozen` | 已通过 |
| claim 后撤回拒绝，自动上下文和 quote-source 隔离不变 | 现有 Collaboration/Context 回归 | 待运行 |
| Rust、文档与 PR 门禁 | `cargo test`、`pnpm docs:*`、CI | 待运行 |

## Rust 测试准入

本版扩展 `camp_history.rs` 已有 SQLite 读取/搜索 owner 与 `team_tool_catalog.rs` 已有输出 Schema owner。新增断言覆盖同一次读取前后状态转换和 marker 的闭合 shape；既有 fixture 已包含消息、附件和 Delivery，复用它比新增平行数据库 fixture 更低成本。跨 Camp 发布边界由 `context.rs` 既有 owner 证明。
