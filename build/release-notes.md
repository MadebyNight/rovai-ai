# Rovai AI v0.4.16

<!-- lang:zh-CN -->

本版本新增飞书聊天 Bot 模式，并同步了上游 0.4.13、0.4.14 的智能体检测、文件预览、记忆工作区和命令行改进。

- 【功能】**飞书 Bot 双模式。** 打开“仅 Owner 可交互”时保持现有工作 Bot；关闭后，Owner、同事与已建联外部联系人只能使用聊天、资料问答、转发、代问和向 Owner 确认，不进入本地工作链路。
- 【功能】**共享资料问答。** 绑定一个已有文件夹，实时读取 UTF-8 Markdown/TXT，按问题返回相关片段并注明出处；资料变化、删除或解绑立即生效。
- 【功能】**沟通闭环。** 支持按姓名找同事、受委托转发、代问与引用回复关联、阶段汇报和补充汇报，并如实反馈发送成功、失败或无法确认。
- 【配置】**Bot 行内聊天设置。** 提供模式开关、聊天模型、只写密钥和资料文件夹绑定；密钥不会回显到界面。
- 【安全】**独立上下文。** 聊天记录、沟通事项与出站消息独立持久化，不读取工作会话、Camp 或执行历史，不发送运行状态卡或本地路径。
- 【性能】**减少智能体检测中的重复工作。** 重新检测和状态检查减少重复扫描、程序启动及多余的模型探测；不同智能体可独立检查。
- 【性能】**减少文件预览的重复读取。** 优化大文本分页和行号定位，同一版本的 HTML 不再因重复通知反复加载。
- 【界面】**调整记忆工作区和编辑表单。** 使用更紧凑的列表，支持按“全部、共同、队员、队员间”查看，详情和版本历史按需展开。
- 【功能】**命令行支持检查和配置 MiniMax Code、Pi。** 可通过 `rovai app` 执行状态检查、查询模型目录和设置队员运行配置。
- 【修复】**修正自动记忆提示的内容与数量，并修复记忆审核面板关闭按钮无法点击的问题。**
- 【修复】**修复定时任务生成的会话无法彻底删除、Antigravity 长任务提前结束、执行结束后工具状态一直转圈的问题。**
- 【修复】**输入内容过大时明确显示失败原因。** 原消息旁显示“输入内容过大 · 查看详情”，并提供改用附件或拆分发送的建议。
- 【修复】**修复升级安装后聊天 Bot 无法保存设置的问题。** 由旧版本升级时缺失聊天数据表，导致保存模型密钥时提示“聊天密钥尚未保存”；现在升级会补齐数据表。

---

<!-- lang:en -->

This release adds the Feishu chat Bot mode and syncs the upstream 0.4.13 and 0.4.14 improvements to agent checks, file previews, the Memory workspace, and the app CLI.

- [Feature] **Two Feishu Bot modes.** With Owner-only interaction on, the Bot keeps the existing work capabilities. With it off, the Owner, colleagues, and connected external contacts can only chat, ask about shared materials, forward messages, ask on someone's behalf, and confirm with the Owner, without entering the local work pipeline.
- [Feature] **Answers from a shared materials folder.** Bind an existing folder and Rovai reads UTF-8 Markdown and TXT files live, answering with the relevant excerpts and their sources. Edits, deletions, and unbinding take effect immediately.
- [Feature] **Closed communication loop.** Find colleagues by name, forward on request, ask on someone's behalf with quoted replies, and post progress and follow-up reports, reporting sent, failed, or unconfirmed honestly.
- [Configuration] **Inline chat settings on the Bot row.** Toggle the mode, choose the chat model, write an append-only credential, and bind the materials folder. The credential is never shown in the interface.
- [Security] **Isolated context.** Chat history, communication items, and outbound messages are stored separately. Chat never reads work conversations, Camp, or execution history, and never sends run-status cards or local paths.
- [Performance] **Reduce repeated work in agent checks.** Rescanning and status checks perform fewer repeated scans, process launches, and unnecessary model probes, and different agents can be checked independently.
- [Performance] **Reduce repeated file-preview reads.** Reuse work when paging or locating lines in large text files, and avoid reloading the same HTML version for repeated notifications.
- [UI] **Update the Memory workspace and editor.** Use a compact list with All, Shared, Member, and Between scopes, with details and version history expanded on demand.
- [Feature] **Check and configure MiniMax Code and Pi from the CLI.** Use `rovai app` to check availability, query models, and configure teammate runtimes.
- [Fix] **Correct automatic memory notices and counts, and restore the Memory review panel's close button.**
- [Fix] **Allow scheduled-task conversations to be deleted completely, prevent Antigravity long runs from ending after five minutes, and stop active tool indicators when an execution ends.**
- [Fix] **Explain oversized-input failures.** Show "Input too large · View details" beside the original message with suggestions to attach a file or split the input.
- [Fix] **Fix saving chat settings after an upgrade install.** Upgrading from an older build skipped the chat data tables, so saving the model credential reported that the credential was not saved. Upgrades now create the missing tables.
