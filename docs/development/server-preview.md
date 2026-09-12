---
document_type: development-guide
authority: standalone-server-preview-operation
last_updated: 2026-09-13
---

# 独立 Server 开发预览

这是开发预览：提供同一个 Rust Host 的本机启动、显式 Web 开关和共享生产 Camp 页面。
当前已接通独立草稿、四种 source 上传目标、执行审批、单聊和正式管理页，Automation 由 Rust Host 驱动。
macOS 上的 Desktop/Headless 真实执行及浏览器管理操作已有证据；第二实体设备与其他平台仍分别验收。每个检查点的实际证据见[当前实施计划](../versions/v1.59/implementation-plan.md)。
该包不是正式发布资格证明。当前产品为单 Owner、可信自托管 Host，不承诺同 UID 强隔离；
历史哨兵失败保留，但不再作为本轮交付前置。

## 构建与包内容

在目标 OS/CPU 的原生机器上运行 `pnpm build:server`；本地快速验证可加 `--debug`。
构建依赖 Rust、Node 与 pnpm；包内只有 `rovai-host`、Agent `rovai` CLI、`web-ui/`、许可证及
SHA-256 manifest。运行 Host 本身不依赖 Electron、Node 或 pnpm；Runtime 自身依赖另行配置。
包输出在 `out/server/<target>/`，不能从同名目录推断平台通过。

当前 Windows x64 原生产物动态导入 `VCRUNTIME140.dll`。目标机器需要与构建工具兼容的 x64
Visual C++ v14 Runtime，获取方式见 [Microsoft 官方说明](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)。
CI 镜像已安装开发工具，不能据此推断干净 Windows 机器无需该依赖；当前包不自动安装系统组件。
当前 Linux x64 GNU 产物包含 `GLIBC_2.39` 符号依赖，仅在 Ubuntu 24.04 原生环境验证过启动链路。
它不适用于更低 glibc 或 musl/Alpine 环境；容器和其他发行版仍需独立构建与验收。

原生构建目标为 macOS arm64/x64、Windows x64、Linux x64。Linux 当前 Runtime 行保持
`not_qualified`；只有该 Adapter 的真实执行证据才可晋升。没有增加 Linux Desktop 或系统服务安装器。
`Full check` 的 `scope=server` 使用固定 OS runner 构建并测试四个产物；Windows console 受控关闭与
真实模型/工作区/恢复仍是独立资格，不由编译或有限进程测试推导。
原生复核可以用 `server_target` 只选择发生变更的目标；默认 `all` 才运行全部四个目标，单目标通过
不能写成三平台通过。

## 显式初始化

先为该 Host 选择独立绝对路径，禁止使用日常 Desktop 数据目录或其他运行中 Host 的目录。
从包目录运行 `./rovai-host prepare --data-dir <绝对目录>`（Windows 可执行文件为 `rovai-host.exe`）。
此命令要求父目录已存在、目标目录尚不存在，只创建私有目录并打印四个路径与 `runArguments`；
不创建数据库、不迁移、不启动 Runtime，也不修复或更改已有目录。准备输出不含令牌。

把输出路径传入以下参数。`--initialize` 只允许 Core 初始化已确认不存在的 authority；以后启动可去掉。

```text
rovai-host run --data-dir <dataDir> --skill-library-root <skillLibraryRoot>
  --mcp-config-path <mcpConfigPath> --runtime-camp-files-root <runtimeCampFilesRoot>
  --initialize --web-listen 127.0.0.1:4317 --web-ui <包内web-ui的绝对路径>
  --web-token-stdin
```

参数须在同一条命令中传入。管理令牌由 `rovai-host token` 生成，是 64 位十六进制的 256-bit 随机值。
启动命令从 stdin 读取一行；请通过操作系统提供的安全输入方式或受保护文件重定向传入，保留一份供
登录使用。不要把令牌写在命令参数、环境变量、URL、聊天或日志中。`token` 的 stdout 是秘密输出，
不应接入普通日志采集。重新启动时可换用新令牌；旧页面 Session 不跨进程存活。

管理者在控制台输入管理令牌后交换半小时 Session；页面刷新需要再次登录。当前页面只向固定控制台
地址发送显式 Authorization，不使用认证 Cookie。应将完整控制台地址交给客户端，不能通过预览端口登录。
登录后的单一 Owner 可以在浏览器选择 Host 有权访问的工作目录，无须目录预授权。同页面重新登录保留当前编辑；完整刷新会创建新编辑身份，尚无跨页面草稿恢复服务。
Web 与 Host 必须使用同一协议版本，当前为 [Host Web v2](../contracts/host-web-v2.md)。

