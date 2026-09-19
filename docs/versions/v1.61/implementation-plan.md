---
document_type: implementation-plan
version: v1.61
lifecycle: current
authority: version-implementation-plan
status: completed
last_updated: 2026-09-19
---

# v1.61 实施与验收

范围见[版本概览](README.md)，模型输入边界见
[确认说明 revision 2](model-context-change-mission-discovery.md)。

## Gate 0：确认与当前权威

- [x] 以当前 `main` 调查 Mission v4、Built-in v28、public/Single Chat Charter、Context 与数据库约束。
- [x] 开发者阅读完整方案后确认 revision 1，并明确要求完成 PR 后合并到 `main`；随后确认 revision 2 的内部 ID 方案。
- [x] 发布 Mission v5、Built-in v29、Single Chat v6 及版本决定，更新长期 Architecture 和文档路由。

## Gate 1：Mission read side 与标识

- [x] 数据库、内部事件、Agent Mission 操作与模型上下文共用内部 `rvm_...` ID；UI 继续从 number 显示 `M-xxx`。
- [x] 实现轻量 `mission.list` 查询、四状态筛选、标题/精确 ID 查询、20/50 上限和筛选绑定游标。
- [x] 扩展 `mission.get` 的可选 selector；省略时只解析认证 Run 当前 Camp，显式 miss 不回退。
- [x] 返回有序结构化附件，保留保存的元数据/路径，不扫描或重检源文件。
- [x] `mission.update/status` 仍只写当前公共 Mission，成功结果直接返回内部 ID。

## Gate 2：认证、Single Chat 与 Context

- [x] 所有 Mission read 复用有效 Run/epoch/lease/Binding 身份，不复用目标 Camp mutation gate。
- [x] Single Chat policy version 2 只增加 `mission.list/get`；version 1 历史 Run 仍使用旧 allowlist。
- [x] Migration 165/schema 115 原子扩展 AgentRun policy-version 约束，普通 Camp version 1 不变。
- [x] public 与 Single Chat Charter 使用确认后的最小入口文案，Session Charter revision 升至 9。
- [x] 新 Run Facts/旧 Formatter 新生成 Mission 引用继续使用内部 `rvm_...`；历史冻结字节不改写。

## Gate 3：CLI、Skill 与封闭协议

- [x] Transport/CLI/capability 轮换为 v29，operation catalog 增至 26 项；IPC/Envelope/receipt 不变。
- [x] 根 help、generated exact help、flags、闭合输入/输出 schema、golden projection、错误恢复与 Evidence 支持新协议。
- [x] `cli-operations` 只补“已知 ID 直接 get、查找才 list、读取不切换、当前写”的协调规则。
- [x] Single Chat 继续排除完整 `cli-operations` Skill，不扩大其他 Built-in 权限。

## Gate 4：验证与合并

- [x] Rust 定向与全量测试覆盖 ID、列表/游标、附件、授权、Context、policy migration 和 CLI 契约。
- [x] TypeScript、文档/Skill 治理、格式与 diff 检查通过。
- [x] 分支保持一条功能提交并推送；PR #437 的远端 gate 通过，最终合并与 `origin/main` 祖先验证由本次交付收尾执行。

## Rust 测试准入记录

新增测试拥有既有 owner 无法证明的事务/协议边界：Mission service 的内部 ID、数值分页与筛选绑定游标；
Migration 165 的 exact v1.60/schema 114 来源、DDL 重建及 current admission；Single Chat policy v2 的新读白名单。
它们分别防止字符串排序/游标串用、Charter 已放开但数据库拒绝新 Run，以及私聊读权限只改文案未改 Core。
删除测试为零。

## 实施收口

- `cargo test -p rovai-core --lib -- --test-threads=4`：841 passed、0 failed、6 ignored。
- `cargo test -p rovai-core --bin rovai -- --test-threads=4`：28 passed、0 failed。
- `cargo check --workspace --all-targets` 与 `cargo fmt --all -- --check` 通过。
- `pnpm typecheck`、`pnpm docs:test`、`pnpm docs:check`、diff-aware 文档治理与 Skill 检查通过。
- 完整 Vitest 运行有 2 个负载敏感的 `evaluation-host` 超时，其余 2,151 项通过；该文件隔离复跑 4/4 通过，
  PR #437 的 TypeScript/Vitest gate 完整通过。
- 产品契约指纹已同步 v1.61/schema 115/Built-in 29，并由独立测试及远端 gate 验证。
