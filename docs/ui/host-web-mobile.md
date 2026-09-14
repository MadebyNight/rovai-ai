---
document_type: ui-interaction-draft
authority: host-web-mobile-interaction-proposal
status: implemented
target_version: v1.59
last_updated: 2026-09-14
---

# Mobile WebUI

2026-09-14 用户确认交互稿并授权实施，补充蓝色新动态点位于会话标题左侧、定时任务完整六种计划与手机日期选择。
实际 `apps/web` 入口现已提供手机工作台，继续挂载共享 `BusinessApp`、Camp、Composer 和正式管理页；
没有复制交互稿的本地业务状态，也没有增加 Host、账号系统或移动专用业务后台。网络与归属仍遵循
[Host Web v2](../contracts/host-web-v2.md)，领域操作继续由同一个 Rust Host / Core 处理。

本文记录已实施的页面适配与验证边界。此前四轮单文件 HTML 为评审历史，仍通过 Camp 附件取得，
[旧示例证据](../versions/v1.59/evidence/mobile-review/validation.json)不证明生产能力；本地原型继续按
[仓库规则](../README.md#本地原型)忽略，产品构建不依赖 `docs/prototypes/`。

## 入口与视觉

浏览器宽度小于 768px 时启用手机布局；触摸设备横屏宽度不超过 1039px、高度不超过 560px 时保持手机操作。
768–1039px 的其他浏览器窗口沿用共享紧凑布局，更宽时沿用宽屏 Web。原生 Desktop 不启用手机布局。
`MobileLayout` 仅提供展示上下文，Host 能力与浏览器设备平台仍由显式依赖区分。

沿用 UI-UX-Pro-Max 的触摸和响应式指导，以 [DESIGN](../../DESIGN.md) 与共享主题为视觉依据。
根据用户要求，手机主要阅读面为白 / 黑，身份、状态、证据和控件继续使用语义 token；蓝色新动态点使用 `--info`。
普通主按钮使用共享中性操作色（日间黑色、夜间反白），包含“使用此目录”；蓝色保留给状态与链接。
Web / Mobile 浏览器页签统一为 `Rovai AI`。远程连接中的“退出登录”保持单行，不拉伸字距。
普通页面仅保留标题与操作，登录和关于页保留品牌。根页面提供“对话、队员、记忆、定时、设置”五个底部入口，
进入对话后隐藏底栏。设置不显示 Desktop 的折叠、后退、前进三按钮。

主要触摸入口至少 44px，编辑输入不小于 16px；处理安全区和可视视口变化，缩放不重写工作台高度。
日期、时间和业务弹窗在可视范围内滚动。移除焦点专用黑框、描边和光晕，保留 DOM 焦点、键盘操作、
控件静态边界与选中状态。日夜主题、减少动效继续复用原组件，不分叉业务。

## 对话与执行

对话列表连续排列，44px 行高、14px 标题，无行间分隔、额外空行或“今天 / 昨天”分组；蓝点在标题左侧。
根标题旁提供打开项目、搜索、无底色圆圈加号；项目使用现有圆角开合文件夹与普通加号。
搜索点开后进入共享搜索器。沿用 CampNavigation 的读取与分页状态：手机初始 5 个、每次增加 5 个、收起回到 5 个；
Desktop 保留初始 5 个、每次增加 10 个。此前交互稿将两端增量均称作现状 5 个的表述已修正。

新建对话复用正式默认队伍、带头像的负责人选择、折叠可选名称和“一键新建”开关。
“对话 / 执行 / 任务”是当前对话内的展示切换，不增加返回历史；标题返回始终退出到列表。
手机执行标签使用蓝色执行中图标；与宽屏共用 `runningCampMembers`，仅在确有运行中且未请求停止的 Run 时提示。
宽屏 Web 复用 Desktop 的运行头像与双弧入口，呈现规则由
[Camp 详情浮层](components/conversation-workspace.md#camp-详情浮层)拥有。
此前手机双弧仅为本地 HTML 提案；按后续反馈，正式手机不采用彩环，执行图标遵循减少动效设置。
打开附件时标题返回先收起预览，回到当前对话；文件预览使用整个手机阅读区域。
不新增“所有会话文件”Tab，附件仍来自消息、显式文件引用和现有 File Change。

用户消息靠右，队员消息保留姓名与 Runtime 标签。公共 Composer 保留文件选择，在右侧增加 @ 入口；
仍使用结构化 Mention 和既有默认接收计算。手机 Return 换行，发送按钮提交；Desktop 的 Enter 行为不变。
空白输入提示与编辑正文使用相同的 12px 内边距及字号，避免提示与光标错位。
私聊使用同一正式面板和独立草稿，打开时仅展示私聊输入框。文件、引用、上传、发送及未知结果恢复继续使用既有接口。
文件入口调用浏览器原生选择器，图库、拍照是否可选由设备提供，当前没有增加自定义相机流程。

审批仍在对话页，定位审批会先收起执行/私聊面板。Mobile 不展示会话地图、通知铃铛或对话内 Runtime 管理；
队伍面板保留邀请和身份/状态信息，私聊由标题入口打开。任务新建沿用标题、说明、验收条件与负责人，
状态只在编辑已有任务时出现。不会以界面隐藏替代 Host 的校验。

执行区复用 `ExecutionAvatarRail`、连续 Run、`ExecutionToolGroup`、`ExecutionStatusGlyph` 与 `RunningText`。
头像自动多行，无横向滑条；历史 Run 压缩为摘要，当前 Run 默认展开，每个 Run 可独立开合。
保留“正文 → command 组 → 正文”、当前命令的类型图标和收起时高亮、展开后的完整输出。
手机时间线节点与 44px Run 摘要居中对齐；Web 网络客户端允许共享执行窗口使用 `agentRunExecution.changes`
读取增量，Web / Mobile 发起的 Run 同样实时呈现 command，无需等待最终结果或重开执行页。
停止仍只作用于所选队员当前 Run。Run 与组的展开状态写入现有标签页编辑恢复存储，按 Camp/队员/Run 区分；
切换队员保留展开状态，存储不可用不阻塞编辑。共享阅读锚点补充手机 Run summary，“回到最新”仍为圆形向下入口。

## 共享管理页

| 页面 | 手机适配 | 保留的正式业务 |
| --- | --- | --- |
| 队员 | 名册与详情分屏，返回名册，Runtime 页内编辑与带图标选择 | MemberManagement、MemberRuntimeParameters；无队员 Skills/MCP 入口 |
| 记忆 | 默认停留列表、点选详情、返回列表；正文前提供治理操作，版本记录按需展开 | MemoryLibrary 的归属、审核、修订与生命周期 |
| 定时 | 列表/编辑器单屏，月历与时间底部面板 | AutomationWorkspace / AutomationEditor 的六种计划、单一执行队员与运行记录 |
| 外观 | 两端 A 的字号滑条和可点击逐档按钮，无“显示与动效” | 原有字号范围、偏好保存、失败反馈和两套主题 |
| 通用与能力 | 单列滚动共享设置，远程连接位于能力分组、渠道上方 | 默认队伍、Skills 生效组、MCP、Runtime、监控和诊断 |

定时任务类型与 Desktop 完全一致：**每天、工作日、每周、仅一次、自定义 Cron、手动触发**。
月历保留月份切换与键盘日期导航，每日触摸区至少 44px；时间使用小时/分钟加减、直接输入与快捷时间，分钟步进 5 分钟。
手机使用 Radix Dialog 底部面板包裹现有字段，Desktop 保留 Radix Popover。日期、时间、时区、Cron 校验与
650ms 自动保存/离开前 flush 均沿用生产逻辑。每项计划只选择一名执行队员，不创建“执行队伍”。

## 部署与恢复

| 能力 | Desktop 托管的手机 WebUI | 独立 Server 手机 WebUI |
| --- | --- | --- |
| 对话、执行和共享管理 | 当前 Host 授权能力 | 当前 Host 授权能力 |
| 渠道 | 正式管理页；使用宿主登录态发布、重试与结构化选择 | 隐藏，遗留入口明确不支持 |
| 连接/切换/重新登录渠道 | 指向运行服务的那台 Rovai Desktop | 不提供导入或替代路径 |
| 关于 | 真实版本与 Desktop 标识，无更新入口 | 真实版本与 Server 标识，提供原生安装/更新说明入口 |
| Web 退出 | 只退出当前会话，不停止 Host、渠道或任务 | 只退出当前会话，不停止 Host 或任务 |

Server 更新入口指向现有[原生安装与更新流程](../development/server-preview.md#安装和启动)。当前没有 Web 下载、
安装或重启 API，前稿的自动更新模拟状态没有进入产品。原生发布渠道仍以该开发文档记录为准，不据此宣称正式资产已发布。

刷新、同 Owner 重新登录继续使用同一 Bearer Session、标签页身份租约和独立草稿恢复。
认证独立持久化到浏览器 IndexedDB；30 天寿命、7 天续期与浏览器重开的编辑隔离复用 [Host Web v2](../contracts/host-web-v2.md#session-lifetime-and-renewal)，手机不另建认证流程。
登录过期复用普通登录页与现有 toast；手机布局不生成新的认证或草稿身份，不改变扫码票据、撤销与幂等命令机制。

## 验证

生产入口验证见 [Mobile 自动验收](../versions/v1.59/evidence/mobile-production/validation.json)，
[执行组件验证](../versions/v1.59/evidence/mobile-production/execution-validation.json)和
[独立 Server 验证](../versions/v1.59/evidence/mobile-production/server-validation.json)。

`pnpm build:web` 后运行 `pnpm test:host-web-mobile`；需要本机已构建的 `rovai-host`、`rovai-server` 和 macOS Chrome。
`ROVAI_MOBILE_OUTPUT=<绝对路径>` 可保留截图与 JSON。测试使用隔离数据根、Skill Library、MCP config 和浏览器目录，
日志记录绝对位置，不使用日常 App 数据，也不启动真实 Runtime。

真实 Host 用例覆盖登录、列表 5 → 10 → 11 → 5、切换/返回/刷新草稿、附件预览、Return、@、共享管理和六种计划。
多队员连续 Run、命令内容和高亮来自共享生产组件 fixture，明确标记模拟证据，不冒充真实模型执行。
独立 Server 用例通过真实启动验证渠道隐藏、真实版本和仅 Server 可见的原生更新入口。
截图覆盖 360/390/430px、触摸横屏 844px 与日夜主题；它们是 macOS Chrome 模拟，**不等于实体手机验收**。
实体 iOS Safari / Android Chrome 的软键盘、图库/相机、后台恢复与移动网络切换，以及第二实体设备联调仍待完成。
