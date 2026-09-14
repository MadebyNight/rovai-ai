---
document_type: version-decisions
version: v1.59
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-14
---

# v1.59 版本决定

<a id="v1-59-d01"></a>
## V1.59-D01：唯一 Rust Host，按语义保真检查点接入 Web

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[统一 Rust Host](../../architecture/unified-rust-host.md)

独立 Server 和 Desktop Web 需要同一业务、恢复与权限事实。另建 Node Server 或第二份 Core 会产生双重
调度、状态与迁移成本。选择把现有应用运行层嵌入同一个 Rust Host，并让 Axum 模块只消费既有服务句柄。
旧 Desktop 先通过共享运行层回归，再迁本机 IPC，避免 HTTP 并发暗中改变原普通串行命令语义。

代价是必须逐项交代 Main 后台职责，三平台各自验证 Runtime 与环境；共享代码不提供兼容性证明。
首轮只补草稿归属、上传引用、显式会话认证；控制面威胁模型按下文最新确认执行，保留 source reference 弱持久性。
不采用跨端同步、永久上传资产、通用沙箱或新的基础常驻服务来替代这些具体边界。

2026-09-12 用户补充明确：统一 Rust 解决领域与执行权威，生产 React 页面复用解决共同业务交互。
独立只读 Web 的列表和主题复用不能作为阶段 1–3 完成证据。保留 Host/Core/Axum，先做生产组件对照稿，
确认后依次完成共享 Camp、真实写入、双入口与逐页业务能力；Mobile/扩平台/发布优化暂停。
安全发布阻塞与页面复用缺口分开，等待安全决策时继续受控本机 UI 与非发布测试。

同日用户通过方向评审，要求立即接入实际 Web。采用从原生产 App 提取的 BusinessApp 协调导航、刷新和操作，
两端显式注入客户端与资源能力，不以目录重组或 fixture 入口一致作为完成标志。浏览器设备快捷键与 Host 的
Runtime/OS 投影分开；SSE 失效通知进入共同的授权重读路径，不广播内部事件全集。

短期认证 Session 与长期于本次页面生命周期的编辑身份分开：同 Owner 重新登录保留输入与原命令核对，
编辑身份的恢复需要新管理认证及 Core 校验的独立证明。不同标签页不共享草稿；不建立跨端同步服务。
待发送仍是同一 Camp 的 FIFO，另一客户端可明确接管现有编辑占用并轮换令牌，不能隐式读取或合并其未提交编辑。
Web 上传仅创建临时 source ref；Core 接受后的源文件寿命不随退出、发送失败或删除引用而变化。

同日用户正式收敛为“单 Owner、可信自托管 Host”：取消目录预授权名单、一次性令牌展示和唯一手填访问地址，
允许 Owner 直接使用 Host 有权访问的目录。多接口发现只影响地址呈现，198.18/15 不作为默认 LAN 推荐而非禁用。
令牌保留在 Host 进程内以便重复查看，重新生成独立撤销旧会话。由此明确接受同 UID 恶意进程风险，不再以原
S1 系统级隔离证明为交付前置，也不实施 AppContainer/Landlock 等强隔离工程。历史失败不改为通过；网络认证、
跨站/内容保护、文件校验、限额及 Runtime 既有权限审批继续有效。优先验收另一设备登录后选择目录并继续工作。

2026-09-13 用户进一步收紧地址发现：198.18.0.0/15 不是本产品的 VPS／公网目标，直接从发现结果排除，
不展示、复制、扫码或推荐，不增加特殊入口。此呈现规则替代前述“不默认推荐但可选”，不改变网络层接入规则。
设置页按现有风格简化为“远程访问”开关与地址、令牌行；最初二维码仅含地址，后续扫码登录决定如下。

