---
document_type: implementation-plan
version: v1.69
authority: version-implementation-and-acceptance
status: completed
last_updated: 2026-09-24
---

# v1.69 实施与验收

## 实施切片

1. 在 `camp_history.rs` 的显式 read/search 查询中允许 recallable 和本队员 waiting Delivery；保留 Camp 存续、publication、tombstone 及各工具原有的实时/冻结边界。`RUN_INPUT` 与 quote-source 过滤不改。
2. `camp.read` 将撤回行在原 sequence 投影为只有 `messageId`、`sequence`、`withdrawn: true`、`displayText: "Message withdrawn"` 的状态项；按 ID 与时间线共用投影，线程 anchor 保留不可恢复处理，分页上限仍是 100。
3. 更新 Built-in 输出 Schema、CLI 帮助、Camp History 合同、当前 Architecture 和文档路由；撤回事务与首个 claim 条件不改。Renderer 撤回确认文案改为“尚未领取”。
4. 扩展既有 `camp_history`、`context` 和 `team_tool_catalog` 测试 owner，验证读取、搜索、Schema、撤回后重读、分页与跨 Camp 边界；运行 Rust、前端、文档和提交门禁。

## 验收矩阵

| 验收项 | 证据 | 状态 |
| --- | --- | --- |
| 当前 Camp claim 前正常读取和搜索，读取不领取 Delivery | `camp_history::slow_tests::camp_read_returns_the_selected_page_and_item_body_without_size_clipping` | 通过 |
| 撤回后 `camp.read` 状态项占原序号且无原文，搜索不再命中；100 条分页仍完整 | 同一 `camp_history` owner 与 `team_tool_catalog::tests::camp_read_output_contract_distinguishes_original_and_withdrawn_items` | 通过 |
| 跨 Camp 搜索仍受冻结发布边界，跨 Camp 读取仍实时 | `context::slow_tests::public_history_is_readable_without_target_camp_membership_or_live_recheck` 与 `history_snapshot_order_and_titles_remain_frozen` | 通过 |
| 首个 claim 仍是撤回边界，quote-source 隔离不变 | `collaboration::slow_tests::recallable_local_composer_message_is_erased_and_cannot_be_republished`、默认 Rust 的 `delivery_queue::tests::waiting_deliveries_create_no_run_until_fifo_batch_claim` 与 `message_quote` owner | 通过 |
| Rust、前端构建与文档门禁 | `pnpm test:rust:pr`、`pnpm typecheck`、Vitest 2197 项、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、`pnpm docs:check:ci` | 通过；PR CI 待运行 |
| 全量 Node 聚合测试 | `pnpm test`：Vitest 2197 项通过；Node 326 项中 324 通过、2 项因旧 current-contract profile 的 v1.66/v1.67 固定断言与当前 v1.68 数据合同不符而失败 | 已记录基线问题，未改评测配置 |
| 真实任务双轨 Gate | [v1.68 记录](../v1.68/model-context-change-public-history-hint.md#实施与验证记录2026-09-23)证明原通用 Gate 的基线合同与退役自动历史清单已阻断所有 Trial；本版未重跑该受阻 Gate | 未完成，不作为通过证据 |

## Rust 测试准入

本版扩展 `camp_history.rs` 已有 SQLite 读取/搜索 owner、`context.rs` 已有跨 Camp owner 与 `team_tool_catalog.rs` 已有输出 Schema owner。新增断言覆盖同一次读取前后状态转换、marker 的闭合 shape 与 100 条分页保留；复用既有 fixture 比新增平行数据库夹具更低成本。
