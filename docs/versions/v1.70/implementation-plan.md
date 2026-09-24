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

## 设置页还原修正（2026-09-24）

- Skills 和工具箱复用 MCP 分隔线的宽度、拖动、键盘、取消和复位逻辑，独立保存各页宽度；刷新、查看说明按交互稿恢复图标与字号。隔离 UI 验收脚本覆盖两页的真实指针拖动和边界、键盘、取消、复位、重新进入的宽度记忆、窄屏切换及按钮尺寸。
- Qoder 用户级发现补入 `~/.agents/skills`，与已有项目级 `.agents/skills` 对齐；`QODER_CONFIG_DIR` 只覆盖 Qoder 专属根，不替换共享目录。来源依据为 [QoderAI 的 Skill Discovery Reference](https://github.com/QoderAI/better-harness/blob/main/references/agent-customize/skill-discovery.md#qoder)。
- Rust 沿用 `runtime_directory_overrides_change_native_candidates_without_explicit_refresh` owner，将 Codex 的两个配置根输入扩展为 Codex/Qoder × 默认/两次覆盖根矩阵，并确认共享用户来源持续可见；保留原 cache invalidation 输入，不新增测试函数或数据库 fixture。修复前 Qoder 输入缺失 shared 项。最小命令：`cargo test -p rovai-core --lib native_skills::tests --features extended-tests`。
