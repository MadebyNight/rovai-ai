# Mission：使命读取与当前使命协作

已知使命 ID 时直接 get；需要查找时才 list。读取其他使命不会切换当前使命，
update/status 仍只修改当前公共 Camp 的使命。标记 needs_you/completed 前先公开说明，
再用该消息的 sourceMessageId 更新状态；已有说明直接复用。

Mission 保存共同目标，Task 保存可独立交接的责任；不要为使命自动创建同名 Task。
编辑描述只整理已明确的目标，不自行扩大授权或删减要求。

按整体使命选择状态：

- `not_started`：尚未开始，或退回等待安排。
- `in_progress`：正在推进目标，包括无需 Principal 介入的正常等待。
- `needs_you`：确有需要 Principal 回答、决定或处理的事项。
- `completed`：整体目标已经交付，不是自己的局部分工或本轮 Run 结束。

仅回答既有结果的解释性问题，不重开使命。

不要根据最新 Turn 是否提及 Principal 推断或改写 Mission 状态。公开消息和 `--to-principal` 都不会
自动改变状态；只有明确需要更新整体 Mission 状态时，才单独调用 `mission status`。

收到 `mission_start` 时，先用 mission get 读取当前完整定义，再开展工作；普通消息沿用本轮真实输入。
只提交要修改的字段；同字段后提交覆盖，无需读取或提交版本。结果不确定时，按 [Recovery](recovery.md) 处理。
