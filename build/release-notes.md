# Rovai AI v0.4.18

<!-- lang:zh-CN -->

Windows x64 验收修复版（未签名），修复 0.4.17 的升级与聊天开关回归。

- 修复旧数据库被误判为已完成升级，导致成员读取报错、页面显示“暂时无法打开会话”的问题。启动时通过正式迁移流程补齐聊天数据结构，不要求清空已有数据。
- 修复同一缺列问题导致的诊断导出失败。
- 修复队员 Runtime 页“聊天 Bot”开关被桌面请求白名单拒绝、无法保存的问题。
- 加强发布检查：除了健康检查，还验证成员列表、导航快照与诊断导出；旧库升级、数据保留及重复启动由独立回归测试覆盖。

本版仅发布到 MadebyNight fork，供 Windows 验收。未签名安装包可能触发 SmartScreen 未知发布者提示。聊天 Bot 的真实 Runtime、目录权限和飞书收发仍需单独验收，本次修复不代表这些场景已全部通过。

---

<!-- lang:en -->

Unsigned Windows x64 acceptance hotfix for the upgrade and chat-toggle regressions in 0.4.17.

- Fix older databases being admitted as fully upgraded while chat schema was missing, causing member reads and session opening to fail. Startup now uses the normal migration flow without requiring a data reset.
- Fix diagnostic export failing on the same missing-column error.
- Allow the teammate Runtime tab chat-Bot setting through the desktop request allowlist so it can be saved.
- Extend package checks beyond health to member reads, navigation and diagnostic export. Dedicated regression coverage verifies old-schema upgrades, data preservation and repeated startup.

Published only to the MadebyNight fork for Windows acceptance. The unsigned installer may trigger a SmartScreen unknown-publisher warning. Real Runtime execution, folder permissions and Feishu delivery require separate acceptance; this hotfix does not claim those scenarios are fully verified.
