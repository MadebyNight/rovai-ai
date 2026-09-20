---
document_type: version-overview
version: v1.62
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: true
last_updated: 2026-09-20
---

# Rovai-ai v1.62：Mission 状态解耦、执行提示与工作区收敛

前置：[v1.61](../v1.61/README.md)。本版让 Mission 业务状态成为真正独立的操作：有权修改当前
Mission 的 Agent 可直接设置任一状态，`sourceMessageId` 对所有状态都只是可选关联；并把 Worktree 清理改为
持久意图驱动的后台流程，让使命板各状态列独立滚动，同时让启动入口和执行提示直接跟随 Delivery/AgentRun
事实，并保留既有视觉体系。

## 目标

- `needs_you` 与 `completed` 不再要求 Agent 先发布消息并取得消息 ID。
- 显式来源仍必须是同 Camp、已公开且未删除的消息；无效来源原子拒绝。
- 省略来源会清除旧关联；状态与关联共同决定 `changed`，Replay 与活动幂等保持不变。
- catalog、真实 CLI help、实际错误恢复和 Core 使用同一语义。
- 状态解耦不改变 Mission 修改权限、执行生命周期、数据库、Bootstrap、Run Facts、ContextManifest 或 UI wire；
  启动增量只为既有 path-free `MissionRecord` 增加 `startAvailable`。
- 已确认的 Mission
  续作增量只在专属 Bootstrap 中增加一条工作目录说明并轮换 Session Charter revision。
- Worktree 清理命令先拒绝可预见的脏现场与不安全 detached 提交；独立后台 owner 按目录归属、expected OID 和双检查点执行，未发生删除的失败可安全恢复。
- 删除使命并清理时，清理意图与 Camp/Mission 删除同事务提交，卡片先消失，后续失败进入既有 orphan route。
- 持久 Mission Worktree 的当前分支不再作为执行门禁；受管分支身份保留给资源清理，活动页实时展示 checkout。
- 累计 Diff 继续使用固定 `base_sha`，checkout 与列表同次刷新，文件详情不复用旧临时 index。
- 看板四个状态列各自拥有纵向滚动位置；标题、筛选和列头固定，窄桌面窗口只在看板区域横向切换。
- 跨列拖动在目标列边缘自动滚动；右键和 Shift+F10 继续提供同一非拖拽状态操作。
- 执行台支持右侧、浮层和底部三个保存位置；右侧与 Mission 活动、文件共享标签集合和分栏比例。
- 进入普通或 Mission 会话时，只为最新 `running` Run 自动打开并定位最新指令；后台刷新不抢选择或焦点。
- 当前用户消息显示轻量处理回执，并在所有接收队员均未读时通过权威版本围栏直接撤回。
- Mission 启动受理后立即隐藏入口；claim 创建 queued Run 即显示“执行中”，不等待 Runtime 连接或输出。
- 等待领取的启动 Delivery 只关闭重复启动入口，不伪装成执行；普通消息 claim 后使用同一活跃 Run 判定。
- 使命板一级入口蓝点按 Core-owned `hasUnread` 统计有未读 Agent 回复的使命，不再复用 `needs_you` 状态。

字段级协议见 [Mission v10](../../contracts/mission-v10.md)与
[Built-in Tool Transport v30](../../contracts/builtin-tool-transport-v30.md)；执行与消息增量见
[Run Process Detail Surface v35](../../contracts/run-process-detail-surface-v35.md)、
[File Preview v17](../../contracts/file-preview-v17.md)和
[Camp Message Send v23](../../contracts/camp-message-send-v23.md)。实施与验证见
[实施计划](implementation-plan.md)，取舍理由见[版本决定](decisions.md)。

Mission Bootstrap 续作提示的完整前后合同、版本边界与二次确认见
[模型上下文变更 revision 3](model-context-change-mission-continuation.md)。

## 当前状态

状态解耦、异步 cleanup、独立列滚动、Agent Run Card 与消息撤回增量已经完成实现及各自验收。
Mission 启动与执行提示的 Core/Renderer/合同实现与全量门禁已经完成，由 PR #453 合入 `main`，并验证功能
提交是最新 `origin/main` 的祖先。使命板入口蓝点现与卡片共用 `MissionRecord.hasUnread`，业务状态不再影响其显示。
本版不轮换 data contract：继续使用 v1.61/schema 116；清理复用 schema 112 已有 workspace 状态、命令身份、
expected OID 与双检查点，不新增 Migration。

