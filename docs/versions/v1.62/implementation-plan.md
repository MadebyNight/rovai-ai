---
document_type: implementation-plan
version: v1.62
lifecycle: current
authority: version-implementation-plan
status: completed
last_updated: 2026-09-20
---

# v1.62 实施与验收

范围见[版本概览](README.md)，字段级行为见 [Mission v9](../../contracts/mission-v9.md)、
[Run Process Detail Surface v35](../../contracts/run-process-detail-surface-v35.md)、
[File Preview v17](../../contracts/file-preview-v17.md)与
[Camp Message Send v23](../../contracts/camp-message-send-v23.md)，Camp 打开职责见
[Camp Open Projection v20](../../contracts/camp-open-projection-v20.md)。

## Gate 0：当前基线与权威

- [x] 从最新 `main` 复核 Mission v5、Built-in v29、Core status 路径、catalog、CLI help 与错误恢复。
- [x] 确认本版不修改数据库、Bootstrap、Charter、ContextManifest、Run Facts 或 Renderer wire。
- [x] 发布 Mission v6/Built-in v30 后继续发布 Mission v7/v8/v9，补齐当前权威、版本决定并切换文档导航。

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
- [x] 每列为带名称的可聚焦 region，Left/Right 可切换列；卡片不显示省略号，右键/Shift+F10 共用菜单并提供 WCAG 非拖拽状态操作。
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

## Gate 9：Mission 启动与执行提示

- [x] `MissionRecord.startAvailable` 由等待/已领取的 Mission start Delivery 与 Camp 非终态 Run 共同决定；
  普通等待 Delivery 不进入该判定。
- [x] `runningAgentIds` 覆盖 queued/running/waiting，Delivery claim 后发布导航失效，连接前即可刷新执行提示。
- [x] `missions.start` 与 Renderer 共用同一 Core 判定；旧投影、快速连点或普通消息活跃 Run 不会追加启动任务。
- [x] 开始按钮立即 disabled、`aria-busy` 并显示“正在开始…”；受理后隐藏，明确拒绝恢复且显示错误；内部
  Mission start 消息继续不进入 Timeline。
- [x] Mission Rust owner、Electron 使命验收、TypeScript、文档治理、格式、workspace check、Rust 全量、Node
  全量与 Desktop 生产构建通过。
- [x] 分支提交并推送；PR #453 required gate 通过后合入 `main`，并验证功能提交是 `origin/main` 祖先。

## Gate 10：Mission Worktree checkout 与当前 Diff

- [x] 既有 Worktree 的执行校验与 checkout/Diff 观测拆开；准备链不再预查受管分支 OID 或固定基准。
- [x] 当前分支不同、受管分支缺失、detached HEAD、checkout 观测失败与 Diff 基准不可用不单独阻断 Runtime；
  路径、仓库、注册、owner marker、Host、权限和执行占用仍是硬门禁。
- [x] workspace 投影把已有 `branch` 映射为 `managedBranch`，活动页使用不持久化的 `checkoutState`；无 Migration。
- [x] checkout 与文件列表由一次 changes view 返回；文件详情重建私有临时 index 并验证 view association，旧请求
  迟到不会覆盖新视图或移除新句柄，Renderer 刷新时清除文件详情并丢弃旧响应。
- [x] 清理继续使用受管分支与 expected OID；非受管 checkout 和 detached HEAD 保留现场，不自动切回或接管。
- [x] 既有 Rust owner 覆盖分支切换、受管分支删除、detached、观测降级、固定基准失败、同 HEAD 的 staged/
  unstaged/untracked 刷新和 cleanup fence；真实 Runtime smoke 经过调度准备链验证重启续跑。

## Gate 11：Camp Open 只读职责

- [x] 普通取消/成功/失败保留 Gateway 提交后文本收尾；受控关闭与 planned-shutdown 的直提交流程保留原有
  post-commit 收尾，不在 Adapter 增加平行实现。
- [x] 旧取消中间态在数据库 open/migration 后、其他 execution recovery 前按精确持久条件统一结算；多个 Camp
  一次恢复，重复执行零写入，恢复失败继续阻断 ready。
- [x] 文本收尾失败在原 block buffer 记录 500ms–30s 有界退避；既有 AgentRun maintenance tick 到期只重试文本，
  无失败/未到期不查持久状态，成功复用 block event。
