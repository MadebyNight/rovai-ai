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
- 执行台支持右侧、浮层和底部三个保存位置；右侧与 Mission 活动、文件共享标签集合和分栏比例。
- 进入普通或 Mission 会话时，只为最新 `running` Run 自动打开并定位最新指令；后台刷新不抢选择或焦点。
- 当前用户消息显示轻量处理回执，并在所有接收队员均未读时通过权威版本围栏直接撤回。

字段级协议见 [Mission v7](../../contracts/mission-v7.md)与
[Built-in Tool Transport v30](../../contracts/builtin-tool-transport-v30.md)；执行与消息增量见
[Run Process Detail Surface v35](../../contracts/run-process-detail-surface-v35.md)、
[File Preview v17](../../contracts/file-preview-v17.md)和
[Camp Message Send v23](../../contracts/camp-message-send-v23.md)。实施与验证见
[实施计划](implementation-plan.md)，取舍理由见[版本决定](decisions.md)。

## 当前状态

Core、catalog、CLI help、错误目录、异步 cleanup owner、使命板交互与当前权威文档已经同一版本实现；
Rust 全量与定向测试、Mission Electron 验收、TypeScript、文档治理、格式、编译及生产构建均已完成。
本版不轮换 data contract：继续使用 v1.61/schema 116；清理复用 schema 112 已有 workspace 状态、命令身份、
expected OID 与双检查点，不新增 Migration。

同日完成的 Agent Run Card 与用户消息撤回增量只调整 Renderer 编排、安装级位置偏好和既有 Domain Command
准入，不增加 Migration、Runtime 输入版本或 AgentRun 状态。

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

## Agent Run Card 与消息撤回增量

执行台使用 `right | inspector | bottom` 三个安装级保存位置。右侧 Execution 是无文件能力的合成标签，和
Mission Activity、普通文件共用标签集合与分栏比例；切换标签或自动打开不会改变文件预览宽度。总览、当前执行、
聚合排队批次和默认折叠的执行历史复用同一详情 DOM，紧凑 Run 卡片只保留触发消息摘要、状态、耗时与按需动作。

从其他页面、Camp 或应用恢复进入普通或 Mission 会话时，只以精确 `status=running` 的最新 Run 触发自动打开，
展开后定位最新已载入指令；用户停留底部时继续跟随，上滚后暂停。Mission 仍先建立 Activity；保存位置为右侧且
存在 running Run 时，Execution 取得当前显示，Activity 保留为可切换标签。后台刷新和后续状态变化不重复执行
进入规则，也不抢键盘焦点。

当前用户消息下方显示聚合处理回执，具体接收队员按需展开；队员消息继续使用既有底色框。撤回入口只采用
`CampMessageView.canWithdraw` 和 `expectedVersion`，确认文案为“所有接收队员均未读，可直接撤回。”；取消只关闭
弹窗，确认复用既有 `camp.messages.withdraw` 原子语义。Desktop 与 Web Host 接受同一 operation，成功后原位置显示
撤回标记，不创建新的 AgentRun 取消原因。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.61 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v1.62 |
| Decisions | 已更新 | [版本决定](decisions.md)记录状态/消息解耦、异步 cleanup owner 与独立列滚动取舍；Agent Run Card 按已确认交互和当前合同实施，不新增高成本架构决定 |
| Contracts | 已更新 | 发布 [Mission v7](../../contracts/mission-v7.md)、[Run Process Detail Surface v35](../../contracts/run-process-detail-surface-v35.md)、[File Preview v17](../../contracts/file-preview-v17.md)与[Camp Message Send v23](../../contracts/camp-message-send-v23.md)；Built-in 继续使用 [v30](../../contracts/builtin-tool-transport-v30.md) |
| Architecture | 已更新 | Mission 与 Built-in Tool Runtime 明确状态及 cleanup 边界；File Preview、Public Message Delivery 与统一 Host 同步共享标签、撤回和 Host 准入 |
| UI | 已更新 | [使命板 UI](../../ui/components/mission-board.md)增加独立列滚动与清理恢复；[Camp 会话工作区](../../ui/components/conversation-workspace.md)和[文件预览区](../../ui/components/file-preview.md)同步三位置执行台、进入规则、回执和共享分栏 |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Runtime Activity 分类、证据来源或展示映射 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter 行为或平台资格；只轮换 Rovai-owned Built-in capability |
| Documentation routing | 已更新 | 文档任务入口、合同索引、当前决定导航和版本索引指向 v1.62 及本增量的当前权威 |
| Root README | 确认无需更新 | Mission 状态输入约束不改变项目定位、安装方式或公开支持范围 |
