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

交付为 Camp 附件中的单文件 `rovai-mobile.html`。消息、发布、文件和更新均为示例，不连接 Host，不改
已安装 App，不代表生产 Mobile 或实体手机验收。本地原型按[仓库规则](../README.md#本地原型)保持忽略，
当前文档与构建不依赖该目录存在。

## 风格与手机操作

采用 UI-UX-Pro-Max 的触摸、导航、键盘与焦点指导；视觉以 [DESIGN](../../DESIGN.md) 和正式
[theme.css](../../packages/ui/src/theme.css) 为准：Porcelain Day / Steel Night、完整 Rovai 标志、原生字体、
平面列表与轻分隔。创建按钮沿用日间黑色、夜间浅色的会话主操作 token。

根页面使用五个带文字的底部入口：对话、队员、记忆、定时、设置。详情页一个返回按钮，返回恢复阅读位置；
设置首页品牌在顶部，没有桌面的折叠、后退、前进三按钮。进入对话后移除全局底栏，把空间留给输入。
对话内通过“对话 / 执行 / 任务 / 文件”切换；队员、接收对象和次要操作通过底部面板进入。

发送区与保存操作位于底部；拍照、照片图库和文件选择分别可达；HTML 先展示可交互内容，源码作为次级
视图。消息操作显式可点，不依赖悬停或长按。产品触摸目标至少 44px，输入 16px，处理 safe area 与可视
视口变化，提供可见焦点和减少动效。真实软键盘、系统相机和后台恢复仍需设备验收。

## 功能对照

| 当前业务 | 手机交互稿 | 生产继续复用 |
| --- | --- | --- |
| 对话与项目 | 置顶、项目、快速对话、搜索、新建、Host 目录选择；默认队伍与一键创建 | CampNavigation、NewConversationDialog、GeneralSettings |
| 消息与 Composer | 正文、引用、附件、接收对象、发送；不消费发送期间后来输入 | CampWorkspace、Composer 与既有草稿/命令机制 |
| 私聊 | 从当前队员进入独立私聊，与公共对话分别保留草稿 | SingleChatPanel |
| 执行与审批 | 当前指令、分组、Compact、完整输出、停止、审批选项 | ExecutionToolGroup、RunningText、执行窗口、审批 Dock |
| 任务 | 对话内列表、详情、负责人、状态与验收要求编辑 | 现有 Task 列表与详情 |
| 附件 | HTML 预览/源码、Markdown/文本、引用与下载 | 共享 FilePreview / Viewer 与浏览器资源适配 |
| 队员 | 身份、职责、Runtime、模型、推理强度、权限、能力关联 | MemberManagement、MemberRuntimeParameters |
| 记忆 | 共同/队员/队员间、归属、审核、修订、停止沿用、恢复与遗忘 | MemoryLibrary |
| 定时任务 | 开关、指令、时间、时区、Cron、队伍、目录与结果 | AutomationWorkspace、AutomationEditor |
| 应用设置 | 通用、默认队伍、外观、提醒、远程连接；退出只在远程连接 | 共享正式设置与浏览器适配 |
| 能力与支持 | Skills、MCP、Runtime、监控、诊断、关于 | 共享管理页；原生操作按 Host 能力适配 |

Runtime/Skills/MCP 选项和部分配置反馈只展示表单组织；文件选择只保留示例元数据，不证明真实配置、上传、
裁剪或执行成功。实施时继续挂载现有 React 业务页和注入接口，不能把单文件的本地状态复制成第三套业务实现。
Host 操作系统与手机平台分别处理；手机文件选择不能选择 Host 程序。

## 执行态同步

遵循 [Run Process Detail Surface v34](../contracts/run-process-detail-surface-v34.md)：运行中收起的组展示
当前指令与对应类型图标，等待保留等待语义；状态在最右，文字后常显可展开提示，触摸区至少 44px。
完成组只统计成功步骤，Compact 不计数，未知结果不伪造成功。

收起且运行的组与 Compact 使用 2.4 秒一轮的静止文字高亮，展开后和终态静态，减少动效时关闭高亮。
组先展开摘要，再按需展开完整输出。展开、收起和异步结果到达后保留 summary 的阅读位置；主动滚动解除
锚点，“回到最新”查看末尾。稿中延迟只是示例，生产沿用共享阅读锚点与缓存机制。

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

sessionStorage 保存当前标签页示例编辑；覆盖 Camp/私聊分别保存、刷新恢复、离线禁发和过期重登。
示例登录只检查 64 位长度，不保存输入。生产继续使用既有 Bearer、一次性扫码票据与编辑归属机制，
不在 Mobile 新建账号系统或跨端草稿同步。

[验证记录](../versions/v1.59/evidence/mobile-review/validation.json)区分本地示例与真实 Host；截图包括
360–430px、844px 横屏、桌面评审画布和两套主题。它不替代后端幂等、归属、双设备、复制标签独立、
审批一致性、实体 iOS Safari / Android Chrome、软键盘、相机与网络切换验收。
