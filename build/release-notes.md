# Rovai AI v0.4.20

<!-- lang:zh-CN -->

2026-10-28 · Windows x64 Preview（未签名）。

- 修正聊天 Bot 的逐输入来源说明，区分飞书/Lark 来信与本地输入，保留发送人、Owner 标记及原聊天回复受众。
- 明确普通问题的最终正文由 Host 回传原聊天，不需要为回复原聊天查联系人或调用转发；受托转发仍按既有授权检查执行。
- 保留同轮本地补充的来源与原聊天受众，避免把本地消息误当作先前来访者的新委托；不扩大工具或 Runtime 权限。
- 冻结本轮回复上下文，并兼容旧上下文与数据库升级恢复，保留历史记录及出站状态。

已有定向产品测试覆盖来源、受托发送、批次预算和旧库恢复。原始误拒答未在对照场景复现，不据此宣称全部问题已解决或所有 Runtime 已通过。此安装器未签名，SmartScreen 可能提示未知发布者；本次仅交付本机，不发布 GitHub Release。

---

<!-- lang:en -->

2026-10-28 · Windows x64 Preview — unsigned.

- Correct per-input chat-Bot provenance, distinguishing Feishu/Lark inbound messages from local input while preserving the sender, Owner flag and original-chat reply audience.
- Clarify that the Host returns the final answer to the original chat without contact search or forwarding. Delegated forwarding remains subject to existing authorization checks.
- Preserve the origin of local additions and the original channel audience within a Run, without treating local input as a new delegation from an earlier sender or expanding tool or Runtime permissions.
- Freeze reply context for each Run and retain historical records and outbound state through legacy-context and database upgrade recovery.

Existing focused product tests cover provenance, delegated sending, batch budgets and legacy recovery. The original refusal was not reproduced in comparison scenarios; this does not establish that every issue is resolved or every Runtime is qualified. This installer is unsigned and SmartScreen may report an unknown publisher. This delivery is local only, with no GitHub Release.
