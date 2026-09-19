---
document_type: version-overview
version: v1.62
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-09-20
---

# Rovai-ai v1.62：Mission 状态解耦、异步清理与独立看板滚动

前置：[v1.61](../v1.61/README.md)。本版让 Mission 业务状态成为真正独立的操作：有权修改当前
Mission 的 Agent 可直接设置任一状态，`sourceMessageId` 对所有状态都只是可选关联；并把 Worktree 清理改为
持久意图驱动的后台流程，让使命板各状态列独立滚动，同时保留既有视觉体系。

## 目标

- `needs_you` 与 `completed` 不再要求 Agent 先发布消息并取得消息 ID。
- 显式来源仍必须是同 Camp、已公开且未删除的消息；无效来源原子拒绝。
- 省略来源会清除旧关联；状态与关联共同决定 `changed`，Replay 与活动幂等保持不变。
- catalog、真实 CLI help、实际错误恢复和 Core 使用同一语义。
- 不改变 Mission 修改权限、执行生命周期、数据库、Bootstrap、Run Facts、ContextManifest 或 UI wire。
- Worktree 清理命令只提交持久意图；独立后台 owner 按 expected OID 和双检查点执行，failed 只显式重试。
- 删除使命并清理时，清理意图与 Camp/Mission 删除同事务提交，卡片先消失，后续失败进入既有 orphan route。
- 看板四个状态列各自拥有纵向滚动位置；标题、筛选和列头固定，窄桌面窗口只在看板区域横向切换。
- 跨列拖动在目标列边缘自动滚动；省略号、右键和 Shift+F10 继续提供同一非拖拽状态操作。

字段级协议见 [Mission v7](../../contracts/mission-v7.md)与
[Built-in Tool Transport v30](../../contracts/builtin-tool-transport-v30.md)，实施与验证见
[实施计划](implementation-plan.md)，取舍理由见[版本决定](decisions.md)。

## 当前状态

Core、catalog、CLI help、错误目录、异步 cleanup owner、使命板交互与当前权威文档已经同一版本实现；
Rust 全量与定向测试、Mission Electron 验收、TypeScript、文档治理、格式、编译及生产构建均已完成。
本版不轮换 data contract：继续使用 v1.61/schema 116；清理复用 schema 112 已有 workspace 状态、命令身份、
expected OID 与双检查点，不新增 Migration。

## Worktree 异步清理增量

`missions.workspace.cleanup` 在持久化 `cleanup_pending` 与命令结果后立即返回；独立 cleanup worker 使用通知快路和
固定维护兜底继续执行 verified Worktree removal 与 expected-OID branch deletion。实时 Mission 投影公开
cleaning/failed/cleaned 及两个 path-free checkpoint，failed 不自动重试。使命删除的 cleanup intent 与聚合删除
同事务，资源失败只保留 orphan cleanup 行，不恢复使命卡片。

Renderer 把资源状态固定在现有卡片层级中；确认窗不承担长期进度。失败同时进入可操作 Toast、卡片持久错误和
详情重试，部分失败只显示/重试本地分支；成功提示约四秒且刷新或重进不重播。删除后的失败沿用
“工作区待清理”入口。

## 使命板独立列滚动增量

Board mode 把每个 status lane 的 card region 变成独立、可聚焦、contained-overscroll 的纵向 scroll owner；页面标题、
筛选和列头不进入该滚动区。外层 board host 仅在窄桌面窗口或放大时横向滚动并保留最小列宽。Mission/cleanup 异步
更新、详情抽屉开合和其他列的状态变化复用稳定 lane DOM，不重置已有位置；列表往返恢复各列 offset，搜索/筛选
更新从新结果顶部开始。拖拽靠近目标列上下边缘时只自动滚动目标列；紧凑状态入口可直接横向定位。
卡片省略号、右键菜单与 Shift+F10 状态入口共用同一操作菜单，继续提供非拖拽操作路径。行为参考稿不作为视觉
还原目标，现有组件层级、色彩和卡片样式保持权威。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.61 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v1.62 |
| Decisions | 已更新 | [版本决定](decisions.md)记录状态/消息解耦、异步 cleanup owner 与独立列滚动取舍 |
| Contracts | 已更新 | 发布 [Mission v7](../../contracts/mission-v7.md)并保留 [Mission v6](../../contracts/mission-v6.md) 的状态来源语义；Built-in 继续使用 [v30](../../contracts/builtin-tool-transport-v30.md) |
| Architecture | 已更新 | Mission 与 Built-in Tool Runtime 明确独立状态操作、可选来源、catalog-owned recovery、cleanup owner 和删除顺序 |
| UI | 已更新 | [使命板 UI](../../ui/components/mission-board.md)增加独立列滚动、拖拽边缘滚动、窄窗横向切换与 Worktree 清理状态/恢复，沿用现有视觉体系 |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Runtime Activity 分类、证据来源或展示映射 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter 行为或平台资格；只轮换 Rovai-owned Built-in capability |
| Documentation routing | 已更新 | 文档任务入口、合同索引、当前决定导航和版本索引指向 v1.62 当前权威 |
| Root README | 确认无需更新 | Mission 状态输入约束不改变项目定位、安装方式或公开支持范围 |