同日用户明确将 Desktop 二维码升级为扫码直接登录：普通地址分享仍不含凭据；显式扫码登录允许
fragment 携带两分钟一次性票据，禁止长期管理 Token 和已有浏览器 Session。这一决定替代旧的
“所有二维码只能含地址”约束。统一 Rust Host 负责签发、原子兑换、到期和重新生成／轮换／关闭失效；
前端立即清除 fragment 后 POST，复用原 Session 与草稿证明机制，不建设账号或设备管理系统。

随后用户确认端口常驻、修改在下次启动生效；开关不再要求本机／远程选项，关闭无需二次确认。
开启后分别标注本机与远程地址，各自提供复制、二维码图标；沿用会话区复制图标和设置页风格。
端口的未应用编辑属于前端窗口状态，不改变 Rust 当前监听、认证或会话生命周期。

用户随后要求令牌栏常驻且移除环形箭头按钮。管理令牌的寿命因此归于 Host 进程，关闭监听不再清空它；
同一 Host 再次开启沿用原令牌，但旧浏览器 Session 仍失效。设置页只保留显隐和复制，底层显式轮换操作保留。
本轮不增加跨 Host 进程重启的令牌存储。

<a id="v1-59-d02"></a>
## V1.59-D02：原生 Server 独立数据根与安装归属

