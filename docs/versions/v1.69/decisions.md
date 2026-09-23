---
document_type: version-decisions
version: v1.69
authority: decision-rationale
lifecycle: current
last_updated: 2026-09-24
---

# v1.69 版本决定

<a id="v1-69-d01"></a>
## V1.69-D01：Skill 来源从项目投递转为受管索引与原址发现

- 状态：accepted
- 日期：2026-09-24
- 当前权威：[Skills 架构](../../architecture/skills.md)、[Skills Rebuild v1](../../contracts/skills-rebuild-v1.md)、[Skills UI](../../ui/components/skills-settings.md)

### 背景

旧 Skill Library 把全局启停、Runtime group assignment、Revision 副本和项目 SkillProjection 合成一条新 Run 的投递链。它让模型能发现指南，却也把用户项目目录当作受管写入面；原生 Harness 用户与项目来源、队员各自的需要和旧导入身份难以清晰区分。

### 选择

Core 发布普通文件形式的 Rovai 平台两项与工具箱五项；平台索引随新 Binding 冻结，工具箱按队员配置并随新 Run 冻结。原生 Harness Skill 只读原址发现、以规范文件身份参与消息局部选择。新 Run 停止建立项目 SkillProjection。旧 Library/Revision/审计继续保留，旧项目投递仅在明确所有权和 active-Run/root-access 条件下收敛。升级时不继承旧全局启停或分组，只为每位队员默认选择 `member-studio`。

### 后果

- 配置从“全局 Skill × Runtime group”变为“队员 × 工具箱项”；原生路径由 Harness 自己管理。
- 旧导入的历史 ID 不自动变成同名原生 Skill；用户须按当前来源重新选择。
- 旧项目投影的清理可能因项目不可访问或 Run 活跃而延后，不能用名称扫删。

### 未选择方案

- 继续把所有来源导入旧 Library：会复制用户原生文件并延续全局配置与项目投递的耦合。
- 升级时按名称迁移旧启停/分组：会把旧全局偏好误当成每位队员明确选择，并混合不同来源身份。

<a id="v1-69-d02"></a>
## V1.69-D02：模型索引按 Binding/Run 冻结并保留精确旧格式恢复

- 状态：accepted
- 日期：2026-09-24
- 当前权威：[ContextManifest v30](../../contracts/context-manifest-evidence-v30.md)、[Profile 10](../../contracts/context-delivery-profile-v10.md)、[Skills Rebuild v1](../../contracts/skills-rebuild-v1.md)

### 背景

Skills 指南需要在新 Session 和每个新 Run 中被发现，但已有 Native Binding、Manifest 和冻结投递是已接受或待恢复的历史证据。v1.68 同时移除了自动公屏历史，并把公开 Run 升到 29/9/7；直接用旧目标版本或重生成 payload 会改变已冻结输入。

### 选择

新 Binding 使用 Bootstrap/Formatter 5，在身份后增加独立平台 section；旧 Binding 保留 v4 三段。新非 batch Run 使用 27/7/5，新公开批次使用 30/10/7，新增完整动态 section，保持 v1.68 的 `historyHint`。同 Run 重试与恢复只使用冻结字节和证据；v26/6/5 非 batch、v29/9/7 公开输入以精确组合有界恢复，公开 v28 及更早仍退役。Native Binding 兼容只允许本次索引格式差异，其他 Adapter、安装、身份和运行条件继续受原准入校验。

### 后果

- 旧会话不会热插入平台索引；其后续新 Run 可以看到动态索引，compaction 仍重投旧 Bootstrap。
- 新索引占用现有 payload 预算；超限时整个输入失败，不裁掉 section 或重复发送任务。
- 真实 Runtime 内部摘要是否保留该索引仍需实际任务 Gate 证明，Core 只保证自己控制的冻结和重投字节。

### 未选择方案

- 令所有旧 Binding 立即轮换：会丢失本可继续的原生会话上下文。
- 在旧冻结输入中补 Skills section：会改变 payload digest、恢复证据和一次任务语义。
