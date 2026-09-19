---
document_type: architecture
authority: scheduled-automation-architecture
status: accepted
last_updated: 2026-09-18
---

# Scheduled Automation Architecture

Scheduled Automation 是共享 Rust Host/Core 内的持久计划控制面。它拥有定义、schedule、occurrence、时间上限、结果与
Owner 通知；消息、Delivery、AgentRun 和 Runtime 执行复用公开 Camp 的统一主链。字段合同见
[Scheduled Automation v3](../contracts/scheduled-automation-v3.md)。

## 组件和流程

```text
Scheduler due/manual trigger
  ├─ previous active → skipped(overlap)
  └─ previous inactive → one transaction
       ├─ started occurrence + frozen definition snapshot
       ├─ new Camp + membership
       ├─ first system-authored CampMessage
       └─ waiting Delivery
            └─ unified Scheduler claim → multi-input AgentRun
```

- Renderer/Web 只编辑定义、读取历史、请求立即运行并打开 Camp，不计算权威时间。
- AutomationService 原子领取 occurrence、推进 `nextRunAt`、冻结定义、维护时间上限和业务终态。
- Collaboration/Delivery service 创建普通消息与 waiting Delivery；它不为 Automation 创建特殊 Run。
- Runtime Scheduler 使用与用户、A2A 和 Channel 相同的 claim、Context、isolation 和 terminal seam。
- Channel Host 只处理 occurrence 终态派生的独立 Owner notification outbox。

一个 Automation 同时最多一个未终结 occurrence。下一次触发看到 active 时直接记录 `skipped(overlap)`；没有 queued
occurrence、overlap slot、queue timeout 或 maximum queue delay。成功 admission 后 occurrence 即为 started，无法立即
claim 时只有 Delivery 等待，time limit 仍从 occurrence admission 起计算。

首条 prompt 进入 `RUN_INPUT.messages[]` 时只是 system-authored 普通消息，没有 `mission_start`/`automation` input kind，
也不形成批次边界。后续普通消息可以与它按冻结时机合批。消息来源不会扩大 Runtime、文件、网络、Built-in 或 External
MCP 权限。

## 恢复和结算

重启、等待、交互或超时都不重新派发 prompt。已经 accepted/outcome-unknown 的输入永不作为未执行重入队；后继处理遵循
普通 execution-isolation fence。Automation occurrence 通过自己记录的消息、Delivery、Run 与结果关系结算，不能用 Camp
空闲或某个 Run 终态自动推导业务完成。

通知与执行分离：settlement 冻结 provider-scoped delivery，实际发送重验当前 Bot/Owner；通知失败只更新 outbox，不改变
occurrence、消息、Run 或重跑模型。定义删除保留已有 Camp、occurrence 和投递证据。

## Host 与时间

Rust Host 驱动计划，不依赖 Renderer 或 HTTP 连接。App 退出/设备休眠期间不逐条补跑；恢复只记录最近 missed 并计算未来
时间。计划时间、时钟回拨和平台唤醒资格继续由既有 Host 时间边界拥有。

## References

- [Scheduled Automation v3](../contracts/scheduled-automation-v3.md)
- [Public Camp Message、Delivery 与 AgentRun](public-a2a-message-delivery.md)
- [Runtime recovery and shutdown](foundational-invariants.md#runtime-recovery-shutdown)
- [V1.60-D05](../versions/v1.60/decisions.md#v1-60-d05)