## 网络与停止

默认推荐 loopback。局域网监听显式设置 `--allow-insecure-lan`，Host 自动发现实际网络接口。
反向代理可补充 `--web-public-origin https://<代理地址>`；不要求唯一手填 LAN 地址。地址发现排除 198.18.0.0/15，
不提供展示、复制或扫码；网络层不主动封禁。明文网络可能暴露令牌和内容；不可信网络使用
外部 HTTPS 或可信 VPN。本实现不创建域名、证书或预览代理，不信任任意代理转发头。

Unix 用 SIGINT/SIGTERM；Windows 用 console Ctrl-C/Ctrl-Break。停止沿用 Core protocol 3；只有 durable
收口完成才以 0 退出。强杀不构成执行完成，下一次启动由 Core 恢复。两个 Host 不得共用数据目录。

Desktop「设置 → 远程连接」控制当前 Host，Web 默认关闭。关闭 Web 只撤销网络会话与订阅，
当前 Core 和任务继续；重启 Desktop 后默认关闭。开发 Desktop 开启前运行 `pnpm build:web`，打包时则
随包携带同一 WebUI 构建产物。

## 首个真实 Camp 复验

使用源码构建产物进行自动验收，不启动日常 App：

```bash
cargo build -p rovai-host -p rovai-core --bin rovai-host --bin rovai
pnpm build:desktop
ROVAI_REQUIRE_ELECTRON_INTEGRATION=1 pnpm test:host-web-live
pnpm smoke:host-web-runtime
```

两条验收命令目前在 macOS 使用独立 Chrome profile；`ROVAI_REVIEW_CHROME` 可指定 Chrome 可执行文件。
第一条启动隔离 Electron，与实际浏览器对照同一 Camp、日夜主题和三个客户端草稿，不调用模型。
`ROVAI_KEEP_HOST_WEB_LIVE_FIXTURE=1` 保留其截图与隔离目录。

第二条会调用本机已认证的 Codex，在空目录初始化的独立 Host 中，通过正式浏览器页面检查 Runtime、配置队员并创建 Camp，
随后从正式浏览器页面上传、发送、选择 Host 提供的一次审批、阅读产物与停止另一个运行。
只审批脚本中精确限定的夹具发布命令，不修改用户级 Runtime 权限。命令打印隔离路径并保留脱敏报告和截图；
原始目录可能包含 Runtime 会话材料，不得整体上传。它不证明其他 Runtime、其他平台或同 UID 强隔离。设置 `ROVAI_HOST_ENTRY=desktop` 运行同一真实流程，
并验证执行中关闭 Web、重新登录后继续停止运行。`ROVAI_HOST_BIN` 和 `ROVAI_WEB_UI` 可以指向匹配的独立包。

## Mac 包与回退演练

本机当前验收为 macOS 26.3 / arm64，Codex CLI 0.153.4；不代表 Intel Mac 或最低 OS 版本实测。
包内 Mach-O 声明最低 macOS 11.0，仅依赖 Apple 系统库；ad-hoc 签名通过不等于 Developer ID 签名或公证。

`node scripts/smoke-server-package.mjs <新包目录> <旧包目录>` 校验两个 manifest，把包复制到仓库外的
一次性目录，以不含 Node/pnpm 的 PATH 启动 Host、验证旧数据库升级后的浏览器读取，再用停机备份回退。
测试仅创建本地记录，不调用模型。旧包必须是有独立 manifest 的实际支持来源；不能拿当前包改版本号充当升级。
原始夹具和报告保留在脚本打印的位置，可能包含私有状态，不整体公开上传。

实际升级前先停止唯一 Host，保留旧包并备份完整 data-dir、Skill Library、MCP 配置及
`prepare` 输出的 Runtime 文件根目录；备份时不能有正在写入的 Runtime。用户附件仍是 source reference，
源文件需要独立保留。旧 Runtime 视图目录可能只有遍历权限，普通递归复制会失败；备份工具必须报告失败，
不能把不完整目录当成成功。演练脚本只在自身创建的停机夹具里暂补目录读取权限，复制后恢复原权限。

回退恢复旧包及同一停机点的完整备份，保留原数据根目录和 Runtime 文件根目录本身，在原位置恢复内容。
Runtime marker 绑定目录身份，直接替换根目录会按合同拒绝启动。先保留升级后的完整状态，再执行回退；
不要让旧包直接读取已升级数据库，不修改 schema/receipt，也不重新初始化来绕过失败。
本轮演练不涵盖跨机器迁移、运行中备份或任意备份工具，不新增系统服务安装器。