- [x] `camps.open` 与 read-only enter 投影阶段不再调用取消 settlement 或 `flush_settled`；SQL authorizer 与
  Managed Blob 目录断言覆盖目标 Camp 旧取消和其他 Camp 大文本的组合副作用。
- [x] Open schema 7、Snapshot 34、Data Contract 99、Renderer wire、数据库锁/连接和 Migration 均不变。

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

Mission 启动增量不新增独立 Rust 测试函数：既有
`mission_commands_keep_definition_atomic_patch_only_and_start_status_independent` 继续拥有 start admission、Replay、
业务状态独立与活动副作用，并扩展 waiting start、普通消息 claim、queued 投影及重复启动输入。修复前普通消息
claim 后仍可能重复创建 Mission start，queued Run 也不会进入执行提示；同一数据库/命令 owner 已覆盖完整事务，
平行 fixture 只会重复 setup。最小验证命令为
`cargo test -p rovai-core --lib mission_commands_keep_definition_atomic_patch_only_and_start_status_independent`。删除测试为零。

Worktree checkout 增量不新增平行 Rust test owner。既有 `persistent_worktree_preserves_source_recovers_owned_creation_and_retains_branch_on_delete`
扩展执行准入、detached、受管分支缺失、checkout 降级与非受管分支 cleanup fence；既有
`fixed_base_diff_is_final_net_content_without_mutating_real_index` 扩展同 HEAD 刷新、固定基准失败和多 view handle。
`scripts/smoke-mission.mjs` 继续拥有真实调度/Runtime 证明，Electron Mission fixture 继续拥有迟到响应与活动页刷新。

Camp Open 增量改写既有 `open_repairs_only_cancellation_marked_work_in_the_requested_camp` owner：旧 service 修复
合同退出，successor `open_and_read_only_enter_never_settle_work_or_write_managed_blobs` 拥有读取入口的 SQL 与文件
副作用边界；修复前目标取消或其他 Camp 待收尾文本会触发写入。它必须使用完整数据库，因为纯查询测试不能观察
Gateway/Blob 副作用。既有 Execution text 跨模块 owner 扩展 post-commit 故障、未到期零扫描、maintenance retry、
大正文 Blob 与命令 replay，不新增平行测试。新增 startup recovery owner 拥有跨 Camp 精确发现及重复执行幂等；
只有启动层测试能证明 service 不再是 repair owner。

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
- Mission 启动增量在最新 `origin/main` 上定向 owner 1 passed；默认 feature workspace 为 Core 844 passed、
  6 ignored，CLI 29 passed、Host 4 passed、Web 8 passed，0 failed。
- `pnpm test:mission-board` 为 4 passed、0 failed；新增覆盖 pending/拒绝/受理、claim 前入口隐藏、queued
  执行提示、状态独立和内部启动消息不可见。`pnpm typecheck`、diff-aware 文档治理、格式、workspace check、
  `git diff --check` 与 `pnpm build:desktop` 均通过。
- 完整 `pnpm test` 为 Vitest 2162/2162、Node 324 passed/2 skipped、0 failed；同时把主线已经轮换的 schema 116、
  ContextManifest/Formatter 27 与 Delivery Profile 8 同步到 Product Contract Fingerprint owner。
- PR #453 required gate 通过并合入 `main`；功能提交的最终 SHA 已由 `git merge-base --is-ancestor` 对
  `origin/main` 验证。
- `node scripts/smoke-mission.mjs ...` 在 rebase 后隔离 data-dir/Skill Library 通过 6 个场景，4 条真实
  AgentRun 全部 succeeded；bundled CLI 以 `{status:'completed'}` 更新并读回 `sourceMessageId: null`，
  Core 重启后的续轮保持该状态。
- Camp Open 增量定向验证：slow Camp Open 3/3、读取复杂度 2/2、startup cancellation recovery 1/1、
  post-commit Execution text retry 1/1；500 万 unrelated events 仍为 2143 VM steps。默认 Rust lib 全量
  845 passed、0 failed、6 ignored；最终 retry-owner 收紧后同一故障/replay owner 再次 1/1 通过。
- `cargo check -p rovai-core --all-targets`、`cargo fmt --all -- --check`、`git diff --check`、
  `pnpm docs:check` 与带固定 base 的 `pnpm docs:check:ci` 通过。隔离 Electron 的正文、执行窗口、终态
  artifacts 与当前用户 profile 场景通过；其余五个 Renderer fixture 断言在本分支和干净
  `da55f981` 基线以相同位置失败，未纳入本后端增量的通过声明。
