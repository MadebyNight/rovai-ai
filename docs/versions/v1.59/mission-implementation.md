---
document_type: implementation-plan
version: v1.59
status: completed
last_updated: 2026-09-15
---

# 桌面使命实施

开发者已确认[模型输入 revision 3](model-context-change-mission.md)。原始使命方案与后续反馈共同决定
产品范围：使命与 Task／执行状态分离；一个主 Camp；用户开始或消息触发执行；持久 Git 工作区和固定基准 Diff；
非 Git 使用原目录，无分支与 Diff；只向桌面开放。

## 交付步骤

| 步骤 | 状态 | 完成条件 |
| --- | --- | --- |
| 领域与持久化 | 已实现并验收 | 原子 Mission + Camp、当前成员权限、后提交字段覆盖、历史、标签／PR |
| 工作区与 Git | 已实现并验收 | preparing 才创建、稳定关联、实际 Git 净 Diff、冲突／恢复／清理 |
| 输入与 CLI | 已实现并完成定向验收 | 已确认 shape、版本轴与证据，三个 Mission 操作；通用评测状态另列 |
| 桌面 | 已实现并验收 | 真正导航、列表／看板、抽屉、会话板、交付／活动、普通会话状态复用 |
| 验证与安装 | 已安装；通用评测提前结束 | 常规门禁、隔离执行／UI、同步 main 与 daily 安装完成；按用户追加指令停止通用评测 |

## 测试准入

现有 `collaboration`、`runtime`、`context`、`db` owner 已检索；没有 Mission 领域与持久 worktree owner。
新增测试按独立失败语义分配，不建立平行全栈 fixture：

- Mission 事务 owner：创建失败不残留 Camp，成员权限、同字段最后提交、不同字段保留、no-op 与幂等；
  SQLite 事务是合同本体，需要隔离数据库。最小命令 `cargo test -p rovai-core --lib mission::tests`。
- Git 文件系统 owner：固定基准、临时 index 保真实 index、未跟踪／忽略／二进制／特殊路径、冲突及恢复；
  纯 parser 矩阵不能证明 Git 行为，使用临时真实仓库。最小命令 `cargo test -p rovai-core --lib mission_workspace::tests`。
- 已有 Context Evidence owner 扩展使命输入、once-per-binding ACK 和恢复负向分支；沿用唯一 golden，不复制 JSON 断言。
- Migration 156 扩展受支持来源的 admission 矩阵。独立 Mission migration owner 证明事务回滚、既有历史保留、删除 Camp 后清理记录继续存在并可跨重启读取；旧迁移 owner 没有这个生命周期，需隔离 SQLite。最小命令 `cargo test -p rovai-core --lib mission_migration_is_atomic_and_cleanup_survives_camp_deletion`。

真实模型只在隔离 Smoke 和已冻结 Gate 中运行。交互稿的 15 组 fixture 检查不构成以上产品验收。

## 主线整合与验收

已整合 `origin/main` 的 `3f06e213`（#397、#398）。主线 Migration 155 保留；Mission 顺延到 Migration 156 / schema 106。preparing 与 claim 共用准入检查，同时保留主线无时限执行的语义。

随后整合 `243eb748`（#399 文件链接间距）。这次整合只改 Renderer／UI 文档；冻结的 Core／Skill
内容指纹 `57adf680f418ab212392d3c79e533cc76e830d22ad34d82c99abf12e430d69d2` 保持不变。
相关 98 项单元测试、类型检查，以及文件预览、链接导航、使命生产组件三项桌面集成均通过。

生产组件的浅色／深色、1040／1440／2560 宽度及抽屉／完整会话草稿保持已验证。
更新原有 Pending v3 页面夹具到当前 v4 移回输入框语义；旧编辑 API 继续由 Core owner 覆盖。
回归同时修复迟到 route read 在本地输入后更新接收者的问题，既有 Coordinator 和真实 Composer owner 已覆盖。
真实运行入口为 `node scripts/smoke-mission.mjs <absolute-core> <new-output>`，显式创建独立 data-dir、Skill Library 与 Git/非 Git项目。
常规门禁与最终安装已完成；上下文 Gate 按用户追加指令提前结束，不记为完整通过。

真实运行第七次验收已通过六个阶段：保存不执行、开始幂等与 preparing 建工作区、A2A／非队长更新、
固定基准净 Diff 与文件来源、Core 重启及非 Git 普通消息、删除 worktree 并保留分支。证据位于
`/private/tmp/rovai-mission-evidence-20260915/runtime-7/report.json`，四个真实 Codex Run 均成功。
执行夹具使用独立空 `ZDOTDIR`，避免本机登录 Shell 把候选 CLI 的 PATH 改回日常安装版。

