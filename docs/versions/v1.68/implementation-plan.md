---
document_type: implementation-plan
version: v1.68
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-09-23
---

# v1.68 实施与验收

## 实施

1. 公开 Camp Formatter/Manifest 29、Run Facts 7、Profile 9 和 Charter revision 13：新 Run 冻结 `historyHint`，不选择或序列化自动 `SHARED_CONVERSATION`；`RUN_INPUT`、accepted ACK 水位和同 Run 冻结复用保持原义。
2. Schema migration 172 扩展 ContextManifest 和 AgentRunInput 的新写入约束。保留旧业务行及证据原字节；旧格式执行不再续派、恢复、转换、双读或自动重播。非 batch 26/6/5 路径不改。
3. `camp.read` timeline/thread 默认 20、显式整数 1–100；参数 schema、帮助、分页与负向输入保持一致。
4. 更新当前 Contracts、Architecture、导航与独立说明的实际版本/迁移/验证结论；使用隔离评测执行前后真实 Case 对照。

## 验收

| 项目 | 核查证据 | 状态 |
| --- | --- | --- |
| 新公屏上下文无自动历史且 `RUN_INPUT` 完整，`historyHint` 冻结 | Context owner tests、Manifest/payload digest | 进行中 |
| schema 172 保留旧行、限制新写入并通过重启 | Migration owner test、分类器与 foreign key check | 进行中 |
| 默认/100 条、错误、分页及长间隔历史读取 | Camp History / Built-in CLI owner tests | 进行中 |
| 文档和仓库门禁 | `pnpm docs:check`、`pnpm docs:check:decisions`、Rust workspace | 进行中 |
| 真实模型对照 Gate | [双轨评测](../../development/evaluation.md#上下文改动-gate)的旧/新产品与 Case | 进行中 |

## Rust 测试准入与退役

扩展现有 Context、Camp History 和 Tool Catalog owner 测试以覆盖新字段、冻结、读取上限与错误矩阵，不为单个 JSON 字段另建重复测试。旧自动 public history 的 batch 专属完整淘汰 cursor 测试随生产路径退出；非 batch 的公屏窗口、引用与预算 owner 继续保留。

新增 schema 172 升级 owner 时，其独立失败语义是 v1.67 当前来源带历史 Manifest/RunInput 行，经物理表重建后仍保留原字节、外键和当前写入门禁。现有 Context 单元测试不能证明 SQLite 真实升级与重启。最小命令为 `cargo test -p rovai-core --features extended-tests --lib v172_preserves_historical_context_rows_and_gates_new_writes`；现有 v171 owner 继续证明它自己的升级来源。
