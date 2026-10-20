---
document_type: protocol-contract
contract: feishu-chat-bot-v2
authority: feishu-chat-bot-mode-admission-chat-items-outbound
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-10-21
---

# 飞书聊天 Bot v2 合同

本合同拥有聊天 Bot 的成员开关、资料文件夹工作区、聊天准入、会话投递与出站消息语义，并取代
[Feishu Chat Bot v1](feishu-chat-bot-v1.md)。工作 Bot 的
[Feishu Channel v1](feishu-channel-v1.md) 准入、Camp 绑定、Delivery 与 AgentRun 链路不在本合同内。

## 1. 模式与成员

- 聊天 Bot 不再拥有独立的模型/服务商/密钥配置；回复一律由该队员（成员）已配置的 Runtime
  （ACP）与模型产生，agent_profile.chat_bot_enabled 决定该成员是否作为聊天 Bot。
- 凭据不再存在 channel_chat_credential 中；该表停用，只保留历史数据。
- 回复的执行根是 agent_profile.chat_materials_path（资料文件夹）。资料文件夹为 null 时
  聊天 Bot 不受理入站，并在渠道页给出提示。
- 成员的 Runtime 或模型未配置时同理不受理；渠道页不再提供任何聊天模型配置入口。

## 2. 会话投递

- 每个外部 (provider, app_id, chat_id) 复用一个聊天线程：create_channel_camp 以
  binding_kind = Directory、canonical_path = 资料文件夹建 Camp，成员为该 Bot 队员。
- 入站正文通过 queue_camp_message_and_runs 以 ExecutionRequest{completion_role:"required"}
  投递，一次入站最多触发一个 AgentRun；结果取 agent_run.final_camp_message_id 的助手文本。
- 出站回执仍走 channel_chat_outbound：sent/failed/unknown 语义与 v1 第 8 节一致；
  回复只发送纯文本，不发送运行卡、控制台入口或本地路径。

## 3. 权限夹取

- 聊天 Bot 不继承成员 Runtime 配置中的最高（bypass/yolo/full-access）档位；落到各适配器
  的「工作区内可写」档（Claude acceptEdits、Codex workspace-write 等）。
- 文件写入仍受 validate_workspace_scope 限制：只能在资料文件夹（执行根）内创建/修改，
  例如备忘录；工作区外一律拒绝。

## 4. 对 v1 的变更

- channels.chat.configure 不再携带 model/modelBaseUrl/credential 字段；删除
  channels.chat.credential.set/get，新增 members.chat.set。
- channel_chat_turn 不再存模型轮次；会话上下文由聊天线程自身承载。
- v1 的独立模型 JSON 动作协议停用；联系人查询、受托转发、代问及事项报告通过受认证的 `rovai feishu` CLI 恢复，接口见 [Built-in Tool Transport v44](builtin-tool-transport-v44.md)。不恢复独立模型配置，不修改共享 Bootstrap 或 Dynamic Context。资料操作仍由队员 Runtime 完成。
- 迁移 210 在 agent_profile 新增 chat_bot_enabled 与 chat_materials_path，保留旧聊天表和历史字段，不自动授予成员 Runtime 写权限。

## 5. 飞书工具与恢复

联系人与目标引用必须属于当前 Run/epoch 和入站输入，不能由模型传入任意 Bot 或 open_id。多输入批次需显式选择 inputRef，不能猜请求者。
Host 用已有私有凭据执行查人；查询结果最多20项，不把原始SDK错误或密钥回传模型。受托发送进入幂等出站队列，排队不表示已送达，unknown不可盲目重发。
代问先原子建立事项与出站，回复以引用或唯一等待事项关联；报告只能回到原请求会话，阶段/补充不自动关闭。
入站与内部消息的持久映射支持Host重启恢复；终态回复入队时原子记录reply_outbound_id，等待审批和超时提示不结束该映射。
原生Runtime审批照旧，不以bypass绕过。

## 6. 升级准入

- 上游 projection schema 158 不代表聊天迁移完成。只有 209、210、211 收据与对应表列布局一致，数据库才可作为当前权威直接打开。
- 已知的上游 208 布局及仅完成 209 或 210 的布局，必须经正式 DatabaseAdmission / AuthorityMigrationRunner 补齐迁移，再开放成员与诊断读取。
- 已有迁移收据但表列缺损的数据库应拒绝准入，不得当作旧库静默修补或清空重建。
- 验收覆盖旧库升级、成员与导航读取、诊断导出、数据保留和重复启动；新库 health.check 单独通过不足以证明升级可用。