这轮实际执行发现并修复两条生命周期回归，均扩展既有 owner，没有新增平行测试：

- `team_tool::tests::public_delivery_runtime_consumes_the_pre_run_frozen_context_bytes` 增加当前 v24
  A2A 工作区类型传递；修复前接收 Run 的类型被重置为 shared，preparing 拒绝冻结输入。v22／v23 仍验证原有恢复。
- `collaboration::slow_tests::camp_rename_lead_change_and_quiescent_delete_are_versioned` 增加已经提交的
  Agent 文件 ingest intent；修复前删除其 Camp Message 触发外键错误。Camp 删除现在先移除随 Camp 清理的
  ingest intent，文件系统仍归原有清理 journal。最小命令为该名称的 `cargo test -p rovai-core --features slow-tests --lib`。

默认 Rust 工作区门禁通过；完整 slow-tests 首轮有 13 项失败，保留日志。其中 Git／进程测试受到共享
Runtime PATH 夹具或 deadline 影响，13 项在独立进程复验均通过，未将首轮记录改写为全绿。
生产 Mission UI fixture 通过整卡点击、项目右侧标签、多队员头像、抽屉／会话草稿保持、交付预览和来源跳转。
文件预览主题切换的回归也已通过：固定 CodeMirror phrases 配置身份，避免主题更新触发完整编辑器状态重置。

## 上下文评测提前结束

2026-09-15 用户追加指令“评测先结束吧”。已停止本轮 Gate 及全部已确认属于它的子进程，
没有继续启动评测或自动重跑。冻结计划、原始结果、失败记录与未完成项保持原样。

原计划为 12 Case／24 次版本运行；停止时已写入 15 个完整 slot。候选 DEMO-101 至 DEMO-108
八项硬验收及专项规则通过。DEMO-106 基线执行通过但评分中止；DEMO-109 基线运行中止；
其他未运行项不计通过。两个版本的 16 项合同检查均通过。

保留的限制包括：DEMO-104 基线写入了范围外文件；DEMO-105 候选的结果评审被模型服务以
`invalid_json_schema` 拒绝；DEMO-108 候选的声明准确性为部分满足。模型别名也不构成固定权重
快照证明。完整 Gate 未完成，不声称 Formal qualification、语义全部通过或统计上的非劣性。

停止记录与可视索引位于 `/private/tmp/rovai-mission-evidence-20260915/gate/user-stop-report.json`
和同目录 `index.html`，已经通过无界面浏览器打开检查。冻结计划摘要为
`adb670428da9d023bb2f6307e9d9a8404c25762e8987e567e76cb70603ddcd7f`。

## 安装边界

使用 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-mission-board` 的 `rovai/mission-board` 分支。
基线 `b2df4d85cdb8c6b8a9346290b16311b94fa4b7ed`。最后执行 `git pull --ff-only origin main`，
确认 main 为 `243eb748`（#399），并已整合进任务分支。
2026-09-15 从 daily profile 原子安装 `/Applications/Rovai AI.app`，安装脚本的三个位置验签均通过。
旧包保留在 `/Applications/Rovai AI.backup-before-mission-20260915-2132.app`。

`pnpm package:mac:daily` 已生成 arm64 ad-hoc 产物并通过验签。隔离 packaged App 的六项验收通过，
记录为 `/private/tmp/rovai-mission-evidence-20260915/packaged-1/report.json`：真实新使命弹窗保存、
Core admission、Mission RPC、整卡导航、普通会话顶栏、抽屉／完整会话草稿保持和交付／活动。
隔离目录使用自己的 `user-data/managed-skill-library` 与 `mcp.json`；没有启动额外的日常实例。

安装后 Core、Host、CLI 三个二进制与已验收源包的摘要一致，CLI 为 contract-v25／ipc-v2；
旧包 CLI 为 contract-v24。原 App PID 95883、Host PID 95895 及三个 Helper 均仍存活。
安装记录位于 `/private/tmp/rovai-mission-evidence-20260915/installation-1.json`。
磁盘新版本已经安装，当前进程仍为旧版本；用户稍后退出并从规范安装路径重新打开时生效。
Computer Use 保持关闭，未终止当前会话，也未改写日常用户数据。
