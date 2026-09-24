---
document_type: implementation-plan
version: v1.70
authority: version-implementation-and-verification
status: in_progress
last_updated: 2026-09-24
---

# v1.70 实施计划

1. 发布普通文件形式的 Rovai 受管 Skills，统一执行 Host 路径与安全同步；旧导入 Library、Revision 与项目入口留存，新 Run 停止项目投影，Core 启动不自动清理旧项目文件。
2. 新建队员 × 五项工具箱配置，迁移时所有队员只默认开启 `member-studio`，其余四项关闭；设置页按第九版交互稿提供即时保存、批量选择、完整说明和失败回退。
3. 只读发现各 Harness 的用户级与当前项目 Skill，支持来源身份、路径、部分失败和按 Core 实例有界缓存；Settings 只展示用户级，会话候选按全队并集。
4. 冻结消息局部来源与 Run 的 Skill 选择／解析；新 Bootstrap 与动态索引依已确认的[revision 5](model-context-change.md)生成，旧 Binding／Manifest 恢复维持原字节。
5. 同步当前 Architecture、Contracts、UI 和文档路由；按「诊断与修复」HTML 交互稿交付单项旧入口问题和显式统一清理，执行定向验证、文档门禁、隔离 App 验收与真实任务 Gate，并记录未覆盖的真实 Runtime 条件。
6. 现有 PR #517 合入最新 `main`，完成 Review 与 CI；按用户本机安装要求从当前分支构建日常包、隔离验收，再依本地工作流非终止安装到 `/Applications/Rovai AI.app`。

实施状态：进行中。验证结论以实际命令输出和隔离产物为准，不以本计划宣称通过。
