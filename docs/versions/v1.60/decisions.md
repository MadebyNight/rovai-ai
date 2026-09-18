---
document_type: version-decisions
version: v1.60
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-17
---

# v1.60 版本决定

<a id="v1-60-d01"></a>
## V1.60-D01：等待责任属于 Delivery，执行边界属于冻结后的多输入 AgentRun

- 状态：accepted
- 日期：2026-09-17
- 当前权威：revision 2 已确认，按本决定实施

提前创建可追加 queued Run 会把排队、配置和执行身份混成一个可变对象。选择只持久化按
`CampId + AgentId` 排序的 Delivery，在 Scheduler claim 时原子选择队首完整前缀、创建 Run 并冻结有序输入、
当前执行配置和最后一条输入锚点。代价是 UI 只能把等待显示为队列预览，但 crash 恢复、设置变更、撤回和
Run immutability 都只剩一个权威边界。

<a id="v1-60-d02"></a>
## V1.60-D02：删除 CampTurn 执行权威、协作预算与 Gather，不建立换名替代物

- 状态：accepted
- 日期：2026-09-17
- 当前权威：revision 2 已确认，按本决定实施

CampTurn 同时承担调度、预算、完成聚合和渠道归属，迫使无关 Agent 互相等待，也让多输入 Run 必须选择虚假的
单一因果根。选择删除它对新执行的权威，并同时删除累计次数、deadline、fanout/depth、预算投影和 Gather
Barrier/completion。多人邀请与返回全部使用普通消息；Task、Mission、Automation 和 Channel 各自结算。

系统明确接受自动协作不再保证在固定次数或时长内结束，也不保证多人回复只唤醒主持人一次。历史 CampTurn、
Gather 和冻结 evidence 只读保留，不能被迁移伪造成新协议对象。

<a id="v1-60-d03"></a>
## V1.60-D03：撤回以首次 Agent 认知边界为门槛，并擦除 Rovai 控制范围内的原文

- 状态：accepted
- 日期：2026-09-17
- 当前权威：revision 2 已确认，按本决定实施

若目标 Agent 在 claim 前能从公共历史看见正文，“等待中”和撤回就不可信。选择在任何目标首次 claim 前只向
Principal 展示本地 Composer 消息；claim 事务使消息失去撤回资格。成功撤回删除 Rovai 活跃数据中的正文、
本消息引用/附件关系、搜索索引、缓存和普通内容摘要，只保留顺序、撤回者、时间、取消事实及无正文的
erased-terminal command receipt。

这不是取证级擦除，不覆盖 WAL、备份、剪贴板、用户原文件或第三方副本。Channel、Automation、Agent 和 A2A
内容有独立上游或执行证据，因此不复用该原文擦除合同。

<a id="v1-60-d04"></a>
## V1.60-D04：Agent-facing Built-in 结果完整交付或明确失败，不按总量静默降级

- 状态：accepted
- 日期：2026-09-17
- 当前权威：revision 2 已确认，按本决定实施

统一 1/8/16 MiB 或 Camp Read 80k 总量阈值会让合法成功结果在不同层被拒绝、截断或偷偷缩页。选择删除这些
Rovai-owned 全局总量规则；底层仍可使用 bounded buffer、chunk、backpressure 和 managed spool，但不能改变一个
调用的逻辑结果。完整到达才是成功，无法完整交付就明确失败或中断。

Runtime 输入是另一条边界：Scheduler 必须知道能冻结多少必要消息，因此继续使用 claim 时解析的 payload budget，
未声明能力默认 96 KiB，不再把 1 MiB 写成通用上限。

<a id="v1-60-d05"></a>
## V1.60-D05：Channel 与 Automation 复用普通消息和 Delivery，只保留自己的业务结果

- 状态：accepted
- 日期：2026-09-17
- 当前权威：revision 2 已确认，按本决定实施

Channel 入站在 CampMessage 与目标 Delivery 提交后即完成接收，外部回复由独立 ChannelDelivery 负责；
Channel-bound Camp 的 Agent 公开消息默认外发，不根据 Run 来源、合批组成或 anchor 推断。失败只重试 outbox，
不重跑模型。公开 `rovai send` 是对该 Channel Camp 外部可见的成员发言，不再混用作私有控制通道。

Automation 触发原子创建 started occurrence、新 Camp、系统消息和 Delivery，再由普通 Scheduler claim；相同
Automation 尚有 active occurrence 时直接 skipped(overlap)。不新增 queued occurrence、专用 AgentRun 输入或来源型
批次边界，occurrence timeout 与通知仍由 Automation 自己结算。

<a id="v1-60-d06"></a>
## V1.60-D06：普通 Delivery 使用单一事件唤醒 claim owner 与固定全局兜底

- 状态：accepted
- 日期：2026-09-18
- 当前权威：Public Camp Message/Delivery 架构与 Message Delivery v9

固定 500ms 扫描让空闲 Core 持续申请普通队列写事务，并把正常消息启动和同 lane 接续增加至多一个 tick 的等待；
终态、网络恢复和周期扫描又各自可能领取新 Delivery，使 claim 所有权分散。选择由单一常驻 Scheduler 拥有普通
batch claim：状态提交后只发送无负载 wake，Scheduler 从数据库分页领取并并发准备 Runtime；终态只结算和 wake，
网络恢复只派发其明确获准的既有 Run。

本次不保存精确 lane hint，也不引入持久通知或新的恢复状态机。相比按需启停 timer，保留一个不会被普通 wake 推迟的
全局 30 秒兜底更简单且能覆盖进程内漏通知；代价是空闲时仍有低频只读检查。兜底确认无 waiting Delivery 或 queued
batch Run 后不进入 claim 写事务。原 500ms 循环保留既有非 batch Run 派发、Automation、取消、Single Chat 与维护职责，
但不得领取普通 Delivery 或派发普通 queued batch Run。
