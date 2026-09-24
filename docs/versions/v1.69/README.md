---
document_type: version-overview
version: v1.69
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-24
---

# Rovai-ai v1.69：Camp 主动读取、搜索与撤回占位

前置：[v1.68](../v1.68/README.md)。本版已交付的主动读取／搜索让队员在 Run 中查询已发布的最新公屏消息，包括首个目标 claim 前仍可撤回、或本队员 Delivery 尚在 waiting 的消息。读取和搜索不领取 Delivery，也不关闭撤回资格；撤回后的 `camp.read` 返回英文状态项。字段合同见 [Camp History v10](../../contracts/camp-history-v10.md)，取舍理由见[版本决定](decisions.md)，已完成部分的实施证据见[实施与验收](implementation-plan.md)。另有[已确认的模型上下文变更说明 revision 4](model-context-change-history-hint-additional.md)：当前合同为 [ContextManifest／Formatter v30](../../contracts/context-manifest-evidence-v30.md)、[Run Facts v8](../../contracts/run-facts-v8.md) 与 [Profile v9](../../contracts/context-delivery-profile-v9.md)；新建 Session 使用 Charter revision 14，既有 Session 保留原系统提示词且不因本次变更切换。此前迁移历史数据保全定向测试已通过，扩展 DB 降级夹具静态调整尚未复测。

## 目标与边界

- `camp.read` 使用目标 Camp 调用时的实时 sequence，时间线和按 ID 读取把已撤回消息投影为原位置的 `Message withdrawn` 状态项，不返回已擦除的原文、引用、附件或寻址信息。默认 20、显式上限 100 及诚实分页沿用 v1.68。
- `camp.search` 和 `history.search` 在各自既有发布边界内可命中 claim 前原文；撤回后不再命中。当前 Camp 搜索保持实时，跨 Camp 搜索保持冻结的全局发布边界。
- 首个目标 claim 仍是本地 Composer 消息的撤回边界。已交付的主动历史读取不改变 `RUN_INPUT` 选择和 quote-source 重验。追加的上下文合同仅对新公开 batch Run 的 `RUN_FACTS.historyHint` 增加 claim 时额外可见消息 true／false 的四种完整句子：使用上次有效 accepted 执行前公屏尾 `P`、本次 claim 公屏尾 `T`、最终领取进入 `RUN_INPUT.messages` 的全部 ID `I` 和当前 Agent `A`；`P > 0` 检查 `(P, T]`，`P = 0` 检查 `<= T`。对当前 Camp 的 `camp.read` 时间线可见消息（含撤回占位符、不含 tombstone），只排除 `I` 与本 Agent 自己写的消息；发给他人的可见消息和未领取队尾仍计入。使用无正文、无数量、无分页上限的 `EXISTS`，查询失败回滚 claim，不生成未知提示。
- 额外可见仅表示 claim 时快照，不增加工作责任或要求读取；Run 内部冻结 `P` 和布尔值，仍不增加历史正文、列表、第二份边界、自动摘要或模型字段。同一 Run 复用原 Manifest／payload；完整提示仍参与 Profile 9 容量门禁，`RUN_INPUT` 不截断。Charter 第一条保留、第二条改为只在工作缺少 Camp context 时 `rovai camp read`；Formatter／Manifest 30、Run Facts 8，新建 Session 的 Charter revision 14；旧 Session 沿用冻结 Charter 和原系统提示词，Profile 9 不变。非 batch v26／v5 和 Camp History v10 的 read 默认 20／上限 100 不变。详细合同与完整英文文案见 [ContextManifest v30](../../contracts/context-manifest-evidence-v30.md) 和 [Run Facts v8](../../contracts/run-facts-v8.md)。

后续修复让 RunCard 自带有界触发消息摘要，避免标题随聊天分页与缓存变化而回退；合同见 [Camp Open Projection v24](../../contracts/camp-open-projection-v24.md)。

## 当前状态

Core 主动读取和搜索投影、输出 Schema、撤回确认文案及定向回归已实现。此前 Rust 默认测试、目标慢速回归、TypeScript/Vitest、桌面构建和文档门禁已通过；`pnpm test` 的两项旧评测配置断言仍因 v1.68 基线版本与退役测试引用而失败，范围和证据见[实施与验收](implementation-plan.md)。追加的 historyHint／Charter 变更已有 Principal 对 revision 4 的二次确认；代码与迁移处于静态实施阶段，先前默认 Rust、定向冻结测试和文档门禁的通过记录均早于此次 Binding 兼容变更，不代表本次通过验收。迁移历史外键保全定向测试此前通过；extended DB 降级夹具与真实任务 Gate 尚未完成验收，依 Principal 要求不继续运行测试，细节见[实施与验收](implementation-plan.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [v1.68](../v1.68/README.md)冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v1.69 |
| Decisions | 已更新 | [V1.69-D01](decisions.md#v1-69-d01)记录主动查询与 claim 撤回边界的取舍，并进入[当前决定导航](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Camp History v10](../../contracts/camp-history-v10.md)定义正常项、撤回项、搜索可见性和发布边界；[Camp Open Projection v24](../../contracts/camp-open-projection-v24.md)定义独立于消息页的 Run 标题摘要；追加变更的当前 [ContextManifest／Formatter v30](../../contracts/context-manifest-evidence-v30.md)、[Run Facts v8](../../contracts/run-facts-v8.md)、[Profile v9](../../contracts/context-delivery-profile-v9.md)、新建 Session Charter revision 14（旧 Session 原字节不变）不表示代码已验收 |
| Architecture | 已更新 | [公共历史与 Context 不变量](../../architecture/foundational-invariants.md#context-public-history)、[公共消息与 Delivery](../../architecture/public-a2a-message-delivery.md)和[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)区分主动查询、claim 快照判断与冻结输入；[Camp Open](../../architecture/camp-open-read-path.md)按返回 Run 定向读取标题来源 |
| UI | 已更新 | 撤回确认框用“尚未领取”描述实际资格；[Camp 会话工作区](../../ui/components/conversation-workspace.md)同步 Agent 主动读取、英文状态项和不依赖聊天分页的 RunCard 标题 |
| Runtime Activity | 确认无需更新 | 不改变 Runtime Activity kind、phase、outcome、Adapter 映射或证据来源 |
| Runtime compatibility | 已更新 | [ContextManifest v30](../../contracts/context-manifest-evidence-v30.md)将新建 Charter 14 与 Native Binding 的 Charter 兼容基线 13 分开；安装、协议和 Session 权限等既有不兼容检查不变 |
| Documentation routing | 已更新 | [文档导航](../../README.md)及[合同索引](../../contracts/README.md)指向 v30／v8 当前合同并保留 v29／v7 历史入口；[Research 索引](../../research/README.md)保留先前主动查询的方案来源 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；这是公共历史工具的精确可见性调整 |
