---
document_type: implementation-plan
version: v1.62
lifecycle: current
authority: version-implementation-plan
status: completed
last_updated: 2026-09-20
---

# v1.62 实施与验收

范围见[版本概览](README.md)，字段级行为见 [Mission v7](../../contracts/mission-v7.md)、
[Run Process Detail Surface v35](../../contracts/run-process-detail-surface-v35.md)、
[File Preview v17](../../contracts/file-preview-v17.md)与
[Camp Message Send v23](../../contracts/camp-message-send-v23.md)。

## Gate 0：当前基线与权威

- [x] 从最新 `main` 复核 Mission v5、Built-in v29、Core status 路径、catalog、CLI help 与错误恢复。
- [x] 确认本版不修改数据库、Bootstrap、Charter、ContextManifest、Run Facts 或 Renderer wire。
- [x] 发布 Mission v6/Built-in v30 后继续发布 Mission v7，补齐版本决定并切换当前文档导航。

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
- [x] Rust 全量、workspace check、fmt、Node/文档治理与 diff-aware 门禁通过。
- [x] 隔离的有效 AgentRun 通过 bundled CLI 无来源设置 `completed`。
- [x] 状态解耦增量 PR #443 的 required gate 通过并已合入 `main`。

## Gate 4：Worktree 异步清理

- [x] `missions.workspace.cleanup` 只在 Domain Command 事务中提交 pending intent；重复 pending 请求被拒绝。
- [x] 独立 cleanup worker 使用通知快路与固定恢复 pass，按 expected OID 和两个既有 checkpoint 执行；failed
  不进入自动恢复。
- [x] Renderer Mission 投影增加 cleaning/failed/cleaned 与实际步骤状态；Workspace 详情公开两个 checkpoint，
  私有命令身份和 expected OID 不外泄。
- [x] `camps.delete(workspaceDisposition=cleanup)` 在删除聚合的同一事务保存清理意图，返回后不等待 Git；
  orphan 成功删除记录，失败使用既有待清理入口。retain 不登记后台维护。
- [x] 卡片、Toast、详情与 orphan dialog 分别拥有即时进度、持久失败、查看、实际状态和未完成步骤重试；
  成功反馈为约四秒的本地 one-shot，刷新/重进不重播。

## Gate 5：使命板独立列滚动

- [x] Board host 仅保留横向 overflow；四个 status lane 的 card region 分别拥有纵向原生滚动、stable gutter 与
  contained overscroll，页面标题、筛选和列头固定。
- [x] status-keyed lane DOM 在 Mission refresh、cleanup feedback、详情抽屉与跨列状态更新中保持挂载；列表往返用
  Renderer 瞬时内存恢复 offset，搜索/筛选变化则把新结果恢复到顶部，不用 IPC 或持久偏好。
- [x] HTML5 drag 在目标列上下边缘使用 animation frame 自动滚动该列，在窄窗左右边缘滚动 board host；结束、
  drop、Escape 和离开区域均清理循环。
- [x] 每列为带名称的可聚焦 region，Left/Right 可切换列；省略号/右键/Shift+F10 共用菜单并提供 WCAG 非拖拽状态操作。
  窄桌面窗口保留 278px 列宽与横向 scroll-snap，并以带筛选后数量的紧凑状态入口直接切换可见列。
- [x] 保留现有视觉体系；行为参考稿不作为像素级还原或替换现有组件样式的依据。

## Gate 6：清理与滚动验证

- [x] 异步清理 Rust 定向/全量测试、Mission Electron 验收、TypeScript、文档治理、格式、diff 与编译检查通过。
- [x] `pnpm build:desktop` 生产构建通过；清理/滚动增量基于 PR #443 已合入的 `main` 变基并保持一条功能提交。

## Gate 7：Agent Run Card 与共享工作区

- [x] 执行位置扩展为 `right | inspector | bottom`，位置菜单保存同一个安装级偏好；提交失败保留原位置。
- [x] 右侧 Execution 作为无文件能力的合成标签接入 File Preview Session，与 Activity、普通文件复用标签集合和
  分栏比例；切换内容不改变文件预览宽度。
