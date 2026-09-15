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
2026-09-15 的固定发布包先使用官方 DeepSeek Flash 验证普通回复、warm continuation、文件/命令工具、
Skills、全部 23 项 Built-in CLI 和原生压缩。官方余额耗尽后，按用户明确授权读取既有 MiniMax BYOK Key，
仅传入隔离 DSH 验收进程，通过官方 llm-pi-ai/Anthropic-compatible 路由继续运行 MiniMax-M3。
Missing-Send、完整冷恢复/取消/无效 ID fallback、MCP 生命周期和压缩后的能力组合均已补齐。
脱敏结果和私有原始日志摘要见 [机器可读证据](acp-0.1.5-evidence.json)。原始日志、数据库、原生 Home 和
凭据留在仓库外；受控模型只产生确定的工具请求，工具执行、权限和 Session 仍由实际 DSH/Core 负责。

下表的 `NotObserved` 表示该轴仍有清单要求未取得完整证据，不能由其中的通过项推导整轴已完成。
Implementation 均指当前代码；缺失的行为验收不是上游 Unsupported。

| 能力轴 | 当前证据 / 实现 | 已核对结果 | 未闭合项或明确差异 |
| --- | --- | --- | --- |
| Auth / Provider / Model | Verified / Implemented | 原生配置与 grouped catalog；官方 Flash 与 MiniMax-M3 BYOK 真实生成；标准 set_config_option | ACP profile 的默认模型独立于交互入口；缺 Key 归 authentication、不自动重试；Ready 不证明余额 |
| Host / Fleet / LRU | NotObserved / Implemented | 真实同 Host warm；同进程 A→B→A；同成员并发独立 Host、exact 切回；Core crash 后进程树退出并 exact 恢复 | 正在观察生产 30 分钟 idle eviction；共享 Fleet 的 LRU/租约/退役回归已通过 |
| Native Session / Continuation | Verified / Implemented | warm、Core cold、压缩后新 Host exact resume；MCP 更新 exact；无效持久 ID 仅一条 continuity lost 并创建替代 Session | 不用 session/load；冷恢复没有历史 Action/Approval 重放 |
| Bootstrap / Context | Verified / Implemented | 官方 systemPrompt section 每模型步按 exact Session 装配冻结字节；A/B/A、cold、compaction 保留正确身份；测试覆盖子代理不继承成员自身份、缺失/损坏绑定拒绝 | 相比 Grok 的 _meta.rules，使用受管官方 Cordis 插件；ContextManifest/Bootstrap 内容格式不变 |
| Compaction continuity | Verified / Implemented | manual、压力、overflow、自动阈值、overflow retry、fail/cancel、压缩后 cold resume；每阶段重新加载随机 Skill marker、实际 MCP 调用与一条审批；压缩后 deny 零副作用 | overflow 使用一次受控错误触发真实 native retry；无 ACP /compact/lifecycle，采用持续 System 层 |
| Skills | Verified / Implemented | 实际读取 .dsh/skills 的随机 marker 与 cli-operations；导入、冲突保留、删除、禁用/重启投影复核 | 沿用共享 group 与原生目录追加；不是独立 Skill 设置 |
| External MCP | Verified / Implemented | 最终真实模型通过 stdio/HTTP、同名覆盖、更新、相邻隔离、取消分配/重分配/删除、原生恢复、exact Session；allow 一次、deny/cancel/read-only 零副作用 | 断言实际 Tool output 与副作用计数；相邻回合使用新 nonce，不能以复述历史结果充当调用；无 SSE/resources/prompts |
| Tool / Action / Command Output | Verified / Implemented | stdout/stderr/mixed/empty/nonzero/large；read/add/edit/empty；稳定 callId、canonical path、非零失败、4 KiB 公开截断 | 官方 tools/result 补 ACP 丢失的 exit metadata；未知工具保持 other；不从结果正文猜状态 |
| Narration / Final / Missing-Send | Verified / Implemented | ACP committed public/thought 分流、end_turn 唯一终态；真实 zero-send 发布、accepted-send suppression、tool→final 三组通过 | 不把进程退出或日志末尾当 final；通用 ACP recovery 保留原生 public text |
| Permission / Approval / Workspace | Verified / Implemented | 六组合冻结 patch；真实 write/Bash 在 workspace-write 内写成功、越界拒绝，read-only 均拒绝；MCP allow/deny/cancel；Shell 取消后 32 秒无迟到文件 | 原生 workspace-write 允许部分 OS 临时区，越界测试目标位于临时区外；不支持 additionalDirectories |
| Built-in rovai CLI | Verified / Implemented | contract-v24 全 23 操作、70 条证据；原生 Bash、三种输入源、精确寻址、Gather、历史/附件、新旧 Run lease fencing、原 Session 续轮 | 共用 bundled CLI 与 private IPC，未走 built-in MCP |
| Usage / Cache / Cost | Verified / Implemented | 8 个真实 Run 的逐调用入库；新增真实 Core warm/自动压缩/cold 三轮对账与独立原生 observer 的五类 Token 桶完全一致，无重放计数；context gauge 分开 | cache write/cost 未报告，保持 NULL；MiniMax 未报告 reasoning 也保持 NULL；空闲 manual summary 不归入后续 Run |
| Retry / Queue / Cancel / Cleanup | Verified / Implemented | 共享 accepted-input/queue/lease；余额/缺 Key 不盲重试；真实 pending-approval 取消及运行中 Shell 严格 cancelled；32 秒无晚到文件；Core crash、正常停止清理进程树 | Native compact fail/cancel 保持 generation；idle 回收的专属结果见 Host 轴 |
| Ready / Version / Platform | NotObserved / Implemented | CLI >=0.1.5-rc.2 门槛、原生 executable fingerprint、initialize/new/resume 与 catalog 检查；schema 105/closed catalogs/选择器接通 | macOS arm64 preview/evidenceRevision=null；其他平台无本次真实证据 |

