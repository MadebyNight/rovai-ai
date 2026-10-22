# Rovai AI v0.4.19

<!-- lang:zh-CN -->

Windows x64 验收版（未签名）。恢复聊天队员的飞书沟通工具，沿用队员 Runtime 与已绑定 Bot，不增加 API 配置。

- 新增 `rovai feishu` 工具入口：按姓名查人、受托转发、代问、查看事项、回报进展和关闭事项。凭据由渠道 Host 保管，模型不接触密钥。
- 接收人来自当前 Bot 的查询结果或消息提及；请求绑定当前聊天与执行身份。发送区分排队、已发、失败和结果未知，不盲目重发。
- 补齐重启后待回复恢复、等待审批后继续回复，以及旧库升级准入检查。
- 精简队员页：聊天开关与资料文件夹按钮独立；未选择资料文件夹时显示开启条件提示，选择目录不会自动开启聊天 Bot。
- 飞书管理旁新增“删除”：仅清除本地发布记录和凭据，保留队员与聊天历史；再次发布创建新应用，不删除远端 Bot。
- 聊天 Bot 会话在侧栏独立分组，并兼容两条分支曾使用相同迁移编号的旧库。
- 修复渠道操作按钮在窄窗口中的换行，完成日间/夜间实际界面交互与视觉验收。

本地自动化已验证认证、工具闭集、模拟飞书查询与回执、代问关联和旧库升级。真实飞书账号收发仍需安装后验收；CodeBuddy 等 Runtime 的原生审批不自动绕过。本版不提供飞书全量消息历史或云文档读取。

---

<!-- lang:en -->

Unsigned Windows x64 acceptance build. Restores Feishu communication tools to chat teammates using their existing Runtime and bound Bot, without separate API settings.

- Add `rovai feishu` operations for scoped contact search, delegated forwarding and asking, item inspection, progress reporting, and item closure. Credentials remain private to the channel Host.
- Bind recipients to current-Bot search results or inbound mentions, and requests to the current chat and Run. Distinguish queued, sent, failed and unknown outcomes without blind resends.
- Recover pending replies across Host restarts, preserve replies after approval waits, and verify upgrades from older database layouts.
- Keep the chat switch and materials-folder button independent. Show a prerequisite hint until a folder is selected; selecting a folder does not enable the chat Bot automatically.
- Add Delete beside Feishu management to clear only the local publication record and credentials. Preserve teammates and chat history, allow a fresh application to be published, and leave the remote Bot untouched.
- Group chat Bot threads separately in the sidebar and support older databases from branches that shared a migration number.
- Fix action-button wrapping in narrow channel settings and verify real UI interactions and screenshots in both themes.

Local automated tests cover authentication, closed tool contracts, simulated Feishu queries and receipts, ask/reply correlation, and old-database upgrades. Real account delivery remains an installation acceptance step. Native Runtime approvals are not bypassed. This build does not provide full Feishu message-history or cloud-document access.
