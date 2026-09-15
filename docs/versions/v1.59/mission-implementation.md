---
document_type: implementation-plan
version: v1.59
status: in_progress
last_updated: 2026-09-15
---

# 桌面使命实施

开发者已确认[模型输入 revision 3](model-context-change-mission.md)。原始使命方案与后续反馈共同决定
产品范围：使命与 Task／执行状态分离；一个主 Camp；用户开始或消息触发执行；持久 Git 工作区和固定基准 Diff；
非 Git 使用原目录，无分支与 Diff；只向桌面开放。

## 交付步骤

| 步骤 | 状态 | 完成条件 |
| --- | --- | --- |
| 领域与持久化 | 进行中 | 原子 Mission + Camp、当前成员权限、后提交字段覆盖、历史、标签／PR |
| 工作区与 Git | 待完成 | preparing 才创建、稳定关联、实际 Git 净 Diff、冲突／恢复／清理 |
| 输入与 CLI | 待完成 | 已确认 shape、版本轴与证据，三个 Mission 操作 |
| 桌面 | 待完成 | 真正导航、列表／看板、抽屉、会话板、交付／活动、普通会话状态复用 |
| 验证与安装 | 待完成 | 定向及仓库门禁、隔离执行／UI、上下文 Gate、同步 main、daily 安装 |

## 测试准入

现有 `collaboration`、`runtime`、`context`、`db` owner 已检索；没有 Mission 领域与持久 worktree owner。
新增测试按独立失败语义分配，不建立平行全栈 fixture：

- Mission 事务 owner：创建失败不残留 Camp，成员权限、同字段最后提交、不同字段保留、no-op 与幂等；
  SQLite 事务是合同本体，需要隔离数据库。最小命令 `cargo test -p rovai-core --lib mission::tests`。
- Git 文件系统 owner：固定基准、临时 index 保真实 index、未跟踪／忽略／二进制／特殊路径、冲突及恢复；
  纯 parser 矩阵不能证明 Git 行为，使用临时真实仓库。最小命令 `cargo test -p rovai-core --lib mission_workspace::tests`。
- 已有 Context Evidence owner 扩展使命输入、once-per-binding ACK 和恢复负向分支；沿用唯一 golden，不复制 JSON 断言。
- Migration 155 扩展现有数据库迁移 owner，保留所有受支持来源；运行定向 migration 与 admission 检查。

真实模型只在隔离 Smoke 和已冻结 Gate 中运行。交互稿的 15 组 fixture 检查不构成以上产品验收。

## 安装边界

使用 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-mission-board` 的 `rovai/mission-board` 分支。
基线 `b2df4d85cdb8c6b8a9346290b16311b94fa4b7ed`。最终同步 main 后按本地流程打包／隔离验收，
从 daily profile 原子安装 `/Applications/Rovai AI.app`，保留备份和当前宿主进程。尚未安装。
