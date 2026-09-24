---
document_type: version-overview
version: v1.69
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-09-24
---

# Rovai-ai v1.69：Camp 主动读取、搜索与撤回占位

前置：[v1.68](../v1.68/README.md)。本版让队员在 Run 中主动读取或搜索已发布的最新公屏消息，包括首个目标 claim 前仍可撤回、或本队员 Delivery 尚在 waiting 的消息。读取和搜索不领取 Delivery，也不关闭撤回资格；撤回后的 `camp.read` 返回英文状态项。字段合同见 [Camp History v10](../../contracts/camp-history-v10.md)，取舍理由见[版本决定](decisions.md)，实施证据见[实施与验收](implementation-plan.md)。

后续：[v1.70](../v1.70/README.md)。

## 目标与边界

- `camp.read` 使用目标 Camp 调用时的实时 sequence，时间线和按 ID 读取把已撤回消息投影为原位置的 `Message withdrawn` 状态项，不返回已擦除的原文、引用、附件或寻址信息。默认 20、显式上限 100 及诚实分页沿用 v1.68。
- `camp.search` 和 `history.search` 在各自既有发布边界内可命中 claim 前原文；撤回后不再命中。当前 Camp 搜索保持实时，跨 Camp 搜索保持冻结的全局发布边界。
- 首个目标 claim 仍是本地 Composer 消息的撤回边界。新公开 Run 已按 v1.68 改为历史按需读取；`RUN_INPUT` 选择、`RUN_FACTS.historyHint` 和 quote-source 重验不变。
- 不变更 Bootstrap、AgentRun Dynamic Context、ContextManifest 或 Formatter 的结构、版本和字节选择；本版改变的是 Agent 主动调用后的工具结果。

## 当前状态

Core 读取和搜索投影、输出 Schema、撤回确认文案及定向回归已实现。Rust 默认测试、目标慢速回归、TypeScript/Vitest、桌面构建和文档门禁已通过；`pnpm test` 的两项旧评测配置断言仍因 v1.68 基线版本与退役测试引用而失败，范围和证据见[实施与验收](implementation-plan.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v1.68](../v1.68/README.md)冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v1.69 |
| Decisions | 已更新 | [V1.69-D01](decisions.md#v1-69-d01)记录主动查询与 claim 撤回边界的取舍，并进入[当前决定导航](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Camp History v10](../../contracts/camp-history-v10.md)定义正常项、撤回项、搜索可见性和发布边界；v9 降为历史 |
| Architecture | 已更新 | [公共历史不变量](../../architecture/foundational-invariants.md#context-public-history)、[公共消息与 Delivery](../../architecture/public-a2a-message-delivery.md)和[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)区分主动查询与冻结输入 |
| UI | 已更新 | 撤回确认框用“尚未领取”描述实际资格；[Camp 会话工作区](../../ui/components/conversation-workspace.md)同步 Agent 主动读取和英文状态项，Renderer 时间线与操作未改变 |
| Runtime Activity | 确认无需更新 | 不改变 Runtime Activity kind、phase、outcome、Adapter 映射或证据来源 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 协议、安装资格或实测版本；所有 Adapter 共用 Built-in Tool 结果 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、[合同索引](../../contracts/README.md)和[Research 索引](../../research/README.md)指向当前语义及方案来源 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；这是公共历史工具的精确可见性调整 |