Mission Worktree checkout 增量同样不轮换 data contract：已有 `branch` 列继续是唯一受管分支记录，对外投影为
`managedBranch`；实时 `checkoutState` 和进程内 Diff view handle 均不持久化。

同日完成的 Agent Run Card 与用户消息撤回增量只调整 Renderer 编排、安装级位置偏好和既有 Domain Command
准入，不增加 Migration、Runtime 输入版本或 AgentRun 状态。

同日完成的 Camp Open 职责增量将 `camps.open` 和 enter 的投影阶段收敛为实际零写入读取：旧取消协议修复前移到
mandatory startup recovery，终态文本写入失败由原 block 保存退避并接入既有 AgentRun maintenance tick。
它不新增 timer、worker、数据库表、连接、Migration 或 Renderer wire；字段级边界见
[Camp Open Projection v20](../../contracts/camp-open-projection-v20.md)。

Mission 续作增量把 Session Charter revision 从 10 轮换到 11，只增加一条继续使用已准备工作目录及当前
checkout 的默认指导。Bootstrap contract/Formatter、Context Formatter/Manifest/Profile、Schema 与 Runtime
compaction 行为均不变。

## Worktree 异步清理增量

`missions.workspace.cleanup` 在持久化 `cleanup_pending` 与命令结果后立即返回；独立 cleanup worker 使用通知快路和
固定维护兜底继续执行 verified Worktree removal 与 expected-OID branch deletion。实时 Mission 投影公开
cleaning/failed/cleaned 及两个 path-free checkpoint，failed 不自动重试。使命删除的 cleanup intent 与聚合删除
同事务，资源失败只保留 orphan cleanup 行，不恢复使命卡片。

Renderer 把资源状态固定在现有卡片层级中；确认窗不承担长期进度。失败同时进入可操作 Toast、卡片持久错误和
详情重试，部分失败只显示/重试本地分支；成功提示约四秒且刷新或重进不重播。删除后的失败沿用
“工作区待清理”入口。

## Worktree checkout 与当前 Diff 增量

既有 Worktree 的执行校验只证明路径、仓库、Git 注册、owner marker、Host 与执行目录；当前分支、受管分支是否
仍存在、detached HEAD、checkout 读取和固定基准可读性不再成为 Runtime 门禁。Rovai 不自动切分支、接管分支或
重设基准。活动页一次返回实时 checkout 和相对固定基准的累计变化；文件详情使用新临时 index 重读当前状态，
旧请求迟到时由 view association 和 Renderer generation 丢弃，不新增监听、哈希或持久快照。清理仍只把受管分支
与 expected OID 作为分支删除身份；Worktree 目录由路径、注册和 owner marker 独立证明。干净的非受管具名 checkout
允许删除目录并保留其分支，脏现场和没有其他持久引用的 detached 提交继续保留。

## 使命板独立列滚动增量

Board mode 把每个 status lane 的 card region 变成独立、可聚焦、contained-overscroll 的纵向 scroll owner；页面标题、
筛选和列头不进入该滚动区。外层 board host 仅在窄桌面窗口或放大时横向滚动并保留最小列宽。Mission/cleanup 异步
更新、详情抽屉开合和其他列的状态变化复用稳定 lane DOM，不重置已有位置；列表往返恢复各列 offset，搜索/筛选
更新从新结果顶部开始。拖拽靠近目标列上下边缘时只自动滚动目标列；紧凑状态入口可直接横向定位。
卡片不显示省略号；右键菜单与 Shift+F10 状态入口共用同一操作菜单，继续提供非拖拽操作路径。行为参考稿不作为视觉
还原目标，现有组件层级、色彩和卡片样式保持权威。

## Agent Run Card 与消息撤回增量

执行台使用 `right | inspector | bottom` 三个安装级保存位置。右侧 Execution 是无文件能力的合成标签，和
Mission Activity、普通文件共用标签集合与分栏比例；切换标签或自动打开不会改变文件预览宽度。总览、当前执行、
聚合排队批次和默认折叠的执行历史复用同一详情 DOM，紧凑 Run 卡片只保留触发消息摘要、状态、耗时与按需动作。

从其他页面、Camp 或应用恢复进入普通或 Mission 会话时，只以精确 `status=running` 的最新 Run 触发自动打开，
展开后定位最新已载入指令；用户停留底部时继续跟随，上滚后暂停。Mission 仍先建立 Activity；保存位置为右侧且
存在 running Run 时，Execution 取得当前显示，Activity 保留为可切换标签。后台刷新和后续状态变化不重复执行
进入规则，也不抢键盘焦点。

