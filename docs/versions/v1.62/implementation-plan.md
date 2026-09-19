---
document_type: implementation-plan
version: v1.62
lifecycle: current
authority: version-implementation-plan
status: in_progress
last_updated: 2026-09-20
---

# v1.62 实施与验收

范围见[版本概览](README.md)，字段级行为见 [Mission v6](../../contracts/mission-v6.md)。

## Gate 0：当前基线与权威

- [x] 从最新 `main` 复核 Mission v5、Built-in v29、Core status 路径、catalog、CLI help 与错误恢复。
- [x] 确认本版不修改数据库、Bootstrap、Charter、ContextManifest、Run Facts 或 Renderer wire。
- [x] 发布 Mission v6、Built-in v30、版本决定并切换当前文档导航。

## Gate 1：Core 状态语义

- [x] 删除 Agent 对 `needs_you/completed` 的条件必填拒绝。
- [x] 四种状态均允许省略来源；省略会清除旧关联，显式有效来源继续保存。
- [x] 显式无效来源继续原子拒绝，不部分更新状态、关联或活动。
- [x] no-op、命令重放、活动记录、权限、Run/epoch fence 与执行独立性保持不变。

## Gate 2：Catalog、CLI 与错误恢复

- [x] catalog 将 `sourceMessageId` 描述为可选，空字符串与非法类型仍由闭合 schema 拒绝。
- [x] CLI help 提供不带来源的 `needs_you` 示例，并覆盖全部 26 个 exact help 入口。
- [x] 删除当前错误目录中的 `mission.source_message_required`。
- [x] 实际 invocation recovery 读取 operation 错误目录；`mission.invalid_source_message` 返回 `fix_input`。
- [x] Transport/CLI/capability 原子轮换到 v30，operation 数、IPC、Envelope、receipt 与 Output 不变。

## Gate 3：验证与合并

- [x] 定向 Mission、Transport 与 CLI Rust 回归通过。
- [ ] Rust 全量、workspace check、fmt、Node/文档治理与 diff-aware 门禁通过。
- [x] 隔离的有效 AgentRun 通过 bundled CLI 无来源设置 `completed`。
- [ ] 分支提交并推送，PR gate 通过后合并到 `main`，再验证远端祖先关系。

## Rust 测试准入记录

不新增独立 Rust test owner。既有 Mission command owner 扩展四状态无来源、有效/无效来源、清除、no-op、
Replay、活动、执行副作用与 epoch/membership 边界；既有 Transport 与 CLI owner 扩展 v30、错误恢复和实际
help。删除测试为零。

## 实施收口

- `cargo test -p rovai-core --lib mission_commands_keep_definition_atomic_patch_only_and_start_status_independent`：1 passed。
- `cargo test -p rovai-core --lib builtin_tool_transport::tests::`：8 passed。
- `cargo test -p rovai-core --bin rovai mission_status_help_and_direct_flags_keep_source_message_optional`：1 passed。
- `cargo test -p rovai-core --bin rovai exact_help_surface_covers_the_current_catalog_and_no_family_aliases`：1 passed。
- `cargo test -p rovai-core --bin rovai -- --test-threads=4`：29 passed；`cargo check --workspace --all-targets`、
  `cargo fmt --all -- --check`、`pnpm typecheck` 与 `git diff --check` 通过。
- Core 全量在功能基线为 841 passed、6 ignored；rebase 后组合运行 840 passed、1 个时间敏感 Runtime
  discovery 失败、6 ignored，该失败独立 exact 复跑 1/1 通过。
- 完整 `pnpm test` 曾取得 Vitest 2153/2153、Node 324 passed/2 skipped；rebase 后两次完整运行只命中既有
  `evaluation-host` 并行超时，隔离复跑 4/4 通过。required PR gate 负责最终独立环境裁决。
- `node scripts/smoke-mission.mjs ...` 在 rebase 后隔离 data-dir/Skill Library 通过 6 个场景，4 条真实
  AgentRun 全部 succeeded；bundled CLI 以 `{status:'completed'}` 更新并读回 `sourceMessageId: null`，
  Core 重启后的续轮保持该状态。
