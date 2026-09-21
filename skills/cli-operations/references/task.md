# Task：跨 Run 的独立责任

只有一项责任同时需要持久追踪、跨 AgentRun 生存，并能独立交接或验收时，才创建 Task。短暂协调、
公开答复、进度广播、澄清问题和仅需用户注意的消息仍是 CampMessage。

用 `rovai task --help` 选择操作，参数看对应操作的 `--help`。
优先复用已有 Task；任务范围与要求统一写入 `description`。
`get` 读取完整描述和当前版本；更新使用已读取的版本，冲突后重读再决定，不新建 Task 绕过。

Task 与公开消息承担不同职责：Task 保存持久责任，CampMessage 向 Camp 公开沟通。需要在消息中关联
Task 时，Send 必须恰好有一个 Effective Agent Recipient；User attention 不计入这个 cardinality。
先让 Task 达到应有状态，再发送需要公开的交接、请求或结果消息。
