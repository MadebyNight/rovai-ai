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
- v1 的 JSON 动作协议（search_materials、find_person、forward、ask、ask_owner、close_item）
  在 v2 停用；恢复将由 Agent 工具（MCP）承接。
- 迁移 210 在 agent_profile 新增 chat_bot_enabled 与 chat_materials_path，同时清空
  聊天 Bot 表中的历史模型字段。
