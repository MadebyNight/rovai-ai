---
document_type: research-evidence
status: in-progress
last_updated: 2026-09-15
---

# DeepSeek Harness 0.1.5-rc.2 ACP 接入对照

本次重新检查官方发布包 `@deepseek-ai/dsh@0.1.5-rc.2` 及其同版本 ACP 包。旧 [Research Brief](README.md)
基于 0.1.0-rc.5，仅保留历史研究价值。准入按 [Runtime checklist](../../development/runtime-integration-checklist.md)。
最近生产参照是 Grok Build / Kimi Code 的共享 ACP Host；System Prompt 持续装配参照 Pi 的 managed delivery。

## 实现前 Parity Matrix

以下策略在修改 Adapter 前建立；源码证据不等于真实 Golden Flow 通过。

| 能力轴 | 标准行为及上游能力 | 接入策略 | 初始证据 / 实现状态 | 与其他 Runtime 的差异 |
| --- | --- | --- | --- | --- |
| Auth / Provider / Model | 原生 settings/credentials；标准 configOptions 给出 provider/model 与 reasoning_effort | 继承原生 DSH_HOME；使用不透明模型 ID 与 set_config_option；配置变化 fence 复用 | DocumentationOnly / NotImplemented | ACP authenticate 本身不验证模型凭据 |
| Host / Fleet / LRU | 一个 stdio Host 可拥有多个独立 Session，prompt 在 idle/update drain 后结算 | resident_multi_session，共享 Fleet owner、lease、LRU、并发 Host 与 cleanup | DocumentationOnly / NotImplemented | 无私有进程池 |
| Native Session / Continuation | exact resume 验证原 cwd，不回放历史；close 只关闭指定 Session | warm 精确切换；cold session/resume；失败一次 fresh fallback | DocumentationOnly / NotImplemented | 不使用 session/load |
| Bootstrap / Context | ACP 无 system 字段；官方 systemPrompt section/variable 每步装配 | managed_system_prompt，按 exact Session 读取私有 bootstrap；动态输入沿用 ContextManifest | DocumentationOnly / NotImplemented | 通过官方 Cordis 扩展点，不使用 Grok _meta.rules |
| Compaction continuity | System Prompt 每模型步装配；ACP 不暴露 commands/compact lifecycle | native_system_prompt_preserved；分别验证压缩与压缩后恢复 | DocumentationOnly / NotImplemented | 无 ACP /compact 命令或原生完成事件，不添加文本 detector |
| Skills | 官方 filesystem provider 支持 project/custom/user 目录与 watch | 复用 Skill delivery group，原生 .dsh/skills 路由 | DocumentationOnly / NotImplemented | 与原生目录追加，不建立第二套设置 |
| External MCP | session/new/resume 支持 stdio 与 HTTP；stdio command 必须绝对路径 | PreparedMcpProjection 经标准 session 参数；解析冻结 PATH 的命令入口 | DocumentationOnly / NotImplemented | SSE、MCP resources/prompts 无原生消费者 |
| Tool / Action / Output | committed tool_call、tool_call_update、稳定 callId、kind=other | 共享 ACP action；只按已知 dsh tool name/input 映射命令与文件 | DocumentationOnly / NotImplemented | generic kind 需 Adapter 显式映射 |
| Narration / Final / Missing-Send | committed message/thought 分离；prompt stopReason 为终态 | 共享 ACP final、私有 thinking、zero-send recovery | DocumentationOnly / NotImplemented | 非原始 token stream |
| Permission / Approval / Workspace | 原生 sandbox-policy read-only/workspace-write/danger-full-access；approval ask/never | 冻结 Host 权限，read-only 收窄，exact allow/reject；原生 FS/Shell | DocumentationOnly / NotImplemented | 无 session mode；拒绝非空 additionalDirectories |
| Built-in rovai CLI | 原生 Bash/PowerShell 可继承进程环境 | 共享 bundled CLI、Run lease 与 process-stable tmp | NotObserved / NotImplemented | 不能以 MCP 成功替代 CLI smoke |
| Usage / Cache / Cost | ACP usage_update 只输出 used/size 的当前占用 | 映射 context gauge；token/cache/cost 不从占用估算 | DocumentationOnly / NotImplemented | 原生日志有用量不代表 ACP 已公开可归属账单 |
| Retry / Queue / Cancel / Cleanup | prompt/cancel/close 等待 Agent、updates、descendants、persistence | 共享 accepted-input fencing、取消与受管进程回收 | DocumentationOnly / NotImplemented | 原生重试保持唯一 owner |
| Ready / Version / Platform | CLI 版本与 ACP agentInfo 版本不同；握手不证明认证/行为 | 固定最低支持版及 DSH 专属证据；逐平台准入 | DocumentationOnly / NotImplemented | 不继承其他 ACP 的平台资格 |

