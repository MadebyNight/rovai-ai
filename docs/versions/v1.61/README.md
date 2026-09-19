---
document_type: version-overview
version: v1.61
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: true
last_updated: 2026-09-19
---

# Rovai-ai v1.61：Mission 全局发现与统一内部标识

前置：[v1.60](../v1.60/README.md)。本版把 Mission 的 Agent read side 从“读取当前 Camp Mission”扩展为
“发现全部 Mission，并按内部 ID 读取任意 Mission”，同时保持修改只作用于当前公共 Mission。

## 目标

- 数据库关系、内部事件、Agent Mission 操作与模型上下文共用内部 `rvm_...` ID；`M-xxx` 只供 UI 展示。
- 增加轻量、数值倒序、基于游标的 `mission.list`；`mission.get` 接受可选内部 ID。
- `mission.get` 返回保存的结构化附件元数据和必填原路径，不访问文件系统或重算目录。
- 所有有效 AgentRun 都能读取全部 Mission；目标 Camp membership 不是 read ACL。
- `mission.update/status` 不增加目标选择器，跨 Mission 读取不切换当前目标或扩大写权限。
- 公共与 Single Chat Bootstrap 只补入口；CLI 精确 help 拥有单次调用教学，`cli-operations` 只补多步协调规则。
- 新生成的 Run Facts 与 Mission 引用继续直接使用 `rvm_...`，不增加 number，也不建立 ID 转换层。

字段级协议见 [Mission v5](../../contracts/mission-v5.md)、
[Built-in Tool Transport v29](../../contracts/builtin-tool-transport-v29.md)与
[Single Chat v6](../../contracts/single-chat-v6.md)。模型输入的完整前后对照见
[确认说明 revision 2](model-context-change-mission-discovery.md)，实施与验证见
[实施计划](implementation-plan.md)，高成本取舍见[版本决定](decisions.md)。

## 当前状态

模型上下文 revision 2 已由开发者确认。Core read side、catalog/CLI、Context 投影、Single Chat policy、
Migration 165/schema 115、Skill、Renderer 命令映射与当前权威文档已经同一版本实施。Rust 全量测试、
TypeScript/Vitest、文档治理、Skill、格式与编译检查均已完成，PR #437 的远端 gate 已通过。此处记录的是
仓库实现完成状态，不把未执行的安装包、第三方真实 Runtime 或真实渠道 Smoke 描述为发布资格。

数据契约随 Single Chat policy 约束从 v1.60/schema 114 迁移到 v1.61/schema 115。Migration 165 只重建
`agent_run` 的 policy-version 约束并保留既有行、索引、trigger 与外键；普通 Camp Run 仍固定 version 1，
历史 Single Chat version 1 保持可执行，新 Single Chat Run 使用 version 2。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.60 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v1.61 |
| Decisions | 已更新 | [版本决定](decisions.md)记录统一内部 ID/global read seam 以及 Single Chat policy 版本化取舍 |
| Contracts | 已更新 | 发布 [Mission v5](../../contracts/mission-v5.md)、[Built-in Tool Transport v29](../../contracts/builtin-tool-transport-v29.md)与[Single Chat v6](../../contracts/single-chat-v6.md) |
| Architecture | 已更新 | Mission、Built-in Tool Runtime、Single Chat 与基础不变量同步全局读、当前写和版本边界 |
| UI | 已更新 | 使命板继续显示 `M-xxx`；Built-in Activity 的精确命令映射新增 `rovai mission list`，无其他交互或视觉变化 |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Runtime Activity 分类、证据来源或展示映射 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter 启动、模型、权限或平台资格；仅轮换 Rovai-owned Built-in capability |
| Documentation routing | 已更新 | 文档任务入口、合同索引、当前决定导航和版本索引指向 v1.61 当前权威 |
| Root README | 确认无需更新 | Mission Agent 读取协议不改变项目定位、安装方式或公开 Runtime 支持范围 |
