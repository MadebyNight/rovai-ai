---
document_type: ui-interaction-draft
authority: host-web-mobile-interaction-proposal
status: draft
target_version: v1.59
last_updated: 2026-09-14
---

# Mobile WebUI 交互稿

按 2026-09-14 用户要求恢复第五阶段交互稿，并同步 main `6c556883` 的执行态变化。源码基线为统一 Host
分支合并提交 `59249423`；对照已经具备发送、编辑、执行和管理能力的正式 WebUI，当前网络合同见
[Host Web v2](../contracts/host-web-v2.md)。早期只读稿不再代表本稿范围。

第二稿按用户的 25 项反馈收敛；“远程连接”分组同步修改共享生产导航，其余为 Mobile 交互稿。
交付为 Camp 附件中的单文件 `rovai-mobile.html`。消息、发布、文件和更新均为示例，不连接 Host，不改
已安装 App，不代表生产 Mobile 或实体手机验收。本地原型按[仓库规则](../README.md#本地原型)保持忽略，
当前文档与构建不依赖该目录存在。

## 风格与手机操作

采用 UI-UX-Pro-Max 的触摸、导航、键盘与焦点指导；视觉以 [DESIGN](../../DESIGN.md) 和正式
[theme.css](../../packages/ui/src/theme.css) 为准：Porcelain Day / Steel Night、完整 Rovai 标志、原生字体、
平面列表与轻分隔。按本轮明确要求，Mobile 页面阅读面使用白 / 黑背景；其余品牌、身份、证据与控件继续
使用既有语义 token。此处不改变 Desktop 主题。创建按钮沿用日间黑色、夜间浅色的会话主操作 token。

根页面使用五个带文字的底部入口：对话、队员、记忆、定时、设置。详情页一个返回按钮，返回恢复阅读位置；
设置首页品牌在顶部，没有桌面的折叠、后退、前进三按钮。进入对话后移除全局底栏，把空间留给输入。
对话内通过“对话 / 执行 / 任务”切换，不把 Tab 切换压入返回历史；标题返回始终退出到对话列表。
项目打开和搜索收为标题旁的小图标，搜索点开后才显示输入框；会话行只保留较小标题、时间与蓝色新动态点。

发送区与保存操作位于底部；拍照、照片图库和文件选择分别可达，文件添加面板没有“引用当前附件”。
不设置独立接收者按钮和发送旁的更多菜单；文件右侧提供 @ 入口，默认接收提示沿用生产 Composer。
用户消息靠右，队员消息靠左。消息菜单保留显式“引用回复”，不模拟手机系统选区的部分引用。
HTML 先展示可交互内容，源码作为次级
视图。消息操作显式可点，不依赖悬停或长按。产品触摸目标至少 44px，输入 16px，处理 safe area 与可视
视口变化，提供可见焦点和减少动效。真实软键盘、系统相机和后台恢复仍需设备验收。

## 功能对照

| 当前业务 | 手机交互稿 | 生产继续复用 |
| --- | --- | --- |
| 对话与项目 | 置顶、项目、快速对话、按需搜索、Host 目录选择；默认队伍、带头像的队长、折叠可选名称和一键创建开关 | CampNavigation、NewConversationDialog、GeneralSettings |
| 消息与 Composer | 正文、引用、附件、@、默认接收提示、发送；不消费发送期间后来输入 | CampWorkspace、Composer 与既有草稿/命令机制 |
| 私聊 | 从当前队员进入独立私聊，与公共对话分别保留草稿 | SingleChatPanel |
| 执行与审批 | 各队员独立状态、当前指令、分组、Compact、完整输出和停止；审批在对话页处理 | ExecutionToolGroup、RunningText、执行窗口、审批 Dock |
| 任务 | 对话内列表、详情、负责人、状态与验收要求编辑 | 现有 Task 列表与详情 |
| 附件 | HTML 预览/源码、Markdown/文本、引用与下载 | 共享 FilePreview / Viewer 与浏览器资源适配 |
| 队员 | 身份、职责；页内 Runtime、模型、推理强度、权限，运行时选择带正式图标；无 Skills/MCP 配置入口 | MemberManagement、MemberRuntimeParameters |
| 记忆 | 共同/队员/队员间、归属、审核、修订、停止沿用、恢复与遗忘 | MemoryLibrary |
| 定时任务 | 开关、指令、时间、时区、Cron、队伍、目录与结果 | AutomationWorkspace、AutomationEditor |
| 应用设置 | 通用、默认队伍、外观、提醒；字号使用两端 A 的滑条，无“显示与动效” | 共享正式设置与浏览器适配 |
| 能力与支持 | Skills 生效组、MCP、Runtime、远程连接（渠道上方）、监控、诊断、关于；退出只在远程连接 | 共享管理页；原生操作按 Host 能力适配 |

新建对话中的一键创建选择仅在创建成功后保存队伍与开关，取消不改变偏好；目录和名称不作为默认值。
通用设置和新建弹窗的队长选择都带头像。队员身份与运行时切换保留页内未保存编辑。
对话内队伍面板保留私聊和“+ 邀请”，不提供运行时管理；Mobile 不展示会话地图或全局通知铃铛。

字号交互参考 [Apple 的文字大小滑条](https://support.apple.com/en-za/guide/iphone/iphd6804774e/ios)和
[Android 的字号与预览](https://support.google.com/accessibility/answer/11183305?hl=en)。原生 range 保留键盘操作，
两端 A 也可逐档点击，避免只能拖动；字号在示例标签页中保存并即时预览。

## 文件与发送的生产核对

当前 `FilePreviewPane` / `file-preview-session` 管理从消息附件、显式文件链接和 File Change 打开的预览 Tabs；
它们不是整个 Camp 全部附件的自动汇总接口。`CampWorkspace` 的附件列表按消息读取。因此本稿删除虚构的
“对话全部文件”Tab，通过消息附件直接进入全文预览，预览与源码切换后返回仍回到对话。
当前边界见 [Camp 文件预览区](components/file-preview.md)。

默认接收提示对照 `CampWorkspace.composerRecipientSummary`：没有显式队员 / 全体 Mention 时显示默认队长；
已有显式 Mention 时不再显示默认提示。生产发送的 Reply、Continuation 和最终接收对象继续由既有 Composer / Core
计算。本稿仅示意输入和提示，不能用文本匹配代码替换生产结构化 Mention 与路由机制。

Runtime/Skills/MCP 选项和部分配置反馈只展示表单组织；文件选择只保留示例元数据，不证明真实配置、上传、
裁剪或执行成功。实施时继续挂载现有 React 业务页和注入接口，不能把单文件的本地状态复制成第三套业务实现。
Host 操作系统与手机平台分别处理；手机文件选择不能选择 Host 程序。

## 执行态同步

遵循 [Run Process Detail Surface v34](../contracts/run-process-detail-surface-v34.md)：运行中收起的组展示
当前指令与对应类型图标，等待保留等待语义；状态在最右，文字后常显可展开提示，触摸区至少 44px。
完成组只统计成功步骤，Compact 不计数，未知结果不伪造成功。

收起且运行的组与 Compact 使用 2.4 秒一轮的静止文字高亮，展开后和终态静态，减少动效时关闭高亮。
组先展开摘要，再按需展开完整输出。展开、收起和异步结果到达后保留 summary 的阅读位置；主动滚动解除
锚点；“回到最新”沿用圆形向下图标。执行台按队员切换等待、运行、完成、停止与暂无执行，停止只影响所选
队员；等待权限的执行引导回对话，权限表单不在执行 Tab 打开。稿中延迟只是示例，生产沿用共享阅读锚点与缓存机制。

## 两种部署

| 入口 | Desktop 托管的 Mobile WebUI | 独立 Server Mobile WebUI |
| --- | --- | --- |
| 对话、执行和共享管理 | 对应 WebUI 能力 | 对应 WebUI 能力 |
| 渠道 | 查看账号/Bot/连接，使用宿主登录态发布、重试、选择审批人 | 隐藏；旧入口明确不支持 |
| 渠道连接/切换/重新登录 | 指向运行此服务的 Rovai Desktop，一般网络失败仍可在此重试 | 无导入或替代接入 |
| 关于与更新 | 只有“关于”，不显示更新 | 显示“关于与更新” |
| 退出 Web 登录 | 只退出当前标签页，不停止 Host、渠道或任务 | 只退出当前标签页，不停止 Host 或任务 |

独立 Server 提示统一为：“独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。”
Bot 发布、当前在线与账号登录态分别展示，连接未知不伪造在线。

**Server 更新面板是新增交互提案，当前生产 Web 更新接口尚未接通。** 示例覆盖检查、发现版本、下载、
活动执行阻止安装、空闲确认重启、等待重连和完成。后续需接现有 Server 安装/更新能力并验证失败恢复；
不能因稿中有入口宣称 API 已交付。Desktop 托管页完全没有更新操作。

## 恢复与验证边界

sessionStorage 保存当前标签页示例编辑；覆盖 Camp/私聊分别保存、刷新恢复、离线禁发和过期登录恢复。
登录失效直接复用普通登录页，仅给一次“登录已过期” toast，不建立另一份“重新登录”页面。
示例登录只检查 64 位长度，不保存输入。生产继续使用既有 Bearer、一次性扫码票据与编辑归属机制，
不在 Mobile 新建账号系统或跨端草稿同步。

[验证记录](../versions/v1.59/evidence/mobile-review/validation.json)区分本地示例与真实 Host；截图包括
360–430px、844px 横屏、桌面评审画布和两套主题。它不替代后端幂等、归属、双设备、复制标签独立、
审批一致性、实体 iOS Safari / Android Chrome、软键盘、相机与网络切换验收。