## 发布包证据

- [DSH 0.1.5-rc.2](https://registry.npmjs.org/@deepseek-ai/dsh/0.1.5-rc.2)，tarball integrity：
  `sha512-8Xc8hCQHcIWRmTCVU/xZdp6/qMsWMeAd2ObChKDEsfhUPJFXx6H0lgeb1DxUMD86HZrrVN+1bCvn1ppjZ/fOxw==`。
- [ACP 官方实现](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp)。
- 发布包 `dsh-acp/README.md`、`dsh-acp/lib/index.js`、`dsh-acp-app/cordis.patch.yml`、
  `dsh-system-prompt/lib/types/index.d.ts` 是本次源级核对对象；仓库 master 链接只用于导航。

## 验证记录

### 当前结论

已实现官方 ACP 接入，macOS arm64 开放 **preview**，尚未达到 First-Class。其余平台保持 not_qualified。
2026-09-15 的固定发布包真实模型已通过普通回复、warm continuation、文件/命令工具、Skills、全部 23 项
Built-in CLI，以及真实原生压缩/恢复。随后 Provider 返回 `Insufficient Balance`，剩余真实模型验收暂停。
脱敏结果和私有原始日志摘要见 [机器可读证据](acp-0.1.5-evidence.json)。原始日志、数据库、原生 Home 和
凭据留在仓库外；受控模型只产生确定的工具请求，工具执行、权限和 Session 仍由实际 DSH/Core 负责。

下表的 `NotObserved` 表示该轴仍有清单要求未取得完整证据，不能由其中的通过项推导整轴已完成。
Implementation 均指当前代码；缺失的行为验收不是上游 Unsupported。

| 能力轴 | 当前证据 / 实现 | 已核对结果 | 未闭合项或明确差异 |
| --- | --- | --- | --- |
| Auth / Provider / Model | Verified / Implemented | 使用原生配置；4 个 grouped model；标准 set_config_option；真实官方 Flash 生成 | initialize/authenticate 不验证余额；Probe Ready 只表示机器连接与配置就绪 |
| Host / Fleet / LRU | NotObserved / Implemented | 真实同 Host warm；同进程 A→B→A 无身份串线；共享 Fleet 覆盖 LRU/租约/退役；受控 MCP 配置变化回收旧 Host | DSH 专属并发压力、完整 idle eviction/App crash 进程树验收待补 |
| Native Session / Continuation | NotObserved / Implemented | 普通 warm、Core 重启 exact resume、压缩后新 Host exact resume；原生无效 ID 拒绝；MCP 更新保留 exact Session | Core 全程 invalid-binding→仅一次 fresh fallback 验收待补；不用 session/load |
| Bootstrap / Context | Verified / Implemented | 官方 systemPrompt section 每模型步按 exact Session 装配冻结字节；A/B/A、cold、compaction 保留正确身份；测试覆盖子代理不继承成员自身份、缺失/损坏绑定拒绝 | 相比 Grok 的 _meta.rules，使用受管官方 Cordis 插件；ContextManifest/Bootstrap 内容格式不变 |
| Compaction continuity | NotObserved / Implemented | manual、压力、overflow、自动压力、overflow retry、失败/取消、压缩后 cold resume 的原生 System 层均通过 | overflow 使用一次受控错误触发真实 native retry；压缩期间 Skill/MCP/权限组合验收待补；无 ACP /compact/lifecycle |
| Skills | Verified / Implemented | 实际读取 .dsh/skills 的随机 marker 与 cli-operations；导入、冲突保留、删除、禁用/重启投影复核 | 沿用共享 group 与原生目录追加；不是独立 Skill 设置 |
| External MCP | Verified / Implemented | 真实模型 stdio/HTTP 与同名覆盖；最终受控模型验证更新、相邻隔离、取消分配/重分配/删除、原生恢复、exact Session 与安全副作用计数 | 最终 Fleet/安全修订尚待真实模型重跑；原生 profile 不消费 SSE/resources/prompts |
| Tool / Action / Command Output | Verified / Implemented | stdout/stderr/mixed/empty/nonzero/large；read/add/edit/empty；稳定 callId、canonical path、非零失败、4 KiB 公开截断 | 官方 tools/result 补 ACP 丢失的 exit metadata；未知工具保持 other；不从结果正文猜状态 |
| Narration / Final / Missing-Send | NotObserved / Implemented | ACP committed public/thought 分流，end_turn 唯一终态；普通回复及 tool→回复通过 | 完整 zero-send、accepted-send suppression、tool→final Missing-Send smoke 被余额阻断 |
| Permission / Approval / Workspace | NotObserved / Implemented | 原生 sandbox/approval 冻结；六组合 patch 单测；实际 DSH/Core 受控 MCP allow 一次、deny/cancel/read-only 零副作用 | 原生文件/命令 read-only 与 workspace-write 越界、取消后迟到写入的完整验收待补；不支持 additionalDirectories |
| Built-in rovai CLI | Verified / Implemented | contract-v24 全 23 操作、70 条证据；原生 Bash、三种输入源、精确寻址、Gather、历史/附件、新旧 Run lease fencing、原 Session 续轮 | 共用 bundled CLI 与 private IPC，未走 built-in MCP |
| Usage / Cache / Cost | Verified / Implemented | 8 个真实 Run 的 committed per-call usage 入库；uncached、cache read、output、reasoning 独立；context gauge 分开；一条 observation 仅消费一次 | cache write/cost 本次缺失，保持 NULL；不根据 used/size 推算 Token/费用 |
| Retry / Queue / Cancel / Cleanup | NotObserved / Implemented | 复用 accepted-input/queue/lease owner；quota 分类不自动重试；受控 MCP pending-approval 取消无执行；原生 compact cancel 无假完成 | Core 正在执行 Shell 的取消、晚到事件、崩溃后的进程树完整实测待补 |
| Ready / Version / Platform | NotObserved / Implemented | CLI >=0.1.5-rc.2 门槛、原生 executable fingerprint、initialize/new/resume 与 catalog 检查；schema 105/closed catalogs/选择器接通 | macOS arm64 preview/evidenceRevision=null；其他平台无本次真实证据 |

### 关键行为与其他 ACP Runtime 的区别

1. **Host warm**：共用 ACP/Fleet 的 member-scoped resident multi-session 策略，与 Grok/Kimi 路线一致。
   DSH 原生 Session 存储持进程锁；实际 MCP 更新最初出现旧 Host 占锁。现在共享 Fleet 先退役同范围不兼容的
   idle Host，再启动 replacement exact resume；受控完整生命周期验证不再丢失 Session。Run-local MCP 证据
   和可变模型选项不进入进程兼容键，真实配置/权限/目录/原生输入摘要变化仍会 fence。
2. **Bootstrap**：DSH ACP 没有可用 system 字段。使用官方 Cordis systemPrompt 扩展点，按 exact Native
   Session 读取 0600 私有绑定，SHA-256 校验，变量仅展开一次。不会把 Charter/Identity 放进用户消息，
   不依赖模型复述，不修改 Shared Bootstrap 或 Manifest 字节。
3. **Compact**：策略是 native_system_prompt_preserved，类似 Pi 的持续系统层。生产没有文字 detector 或
   compact 后重发；原生下一模型步自然重新装配。原生实测 generation 0→1→2→3，cold resume 后自动压力
   3→4、受控 overflow 加真实重试 4→5；失败与取消保持 5→5。ACP 不暴露人工 compact 命令，因此该入口
   仍是原生能力，不伪造 UI 成功或使用 token 降幅推断完成。
4. **工具与用量**：DSH ACP 把 Bash 非零退出也报告为 completed，且 usage_update 只有占用率。官方只读
   tools/result 与 committed session/event observer 分别提供结构化退出状态和逐调用用量，Core 以
   Session/call 或 Session/turn/seq 关联并消费，私有文件随 Host 回收。stdout/参数继续使用 ACP。
5. **MCP 与权限**：MCP 采用 RovaiWins whole-definition（与 Grok NativeWinsSkip 不同）；scope-local
   server 覆盖同名原生全部 Tool，包括 native-only Tool。交互式 preset 不参与受管 Host；`never` 是拒绝
   escalation，`ask` 通过原生 ACP Approval。MCP 没有副作用声明时，ask 询问、只读拒绝，不能从工具名称猜安全性。

### 复跑入口与隔离

先构建 Core；所有脚本使用独立 Core data/Skill/MCP 根。凭据仅通过调用方私有环境或隔离 DSH_HOME 提供。
`ROVAI_DEEPSEEK_HARNESS_BIN` 指向固定 `0.1.5-rc.2` 可执行文件；正式产品仍继承用户原生 Home。

```bash
pnpm core:build:debug
ROVAI_ACP_SMOKE_ADAPTER=deepseek-harness ROVAI_ACP_FILE_OPERATION_MATRIX=1 node scripts/smoke-acp-runtime.mjs
ROVAI_ACP_SMOKE_ADAPTER=deepseek-harness ROVAI_ACP_FULL_COMMAND_MATRIX=1 ROVAI_ACP_COMMAND_OUTPUT_ONLY=1 node scripts/smoke-acp-runtime.mjs
ROVAI_BUILTIN_CLI_ADAPTERS=deepseek-harness node scripts/smoke-builtin-cli.mjs
ROVAI_SKILL_SMOKE_ADAPTERS=deepseek-harness node scripts/smoke-skills.mjs
ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=deepseek-harness node scripts/smoke-mcp-projection.mjs
ROVAI_COLD_RESUME_ADAPTER=deepseek-harness node scripts/smoke-trae-cold-resume.mjs
ROVAI_MISSING_SEND_RECOVERY_ADAPTERS=deepseek-harness node scripts/smoke-missing-send-recovery.mjs
node scripts/probe-dsh-runtime.mjs
```

`probe-dsh-runtime.mjs` 在隔离 Home 内通过官方扩展点降低测试阈值并控制失败/取消；真实 summarizer 与生成仍会
消耗模型余额。生产 Host 不加载这些控制。`ROVAI_DSH_SCRIPTED_MCP=1` 仅用于 MCP smoke：替代模型请求，
执行实际 Native Tool/Core 权限状态机，不调用 Provider；报告显式写入 modelSource，不能作为真实模型结论。

### 收尾门禁

已通过 `cargo check --workspace --all-targets`、`cargo clippy --workspace --all-targets -- -D warnings`、
`cargo fmt --all -- --check`、TypeScript typecheck、Web/Electron desktop build、文档治理 10 项测试及
带明确 base 的 `docs:check:ci`。Rust 主测试 812 项通过、6 项保留原有 ignore；CLI 35 项通过；新增 Adapter
纳入既有 ACP Tool/Diff/Output owner 后，3 项定向回归通过；slow-tests 全部 310 项通过，`pnpm test:rust:pr` 完整通过。
DSH 官方扩展点 Node owner 通过；Missing-Send protocol、Runtime picker 和 configured Camp 共 8 项通过。

Vitest 全量复跑中 203/204 套通过：默认参数出现 evaluation-host 的 3 项时序超时；将本次运行的 test/poll
等待窗口设为 15 秒后，该组通过，但 CoreClient 的 6 项内部时间窗断言失败。编译阶段结束后，以同样的
15 秒窗口单独复跑这两个未改动的测试文件，25 项全部通过。没有修改或禁用这些测试；不宣称默认参数下
一次全量全绿。上述本地门禁不能覆盖上表保留的真实 Runtime 待验收项。
本次不更新任何 DSH 平台资格 digest，不把既有 Runtime 的资格证据转用到 DSH。
