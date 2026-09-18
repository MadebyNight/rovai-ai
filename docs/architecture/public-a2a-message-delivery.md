---
document_type: architecture
architecture: public-a2a-message-delivery
authority: public-message-delivery-and-agent-run-boundaries
status: accepted
last_updated: 2026-09-18
---

# Public Camp Message、Delivery 与 AgentRun

本架构定义公开 Camp 的统一消息执行主链。字段合同见 [Camp Message Send v21](../contracts/camp-message-send-v21.md)、
[Message Delivery v9](../contracts/message-delivery-v9.md)、[ContextManifest 26](../contracts/context-manifest-evidence-v26.md)
与 [Camp History v7](../contracts/camp-history-v7.md)。Single Chat 不使用本主链。

## 三类事实

```text
public CampMessage
  └─ waiting Delivery × explicit target
       └─ Scheduler claims one FIFO prefix
            └─ immutable multi-input AgentRun
                 ├─ AgentRunInput × N
                 ├─ frozen ContextManifest
                 └─ Runtime input / execution evidence
```

- `CampMessage` 是公共内容、作者、顺序、锚点、引用和附件的唯一事实。
- `Delivery` 是一个目标 Agent 对该消息的待处理责任，是等待队列的唯一事实。
- `AgentRun` 是一次实际执行；它只在 claim 成功后创建，并冻结本次输入和执行配置。

三者不能互相冒充：公开消息没有“所有目标已完成”的全局状态；Run 结束只说明一次执行结束；Task、Mission、
Automation occurrence 与 ChannelDelivery 继续由自己的业务状态结算。CampTurn 只保留历史读取，不参与新执行。

## 发布与寻址

Core 在同一事务中验证作者、Camp membership、显式目标、self-send、正文/结构化内容、附件和命令幂等，随后写入一个
公共消息以及每个目标一条 waiting Delivery。`--public-only` 只发布消息。多个目标共享消息内容，但没有预算、额度、
Gather 或通用完成集合。

Anchor 只表达默认回复展示关系，不能推导目标、caller return、权限或完成。Agent 发言通常继承所属 Run 的冻结 anchor；
用户显式回复使用自己选择的 anchor。Core 不再维护 forward/return、root、depth、ancestor cycle 或 A2A 预算；只有
self-send 继续拒绝。显示名兼容解析若仍存在，只在发送事务内解析为 canonical Agent ID，后续队列不重新解析正文。

## Delivery-first 调度

每个 `(CampId, AgentId)` 有一条按消息 sequence 排序的 waiting Delivery 队列。等待阶段不创建 queued Run，也不冻结
Runtime 配置。Scheduler 获得执行资格时，在一个事务中：

1. 检查当前 membership、lane 与执行隔离门禁；
2. 读取当前 Runtime、模型、模式、工作区、工具与权限配置；
3. 从队首选取能完整交付的最大连续前缀，不跳过任何中间项；
4. 创建一个 batch AgentRun 和有序 AgentRunInput；
5. 以最后一条输入作为 Run anchor，冻结 ContextManifest 和实际执行配置；
6. 把所选 Delivery 原子改为 claimed 并绑定该 Run。

用户、Agent、Mission、Automation 与 Channel 来源使用同一规则，不形成批次边界。新消息不会追加到已冻结 Run。
commit 前崩溃只留下 waiting Delivery；commit 后恢复同一 Run。设置变化影响未 claim 消息，不改变既有 Run。

必要 `RUN_INPUT` 优先于可选历史。队首单条也超过当前 Runtime profile 时，Core 创建明确的 preflight-failed Run，
不向 Runtime 发送截断内容，并让队列随后继续。完整选择规则见 [Profile 7](../contracts/context-delivery-profile-v7.md)。

## 可见性与撤回

本地 Principal Composer 消息在所有目标仍未 claim 时可撤回，并对所有 Agent 隐藏。首个目标 claim 原子关闭撤回资格。
此后已 claim 目标通过 `RUN_INPUT` 接收；仍未 claim 的目标继续被所有 Agent-facing 读取路径隔离；非目标 Agent 按普通
公共规则读取。撤回成功取消所有 waiting Delivery 并擦除 Rovai 活跃数据中的原文；人类时间线占位不是 Agent MessageView。

自动上下文、`camp.read`、搜索、线程、reply 展开和结构化引用共享同一可见性服务。ContextManifest 冻结自动上下文，
但 Run 内的 `camp.read` 始终按调用时最新状态读取，不受 Manifest 上下界限制。

## 终态、停止与恢复

Run 终态按输入 Delivery 分别写入 `settled | failed | cancelled`。普通 Stop 以精确 `agentRunId + version` CAS，只停止被点击
的 Run；它不暂停 lane，不取消 waiting Delivery，也不能误停 successor。产品没有业务重试入口。Runtime 明确未接受且无
副作用风险时，可以恢复同一冻结 Run 的运输；accepted/unknown 永不作为未执行重新投递。

Run 显示失败不等于旧执行已隔离。Adapter cleanup 未确认时，后继 Delivery 保持 waiting，不提前创建必败 Run；旧执行
仍可能写共享 execution root 时，只对相关 root 使用临时 dispatch fence。unknown 默认换新 Native Session，但换 Session
不能替代旧进程清理。

## Channel 与 Automation

Channel 入站在消息和 Delivery 提交后即完成接收。绑定 Channel 的 Camp 中，每条 Agent 公共消息创建独立、可去重的
ChannelDelivery；outbox 失败不重跑模型。Automation admission 创建 started occurrence、新 Camp、首消息和 Delivery，
再走普通 claim；已有 active occurrence 时直接 `skipped(overlap)`，没有 queued occurrence。

## 历史切换

Migration 162 把尚未进入冻结/accepted Runtime input 的旧公开等待责任转成新 waiting Delivery，并终态化旧的可变 Run
占位。历史 Run、CampTurn、Gather、Manifest 与 evidence 原样只读；冻结或 outcome-unknown 输入绝不重新入队。