- [x] 总览、单队员当前区、聚合排队批次和折叠历史共用同一详情 DOM；卡片动作只作用于显示的 exact Run ID。
- [x] 进入普通或 Mission 会话时只选择最新 running Run，展开后定位最新指令并按用户阅读意图跟随；后台刷新
  不重复进入规则或抢焦点。Mission 的 Activity 先建立，右侧 Execution 在符合条件时取得当前显示。

## Gate 8：消息回执、撤回与验收

- [x] 当前用户消息显示聚合处理回执和按需队员明细；队员消息保留既有底色框。
- [x] 撤回只使用 `canWithdraw + expectedVersion`，取消关闭弹窗，确认通过 Desktop/Web 的同一
  `camp.messages.withdraw` operation 提交；成功后使用既有撤回标记。
- [x] Renderer、File Preview、偏好保存、时间线定位、Host operation 与 Core 撤回边界的定向测试通过。
- [x] 隔离 Electron 验收覆盖三位置往返、共享宽度、最新 running Run 自动打开、指令跟随、排队合批、停止、
  撤回取消/确认、恢复和长 Tool 输出；类型、文档、生产构建与 macOS App 验证通过。

## Rust 测试准入记录

不新增独立 Rust test owner。既有 Mission command owner 扩展四状态无来源、有效/无效来源、清除、no-op、
Replay、活动、执行副作用与 epoch/membership 边界；既有 Transport 与 CLI owner 扩展 v30、错误恢复和实际
help。删除测试为零。

异步清理不新增平行 Rust 测试函数：`mission_cleanup_capability_comes_from_workspace_records_and_execution_occupancy`
继续拥有 Renderer cleanup projection 输入矩阵；`camp_rename_lead_change_and_quiescent_delete_with_cleanup_are_versioned`
继续拥有 Camp 删除事务/replay，并增加 cleanup intent 与聚合删除原子性的断言。较低层纯函数不能证明 gateway
transaction 与 Camp aggregate 删除。独立列滚动不改变 Core 行为，由隔离 Electron 密集卡片验收拥有。

Agent Run Card 增量不新增 Rust 测试 owner。撤回继续由既有多接收者 waiting Delivery 原子撤回、首个 claim 后拒绝
和幂等命令用例拥有；Desktop/Web 只补齐同一 operation 的 Host 准入。新的偏好保存回归由共享 TypeScript owner
覆盖，避免 unrelated Host read 阻塞已提交的保存结果。

## 实施收口

- `cargo test -p rovai-core --lib mission_commands_keep_definition_atomic_patch_only_and_start_status_independent`：1 passed。
- `cargo test -p rovai-core --lib builtin_tool_transport::tests::`：8 passed。
- `cargo test -p rovai-core --bin rovai mission_status_help_and_direct_flags_keep_source_message_optional`：1 passed。
- `cargo test -p rovai-core --bin rovai exact_help_surface_covers_the_current_catalog_and_no_family_aliases`：1 passed。
- `cargo test -p rovai-core --bin rovai -- --test-threads=4`：29 passed；`cargo check --workspace --all-targets`、
  `cargo fmt --all -- --check`、`pnpm typecheck` 与 `git diff --check` 通过。
- 清理增量基线 `cargo test -p rovai-core --lib -- --test-threads=4`：845 passed、0 failed、6 ignored；
  cleanup projection、部分失败重试与 Camp 删除原子性定向用例通过。
- `pnpm test:mission-board`：4 passed、0 failed；覆盖异步清理、独立列滚动、820px 桌面窄窗横向切换、
  大 Diff 虚拟化、宽屏抽屉与编辑器指针交互；`pnpm build:desktop` 通过。
- Core 全量在功能基线为 841 passed、6 ignored；rebase 后组合运行 840 passed、1 个时间敏感 Runtime
  discovery 失败、6 ignored，该失败独立 exact 复跑 1/1 通过。
- 完整 `pnpm test` 曾取得 Vitest 2153/2153、Node 324 passed/2 skipped；rebase 后两次完整运行只命中既有
  `evaluation-host` 并行超时，隔离复跑 4/4 通过。required PR gate 负责最终独立环境裁决。
- `node scripts/smoke-mission.mjs ...` 在 rebase 后隔离 data-dir/Skill Library 通过 6 个场景，4 条真实
  AgentRun 全部 succeeded；bundled CLI 以 `{status:'completed'}` 更新并读回 `sourceMessageId: null`，
  Core 重启后的续轮保持该状态。