- 状态：accepted
- 日期：2026-09-13
- 当前权威：[统一 Host 的原生 Server 数据与分发](../../architecture/unified-rust-host.md#原生-server-数据与分发)、[Host Lifecycle v2](../../contracts/host-lifecycle-v2.md)

共享 Host 不意味着 Desktop 与独立 Server 共用数据或程序安装。把 Desktop SQLite 迁往 `.rovai` 会扩大
迁移范围；让 Server 的库、MCP、Skills 和实例文件继续散落在 Desktop 关联目录，又使部署和备份边界不清。
最终保持 Desktop 现状，独立 Server 使用 `~/.rovai-server`，一个 data-dir 决定所有自有持久位置。
该决定明确替代较早的 `~/.rovai/server` 建议，不做自动 Desktop 接管、数据同步或通用迁移平台。

两者使用共享 Rust 路径解析与存储实现。旧预览布局给出兼容提示，不能静默另起空库。独立 Server
管理令牌持久在自有根内以支持重启和程序更新；前述 D01 的进程内令牌规则继续适用于 Desktop，
不再限制独立 Server。Web Session 仍受进程代次和既有撤销规则约束。

正式部署采用 GitHub Releases 原生预编译包，程序与配套 WebUI 按安装归属更新。相较依赖源码构建或
容器作为前置，原生包降低用户部署依赖，并保留未来的分发渠道选择。代价是必须维护每个原生目标的
库基线、资产校验和安装验证，不能以共享代码或 CI 构建代替资格。Docker 完全移出本轮任务，不作为
可选阶段或 Mobile 前置；不另建 Node/Bun 服务端或独立业务后端。

<a id="v1-59-d03"></a>
## V1.59-D03：新对话默认队伍按 Host 归属

- 状态：accepted
- 日期：2026-09-13
- 当前权威：[Host Web v2](../../contracts/host-web-v2.md#shared-creation-preferences)、[Camp Activation](../../architecture/camp-activation-lifecycle.md#component-authority)

共享页面最初把整份通用设置当成浏览器展示偏好，导致同一 Host 的默认队伍和一键创建行为与 Desktop 分叉。
用户要求带入现有设置。选择由当前 Rust Core 保存这组创建偏好，Desktop 旧值只导入一次，保留其他展示偏好的客户端归属。
不采用重复复制浏览器 localStorage 或长期转发到 Electron Main：前者会继续产生冲突，后者使独立 Server 缺少同一持久入口。
代价是增加小型 Core 偏好记录及一次性导入边界；共享的是创建选择，不共享 Composer 草稿或不同实例的数据。

<a id="v1-59-d04"></a>
## V1.59-D04：Web HTML 附件使用共享查看器与不透明源沙箱

- 状态：accepted
- 日期：2026-09-13
- 当前权威：[统一 Host 的用户文件](../../architecture/unified-rust-host.md#草稿与用户文件)、[Host Web v2](../../contracts/host-web-v2.md)、[文件查看器](../../ui/components/file-preview.md)

用户指出浏览器把 HTML 附件打开为源码，要求恢复页面预览。取消首版一律按文本处理 HTML 的边界，
继续复用正式 Viewer 和诊断/查找通道。采用认证读取后向无凭据静态 shell 交付文档，浏览器原生 sandbox
隔离页面脚本与主应用存储；Rust 仍拥有文件读取、编辑归属与代次校验，不增加 Node 或另一个业务后端。

不把附件作为可访问 Session 存储的主应用同源页面执行。本轮也不为每份 HTML 增加远程可达的独立端口或预览代理；
静态 shell 没有文件读取凭据，不扩大 Host 的公开资源能力。代价是 Web 当前只支持单文件 HTML 和 HTTP(S)
依赖，本地多文件站点资源仍是实现缺口；Desktop 的既有不同源站点能力保持，不能据此宣称两端全部 HTML 能力相同。

<a id="v1-59-d05"></a>
## V1.59-D05：长期登录 Token 与可续期普通 Session

- 状态：accepted
- 日期：2026-09-14
- 当前权威：[统一 Host 身份与控制面](../../architecture/unified-rust-host.md#身份与控制面)、[Host Web v2](../../contracts/host-web-v2.md#session-lifetime-and-renewal)、[Host Lifecycle v2](../../contracts/host-lifecycle-v2.md)

用户明确要求正常浏览器重开、Host 重启及升级后保持登录，而 30 分钟内存 Session 与只存标签页的认证无法满足。
选择长期可重复登录 Token、默认 30 天普通 Bearer 和剩余 7 天内延期；仅延长到期时间，保留原编辑身份。
扫码仍兑换相同普通 Session。此决定替代 D01/D02 中进程内 Token、短期 Session 与重启撤销的限制。

不采用保存管理 Token 自动重登、双 Token 或 OAuth；这些方案分别扩大浏览器长期管理权限或引入本轮不需要的身份体系。
代价是两端持久化、撤销提交与跨标签页竞争需要明确处理。浏览器持久认证只用于认证恢复，新标签页仍由 Host 分配
新编辑身份；认证持久化不授权共享、合并或恢复其他标签页的草稿。撤销范围、故障与时间语义归当前协议拥有。

<a id="v1-59-d06"></a>

## V1.59-D06：Linux GNU 发布基线与两类资格独立

- 状态：accepted
- 日期：2026-09-14
- 当前权威：[统一 Host](../../architecture/unified-rust-host.md#命令事件与兼容性)、[平台准入](../../contracts/runtime-platform-admission-v2.md)、[Server 验收](../../development/server-preview.md#linux-的两个验收-gate)

Ubuntu 24.04 构建得到的 GLIBC_2.39 依赖排除了 Debian 12 和 Ubuntu 22.04 VPS。首发改用 Ubuntu 22.04
原生构建，以 glibc 2.35 为兼容基线，通过 ABI 检查及同一归档的跨发行版实际运行约束后续依赖升级。
选择 GNU x86_64 覆盖现有 VPS；进一步降低到 Debian 11 或增加 musl/ARM64 会扩大平台维护面，本轮不采用。

Server OS 资格只拥有 Host 安装与生命周期；Runtime 资格继续按 Adapter 及版本独立推进。
首批 Codex CLI、Claude Code 允许 preview 实测，保留缺失证据状态；其他 Runtime 的上游探测不自动晋升。
用户明确允许将既有 MiniMax key 配入本次测试账号的原生 BYOK 配置；不复制其他 Runtime Home、原生订阅或 Session，
也不把自定义 Provider 成功误报为官方订阅资格。真实机器资源不足时先停止测试，保留代理服务。