当前用户消息的“待处理 / 处理中”聚合回执与复制按钮保持同一操作行，终态失败不增加“未完成”汇总；
具体接收队员按需展开。执行历史标题只显示历史总数，不增加失败待处理汇总。队员消息继续使用既有底色框。撤回入口只采用
`CampMessageView.canWithdraw` 和 `expectedVersion`，确认文案为“所有接收队员均未读，可直接撤回。”；取消只关闭
弹窗，确认复用既有 `camp.messages.withdraw` 原子语义。Desktop 与 Web Host 接受同一 operation，成功后原位置显示
撤回标记，不创建新的 AgentRun 取消原因。

## Mission 启动与执行提示增量

Mission read model 公开 Core-owned `startAvailable`，并把 `runningAgentIds` 的非终态集合补齐为
queued/running/waiting。只有 Mission start Delivery 的 waiting/claimed 或 Camp 内非终态 Run 会关闭启动入口；
普通等待消息不伪装为执行。`missions.start` 在同一事务复用该判定，因此旧投影或快速连点也不会追加启动任务。

Renderer 在点击后立即保留按钮几何、禁用并显示“正在开始…”；受理成功后先以本地确认态隐藏，再由权威投影接管，
明确拒绝才恢复并提示错误。Delivery batch claim 新增普通导航失效提示，使使命板、抽屉和完整会话在 Runtime
连接前就能刷新 queued Run。内部 Mission start 消息继续从 Timeline 过滤，业务状态不随启动或 Run 自动变化。

## Camp Open 只读职责增量

普通取消、成功和失败继续由现有 Domain Command Gateway 在业务提交后收尾正文，受控关闭与 planned-shutdown
直提交流程保留自己的提交后调用。旧两阶段取消中间态只在 Core ready 前按精确持久条件扫描并统一 settlement；
失败沿用 authority recovery 的 fail-closed 处理，重复启动零结算。

文本收尾失败保留原内存 block、失败次数和单调到期时间。现有 500ms maintenance tick 在无失败或未到期时不读
Run/Camp，到期只重试文本并在成功后复用 block event；失败最高退避至 30 秒。Camp open/read-only enter 的回归同时
用 SQLite authorizer 阻断 DML 并检查 `managed-blobs` 文件目录，证明跨 Camp 待收尾正文不会被读取入口冲刷。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.61 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v1.62 |
| Decisions | 已更新 | [版本决定](decisions.md)记录状态/消息解耦、异步 cleanup owner、独立列滚动及受管分支与实时 checkout 分离取舍；Agent Run Card 按已确认交互和当前合同实施，不新增高成本架构决定 |
| Contracts | 已更新 | 发布 [Mission v8](../../contracts/mission-v8.md)、v9 后继续发布当前 [Mission v10](../../contracts/mission-v10.md)，并发布 [Run Process Detail Surface v35](../../contracts/run-process-detail-surface-v35.md)、[File Preview v17](../../contracts/file-preview-v17.md)、[Camp Message Send v23](../../contracts/camp-message-send-v23.md)与 [Camp Open Projection v20](../../contracts/camp-open-projection-v20.md)；[ContextManifest v27](../../contracts/context-manifest-evidence-v27.md)记录 Session Charter revision 11，Built-in 继续使用 [v30](../../contracts/builtin-tool-transport-v30.md) |
| Architecture | 已更新 | Mission 明确状态、cleanup、启动可用性、claim 后执行投影、checkout 执行准入及固定基准 Diff 边界；File Preview、Public Message Delivery 与统一 Host 同步共享标签、撤回和 Host 准入；Camp Open、启动恢复与文本维护明确读取/恢复 owner |
| UI | 已更新 | [使命板 UI](../../ui/components/mission-board.md)增加独立列滚动、清理恢复、一致启动/执行反馈、Core-owned 未读入口蓝点及实时 checkout/Diff 刷新；[Camp 会话工作区](../../ui/components/conversation-workspace.md)和[文件预览区](../../ui/components/file-preview.md)同步三位置执行台、进入规则、回执和共享分栏 |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Runtime Activity 分类、证据来源或展示映射 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter 行为或平台资格；只轮换 Rovai-owned Built-in capability |
| Documentation routing | 已更新 | 文档任务入口、合同索引、当前决定导航和版本索引指向 v1.62 及本增量的当前权威 |
| Root README | 确认无需更新 | Mission 状态输入约束不改变项目定位、安装方式或公开支持范围 |
