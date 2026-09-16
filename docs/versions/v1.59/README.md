---
document_type: version-overview
version: v1.59
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-09-16
---

# Rovai-ai v1.59：统一 Rust Host 与三平台 Server

前置：[v1.58](../v1.58/README.md)。前版未完成的评测验收保持原有事实，本版不把它们宣布为完成。
用户确认统一 Rust Host 与共享 Axum Web 方向，并授权在独立 worktree 实施、验证后推送远程任务分支。

## Linux 第一版范围增量

正式发布目标调整为 GNU x86_64 / glibc 2.35 基线；同一发布归档必测 Ubuntu 22.04、Debian 12、Ubuntu 24.04。
Server OS 与 Runtime 资格分别记录；维护者将 Linux 适配扩大至现有目录中除 Cursor 之外的 14 项，
当前显式开放 preview 等待各自实测闭合；该 Linux 范围不包含后续新增的 DeepSeek Harness。
其他 Runtime 的 Linux 探测不自动取得产品资格。未增加 musl、ARM64、Debian 11 或 Linux Desktop。
理由见 [V1.59-D06](decisions.md#v1-59-d06)，进度见[实施计划](implementation-plan.md#当前批次linux-gnu-235-基线与-runtime-实测)。

## 范围与状态

最终由同一个 Rust Host 服务普通 Desktop、Desktop 开启的 Web 服务和独立 Server；后者不启动 Electron。
Server 覆盖 macOS arm64/x64、Windows x64、Linux x64。交付依次为 Server 与宽屏 Web、Desktop 共用 Web、
宽屏功能和多客户端回归、三平台正式验收与发布、Mobile UI。阶段 1 内先抽取 Core、回归旧入口，再验收真实
Headless 执行，最后接入认证、上传和 WebUI。详见[实施计划](implementation-plan.md)。
远程认证按最新确认使用长期登录 Token 与默认 30 天可续期 Session；Host 与浏览器正常重启保留认证，
编辑身份与草稿仍按标签页隔离，精确边界见 [Host Web v2](../../contracts/host-web-v2.md#session-lifetime-and-renewal)。

当前已抽取共享运行层，接入 Headless CLI、同 Host 的 Desktop/Web 管理及共享生产 Camp 页面；
第五阶段按 2026-09-14 用户确认，将 [Mobile WebUI](../../ui/host-web-mobile.md)接入实际 Web 入口，复用现有业务与执行态；
已具备手机展示与操作适配，真实设备验收仍未完成。其他平台原生 Server 验收独立记录；Docker 完全移出当前任务。
用户已通过 [Desktop/Web 行为差异与宽屏对照稿](../../ui/host-web-parity.md)及[组件/API 复用说明](frontend-reuse.md)的方向评审，
直接按共享 Camp、真实写入闭环、双入口一致、逐页复用管理能力推进。Core 已接入独立编辑归属、source 上传、
发送、审批、单聊独立草稿及正式管理页；macOS 两入口真实 Codex 执行、执行中关闭 Web、强杀恢复和
浏览器管理操作已通过。阶段 1–3 的代码及本机业务闭环已收敛；第二实体设备与实体睡眠唤醒尚未验收。
阶段四已推进 Mac arm64 独立包、升级/回退与包内执行，仍不宣称三平台正式发布。
最新补充以 `~/.rovai-server` 替代此前 `~/.rovai/server`：一个可选 `--data-dir` 推导全部 Server 自有
持久位置，Desktop 不迁移、不重排。原生用户入口、可重复安装和新布局的 macOS 本机验收已接通；
新原生矩阵和正式发布分别收口，不代表新命令或安装地址已发布。Docker 不是可选阶段，也不阻塞 Mobile。
架构由[统一 Host](../../architecture/unified-rust-host.md)拥有，取舍见[版本决定](decisions.md)。

所有新增设计只解决数据隔离、命令幂等、凭据保护和宿主运行问题。用户附件保持 source reference 弱持久性；
不做草稿同步、永久附件系统、通用沙箱、Relay、原生移动 App 或三平台系统服务安装器。
原 Windows/Linux 同 UID 隔离原型失败事实保留；按本轮确认，不再作为交付前置或待批准的隔离工程。
缺少实际环境不等于平台功能验证通过或失败。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 前版生命周期冻结；本概览、实施计划与[版本索引](../README.md)建立唯一 current v1.59 |
| Decisions | 已更新 | [V1.59-D01](decisions.md#v1-59-d01)解释唯一 Host；[V1.59-D02](decisions.md#v1-59-d02)确定独立 Server 数据根和原生部署；[V1.59-D05](decisions.md#v1-59-d05)确定长期登录与普通 Session 续期 |
| Contracts | 已更新 | [Host Lifecycle v2](../../contracts/host-lifecycle-v2.md)拥有新入口与数据根，v1 保留兼容；[Host Web v2](../../contracts/host-web-v2.md)、[Draft v13](../../contracts/camp-composer-draft-v13.md)、[Pending v4](../../contracts/pending-camp-input-v4.md)拥有网络写入、编辑归属与恢复；Migration 153 保留旧 Desktop 数据和旧任务分支 150 草稿；154 隔离单聊 Draft/Pending 客户端 |
| Architecture | 已更新 | [统一 Rust Host](../../architecture/unified-rust-host.md)及架构导航记录已确认目标与当前实现的区分 |
| UI | 已更新 | 实际 Web 挂载共享 BusinessApp/CampNavigation/CampWorkspace；同步 main `42e1e6d1` 的运行头像/双弧入口与横向溢出修复；[差异表](../../ui/host-web-parity.md)保留正式能力边界；[Mobile WebUI](../../ui/host-web-mobile.md)已实施，手机对话/执行双入口、更多菜单与紧凑间距已按最终稿接入；执行彩环最多显示 2 个头像及 +N，Run 文案由同一共享状态驱动；Server 更新 API 与共享更新页已接入，Desktop 托管只读版本说明；真实 Release 和各平台升级验收分别记录 |
| Runtime Activity | 已更新 | DeepSeek Harness 复用共享 ACP Activity，按官方结构化结果补 shell 退出、文件路径与完整文件状态；write 的显式 `before:null` 归一为标准新增 Diff，通用 Diff/Files Changed/Diff Card 继续拥有展示，其他 Adapter 分类不变 |
| Runtime compatibility | 已更新 | Linux x64 的 14 项适配行显式 preview，Cursor 保持 not_qualified；原平台证据不变，各行独立验证后才晋升；DSH 的 macOS arm64 以 v1 历史验收和 v2 收敛增量的独立摘要维持 qualified |
| Documentation routing | 已更新 | 文档、架构与决定导航增加统一 Host 入口 |
| Root README | 已更新 | DeepSeek Harness 的 macOS arm64 验收闭合后增加正式支持行；未新增其他平台声明 |

本轮产品模型已确认：单 Owner、可信自托管 Host。远程 Owner 与 Desktop 具有同一业务能力目标，
可以直接选择 Host 有权访问的目录；不再要求本机目录预授权、一次性令牌展示或唯一手填访问地址。
原 S1 同 UID 强隔离证明不再阻断交付，历史失败与已知风险保留，网络/浏览器防护和 Runtime 权限审批不变。


## 文件预览保留增量

2026-09-15 用户确认同窗口跨 Camp 直接复用预览，采用分层 LRU、64 个本机逻辑句柄容量回收和独立候选刷新；
授权 worktree 实现、验证后 PR 合并 main。范围与取舍见 [V1.59-D07](decisions.md#v1-59-d07)，
当前协议见 [File Preview v14](../../contracts/file-preview-v14.md)。本增量不改变其他 Server/Runtime 验收状态。


## DeepSeek Harness Runtime 增量

2026-09-15 用户授权在独立 worktree 按 Runtime checklist 接入 dsh 0.1.5-rc.2。新增 `deepseek-harness` 与
`dsh` Skill group，复用共享 ACP/Fleet、原生配置和现有 UI 参数组件。macOS arm64 的 14 轴验收闭合并取得独立 digest-bound qualified，其他平台未取得资格。
Migration 157 扩充闭集，当前 v1.59/schema 107；保留 schema 106 原位升级及此前受支持来源。
Bootstrap 使用已有 managed delivery，模型可见内容、Context/Manifest 与版本轴不变。
2026-09-16 进一步收敛到 Runtime 通用架构：DSH 原生 `sandbox_mode`/`approval_policy` 从队员页到 Host 原样传递，
Core 不为 MCP 合成第二层安全策略；配置变化时 shared Fleet 先确认旧 Host 释放 Session 锁，busy Run 正常结束后
再 replacement；官方 write/edit 完整状态只被翻译成标准 ACP terminal Diff。write 的显式 `before:null` 是可信空前态，
形成 `oldText:null` 的新增 Diff；缺字段、类型错误、超限或不可信时保持路径级回退。
ACP 启动额外等待已配置的原生 MCP Loader entry 完成，避免 0.1.5-rc.2 提前开放 stdio 时首轮工具表缺项；
该门闩使用原生 lifecycle，不采用固定延时或 prompt 重试。
Desktop 与 Mobile 共用原生权限文案和“需要 0.1.5-rc.2 或更高版本”的不兼容提示。
决策见 [V1.59-D10](decisions.md#v1-59-d10)，逐项执行证据与上游差异见 [DSH Parity Matrix](../../research/deepseek-harness-runtime/acp-0.1.5-parity.md)。

## Weekly 无时间上限增量

2026-09-15 用户要求取消 Weekly 时间预算，并授权独立分支实现、验证、PR 合入 main 后安装。
新增显式 null 时间策略贯通构建、执行、Judge、宿主、等待器和指定 Automation；普通任务及旧计划保持。
Migration 155/schema 105 原位保存定义策略，保留历史执行与模型输入；无需新增 Context 版本或二次上下文确认。
当前合同为 [Execution Evaluation v15](../../contracts/execution-evaluation-v15.md)、
[Scheduled Automation v2](../../contracts/scheduled-automation-v2.md)及 [User Automation v6](../../contracts/user-automation-v6.md)。
架构与开发路由同步到当前合同。UI、Runtime Activity、平台兼容资格和根 README 无需改变；这次是显式执行
策略修正，不增加独立长期决策。验证记录见[实施计划](implementation-plan.md#weekly-无时间上限)。
真实 Weekly 结果仍须安装新 App、Owner 绑定后实际运行证明，不以设施测试替代。

## Agent 附件原路径引用增量

用户在 2026-09-16 审阅 revision 1 后给出最终修订：所有新增 Agent 附件原地登记，取消复制、
链接、staging、预分配、外部请求编号和双根模型上下文。默认永久输出目录只用于生成最终交付，
Run Facts 顶层仅提供 attachmentOutputRoot；删除 Camp 仅清理自有位置，外部/跨 Camp 源只保留引用语义。
[已确认 revision 2](model-context-change-editable-attachments.md)记录精确字段与确认消息，
[实施计划](editable-attachments-implementation.md)保留原 worktree 与 PR/main 合并交付顺序。
当前在原 worktree 实施并验证；Migration 156/schema 106 保留旧记录，新增 Formatter/Manifest 24、Run Facts 3、CLI 25/Output 3。
当前权威为 [Camp Attachment v10](../../contracts/camp-attachment-v10.md)、[Context v24](../../contracts/context-manifest-evidence-v24.md)、
[File Preview v15](../../contracts/file-preview-v15.md)；理由见 [V1.59-D08](decisions.md#v1-59-d08)。
运行活动分类、平台资格、根 README 无需变化；不能由方案确认推断 Gate 或 PR 已完成。

## Web HTML 原生存储兼容增量

2026-09-16 用户确认可信 HTML 的同来源预览策略，Desktop 托管 Web 与独立 Server Web 复用统一 Rust 实现。
原生存储归访问设备的浏览器，允许表单、新窗口和原生弹窗；接受同来源工作台及登录材料可被附件访问的取舍。
当前权威与范围见 [Host Web v2](../../contracts/host-web-v2.md#workspaces-uploads-and-resources)，理由见
[V1.59-D09](decisions.md#v1-59-d09)。不修改 Desktop 原生预览、HTML 源文件或资源加载，不新增存储/预览服务。