### 关键行为与其他 ACP Runtime 的区别

1. **Host warm**：共用 ACP/Fleet 的 member-scoped resident multi-session 策略，与 Grok/Kimi 路线一致。
   DSH 原生 Session 存储持进程锁；实际 MCP 更新最初出现旧 Host 占锁。现在共享 Fleet 先退役同范围不兼容的
   idle Host，再启动 replacement exact resume；真实与受控完整生命周期验证均不再丢失 Session。Run-local MCP 证据
   和可变模型选项不进入进程兼容键，真实配置/权限/目录/原生输入摘要变化仍会 fence。
2. **Bootstrap**：DSH ACP 没有可用 system 字段。使用官方 Cordis systemPrompt 扩展点，按 exact Native
   Session 读取 0600 私有绑定，SHA-256 校验，变量仅展开一次。不会把 Charter/Identity 放进用户消息，
   不依赖模型复述，不修改 Shared Bootstrap 或 Manifest 字节。
3. **Compact**：策略是 native_system_prompt_preserved，类似 Pi 的持续系统层。生产没有文字 detector 或
   compact 后重发；原生下一模型步自然重新装配。原生实测 generation 0→1→2→3，cold resume 后自动压力
   3→4、受控 overflow 加真实重试 4→5；失败与取消保持 5→5。七个能力检查点均实际加载新 Skill 内容、
   调用 MCP 并触发审批；最后 deny 没有副作用。ACP 不暴露人工 compact 命令，因此该入口
   仍是原生能力，不伪造 UI 成功或使用 token 降幅推断完成。
