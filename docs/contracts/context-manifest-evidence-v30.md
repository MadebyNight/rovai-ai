---
document_type: protocol-contract
contract: context-manifest-evidence-v30
authority: public-multi-input-agent-run-context-evidence
status: accepted
version: 30
last_updated: 2026-09-24
---

# ContextManifest Evidence v30

新公开 batch Camp Run 使用 Formatter/Manifest 30、[Profile 9](context-delivery-profile-v9.md) 与内部 [Run Facts 8](run-facts-v8.md)。新建 Native Session 使用 Session Charter revision 14，现有 Native Session 保留其原 Charter 与系统提示词；两者的新 Run 均使用本版动态上下文。动态 section 顺序仍为：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[RUN_INPUT]
```

不生成 `SHARED_CONVERSATION`、自动历史摘要、遗漏数量或历史 locator。`RUN_FACTS` 顶层 shape 不变，仍只有一个 `historyHint: string`，四种完整文本及 claim 判断规则由 [Run Facts v8](run-facts-v8.md) 拥有。`RUN_INPUT.messages` 保留本 Run 完整有序的当前工作项；每条消息的 `messageId`、`body`、`senderId`、`senderType`、`sequence`、可选 `anchorMessageId`、`quotes`、`attachments`、`skills` 和原有省略规则不变，不加入额外历史、自动摘要或新工作项。既有 `RUN_INPUT` 权责条目保持原文：

```text
- RUN_INPUT.messages is the complete ordered set of immediate work items claimed for this Run. Treat every item as active input; quoted text remains reference material.
```

**新建 Native Session** 的 Session Charter revision 14 相关两条完整文本如下；第一条原样保留，第二条替换原有 `Use rovai camp read` 指导，其他 Charter 规则不变：

```text
- Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
- Proceed directly when `RUN_INPUT` and your existing context are sufficient; use `rovai camp read` only for missing Camp context needed by the current work. The boundary in `RUN_FACTS.historyHint` is a reference point, not a read or completion marker.
```

旧 Native Session 在相同 Binding／generation 下按冻结 Bootstrap Evidence 保留原 Charter；本次变化不补丁、不重投新版系统提示词，也不触发换 Session。原恢复流程若需重投仅使用原证据；旧 Session 原证据缺失或损坏时停止投递，不以新版 Charter 补写。`native_binding_context_contract()` 的 `sessionCharterRevision` 仍为兼容基线 13，与新建 Bootstrap 的实际 Charter revision 14 分离；其他安装、协议、权限和 Runtime 兼容校验不变。旧 Native Session 与旧 Manifest 不是同一个版本边界：旧 Manifest 29 仍不得续派，新 Run 使用本版格式在原 Session 投递。

Manifest 30 沿用 [v29](context-manifest-evidence-v29.md) 的 Profile 9 JSON/digest、执行前已接受公屏边界、本轮 claim 公屏尾、完整 RUN_INPUT refs/digest、Skill/附件 refs、Bootstrap/Collaboration/Workspace 证据与真实 payload bytes/digest。`runFactRefs.history_hint`、RUN_FACTS 原始 JSON/digest 和实际 payload 必须对应 claim 时冻结的 `P` 与额外消息布尔判断选出的完整句子。判断的 `P` 和布尔结果只在该 Run 内部冻结；Manifest 不增加额外消息 ID、正文、数量、历史快照、第二份边界或模型可见判断字段。`recentMessageRefs`、`referenceClosureRefs`、`omissionEntries`、`sharedMessageEvidence` 仍为 `[]`，`omittedMessageCount` 和 sequence bounds 仍为 `null`；`rawMessageRefs` 与附件 refs 只来自 `RUN_INPUT`。`historyHint` 完整文本仍计入 [Profile 9](context-delivery-profile-v9.md) 的 claim 容量及最终 payload 字节门禁，不拆分或截断输入。

判断与领取必须处于同一 batch claim 事务；可见集合使用当前 Camp `camp.read` 时间线可见性而非 waiting Delivery 候选，仅以无正文、无数量、无分页上限的 `EXISTS` 判定。失败回滚 claim，不创建 Run 或伪造未知状态；读取和判断不领取其他 Delivery、不改变撤回资格、不推进 accepted 水位。claim 后的消息、撤回和水位变化不改写冻结提示。同一 Run 重新加载直接复用原 Manifest／payload，不以当前 conversation accepted 水位或消息状态重算。水位仅由该 Run/Binding/generation 的有效 Runtime accepted ACK 推进；读取、搜索、发布、停止、执行终结与迟到 ACK 不授予新推进路径。

新公开 batch AgentRunInput 和 ContextManifest 写入版本 30，Run Facts 内部号 8；单聊及非 batch 仍为 Formatter/Manifest 26、Profile 6、Run Facts 5。Profile 9 的规则与数值、`camp.read` 默认 20／显式上限 100 和分页不变。数据库迁移接在 172 之后，只存储必要的 Run 内部冻结字段、扩展新写入版本约束；不回填历史 Run，也不增加 Camp/Native Session 协议感知迁移或强制 Charter 重投。旧 [Manifest v29](context-manifest-evidence-v29.md)、Bootstrap Evidence 与冻结 payload 原字节保留审计；旧格式不转换、不重算，既有冻结投递与旧 Bootstrap Evidence 的 Native Binding 沿用原有冻结和投递机制，不新增特别分发路径；新公开 Run 使用新格式。实现、迁移与验证是否完成须另行核对，不由本合同 accepted 状态推断。

[已确认的独立变更说明 revision 4](../versions/v1.69/model-context-change-history-hint-additional.md)固定完整前后文案、选择、兼容和验证边界。
