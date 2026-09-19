---
document_type: version-decisions
version: v1.62
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-20
---

# v1.62 版本决定

<a id="v1-62-d01"></a>
## V1.62-D01：Mission 状态操作不以消息发布为前置条件

- 状态：accepted
- 日期：2026-09-19
- 当前权威：Mission v6 与 Mission Architecture

Mission 状态是独立业务事实，公开消息是可选解释材料。要求 Agent 在设置 `needs_you` 或 `completed`
前先发布消息，会把两项可分别授权、失败和重放的操作强制串联，并让“状态是否可更新”取决于一条消息是否已
创建。选择让所有状态都可省略 `sourceMessageId`，同时保留显式关联的同 Camp、公开、未删除校验。

省略来源沿用现有单次写入语义并清除旧关联，不引入“未提供 / 保留 / 清空”三态 patch，也不自动选择最近消息。
状态活动本身继续记录操作者与变化，因此无来源不等于无审计。沟通是否必要仍由当前协作任务决定，但不再成为
Core 接受状态命令的条件。

拒绝保留 `needs_you/completed` 条件必填，因为它维持不必要的跨操作耦合；拒绝自动发布或绑定最近消息，因为
这会伪造用户可见内容或产生时序歧义；也拒绝新增 `--force`、`--skip-message` 或三态清空参数，因为现有可选字段
与整行写入已经能无歧义表达目标状态。