4. **工具与用量**：DSH ACP 把 Bash 非零退出也报告为 completed，且 usage_update 只有占用率。官方只读
   tools/result 与 committed session/event observer 分别提供结构化退出状态和逐调用用量，Core 以
   Session/call 或 Session/turn/seq 关联并消费，私有文件随 Host 回收。stdout/参数继续使用 ACP。
   自动压缩摘要也提供结构化 usage，通过 committed compaction/start 的 compactionId/owner turn 关联；
   不收集摘要正文，空闲手动压缩的 null turn 不归入后续 Run，未知字段保持 NULL。
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
node scripts/smoke-dsh-safety.mjs
node scripts/smoke-dsh-usage.mjs
ROVAI_DSH_FLEET_IDLE_CHECK=1 node scripts/smoke-dsh-fleet.mjs
```

`probe-dsh-runtime.mjs` 在隔离 Home 内通过官方扩展点降低测试阈值并控制失败/取消；真实 summarizer 与生成仍会
消耗模型余额。生产 Host 不加载这些控制。`ROVAI_DSH_SCRIPTED_MCP=1` 仅用于 MCP smoke：替代模型请求，
执行实际 Native Tool/Core 权限状态机，不调用 Provider；报告显式写入 modelSource，不能作为真实模型结论。
Fleet smoke 使用生产 30 分钟 TTL，不降低正式超时；同时验证并发、切回、Core crash 与 planned shutdown。
Safety smoke 使用 Core 的实际冻结参数，并把越界目标放在自有的 Home 临时目录，避免 OS 临时目录白名单造成误判。
Usage smoke 仅在隔离原生 Home 降低压缩阈值，通过独立官方 observer 对照 Core 数据库；检查普通调用与摘要调用
的五类 Token 桶、warm/cold 同一 Native Session、新 Host 和零重放，不修改生产阈值或替代 Provider。

### BYOK 验收与 ACP 默认模型

正式 Adapter 不读取 Qoder/CodeBuddy 的配置。此次借用 Key 是用户明确授权的验收输入，私有包装进程只读取
该值并注入子进程环境；没有把 Key 放进 argv、仓库、公开日志或模型上下文，也没有改动日常 DSH Home。

DSH `llm-pi-ai` 的 `providers` settings 可声明 `apiKeyEnv`、`api: anthropic-messages`、官方
`baseURL: https://api.minimaxi.com/anthropic` 和 MiniMax-M3 模型。可用性先用官方模型列表确认，再以实际
DSH 生成验证。协议地址见 [MiniMax Anthropic-compatible 文档](https://platform.minimaxi.com/docs/token-plan/other-tools)。
`agent-default-model` settings 不覆盖 ACP composition 已声明的默认模型；ACP 要在原生 patch 中设置：

```json
[{"id":"acp","config":{"provider":"minimax-smoke","model":"MiniMax-M3"}}]
```

其中 provider 必须与 `llm-pi-ai.providers` 的 route key 一致。也可由 Rovai 显式选择真实 catalog 的不透明
模型 ID。隔离 probe/MCP smoke 支持 `ROVAI_DSH_SMOKE_SETTINGS_PATH` 与 `ROVAI_DSH_SMOKE_PATCH_PATH`，
分别复制私有 settings 文件与 JSON patch 数组；不会把验收文件投射到生产 Home。其他 Core smoke 继承调用方
准备的隔离 `DSH_HOME`。`ROVAI_DSH_MODEL` 可为普通 ACP smoke 指定显式 catalog ID。

### 收尾门禁

已通过 `cargo check --workspace --all-targets`、`cargo clippy --workspace --all-targets -- -D warnings`、
`cargo fmt --all -- --check`、TypeScript typecheck、Web/Electron desktop build、文档治理 10 项测试及
带明确 base 的 `docs:check:ci`。Rust 主测试 813 项通过、6 项保留原有 ignore；CLI 35 项通过；新增 Adapter
纳入既有 ACP Tool/Diff/Output owner 后，3 项定向回归通过；slow-tests 全部 310 项通过，`pnpm test:rust:pr` 完整通过。
DSH 官方扩展点 Node owner 通过；Missing-Send protocol、Runtime picker 和 configured Camp 共 9 项通过；后续 DSH observer 与 Missing-Send 定向 7 项再次通过。

最终 Vitest 使用 `--maxWorkers=1 --testTimeout=15000 --expect.poll.timeout=15000` 全量复跑：
204 个测试文件、2072 项全部通过。早期并行负载下出现 evaluation-host/CoreClient 的时序超时，
隔离复跑 25 项通过后降低测试进程并发完成全量；没有修改或禁用这些测试。上述本地门禁不能替代
真实 Runtime 行为证据。
本次不更新任何 DSH 平台资格 digest，不把既有 Runtime 的资格证据转用到 DSH。
