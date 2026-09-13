---
document_type: development-guide
authority: standalone-server-preview-operation
last_updated: 2026-09-13
---

# 原生 Server 安装与开发验收

这是尚未正式发布的原生 Server 链路，提供同一个 Rust Host 和共享生产 Camp 页面。
以下命令在取得匹配的预编译包并安装后使用；当前不宣称 GitHub 安装地址或正式版本已可下载。
当前已接通独立草稿、四种 source 上传目标、执行审批、单聊和正式管理页，Automation 由 Rust Host 驱动。
macOS 上的 Desktop/Headless 真实执行及浏览器管理操作已有证据；第二实体设备与其他平台仍分别验收。每个检查点的实际证据见[当前实施计划](../versions/v1.59/implementation-plan.md)。
该包不是正式发布资格证明。当前产品为单 Owner、可信自托管 Host，不承诺同 UID 强隔离；
历史哨兵失败保留，但不再作为本轮交付前置。

## 构建与包内容

在目标 OS/CPU 的原生机器上运行 `pnpm build:server`；本地快速验证可加 `--debug`。
构建依赖 Rust、Node 与 pnpm；包内包含 `rovai-server`、兼容入口 `rovai-host`、Agent `rovai` CLI、`web-ui/`、安装脚本、许可证及
SHA-256 manifest。运行 Host 本身不依赖 Electron、Node 或 pnpm；Runtime 自身依赖另行配置。
解包内容位于 `out/server/<target>/`；压缩包和 `SHA256SUMS` 位于 `out/server/releases/<target>/`，
不能从同名目录推断平台通过。源码构建属于开发流程，正式用户无需 clone、Rust 或前端工具链。

当前 Windows x64 原生产物动态导入 `VCRUNTIME140.dll`。目标机器需要与构建工具兼容的 x64
Visual C++ v14 Runtime，获取方式见 [Microsoft 官方说明](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170)。
CI 镜像已安装开发工具，不能据此推断干净 Windows 机器无需该依赖；当前包不自动安装系统组件。
当前 Linux x64 GNU 产物包含 `GLIBC_2.39` 符号依赖，仅在 Ubuntu 24.04 原生环境验证过启动链路。
它不适用于更低 glibc 或 musl 环境；其他发行版须独立验收。本轮不实现 Docker/Compose。

原生构建目标为 macOS arm64/x64、Windows x64、Linux x64。Linux 当前 Runtime 行保持
`not_qualified`；只有该 Adapter 的真实执行证据才可晋升。没有增加 Linux Desktop 或系统服务安装器。
`Full check` 的 `scope=server` 使用固定 OS runner 构建并测试四个产物；Windows console 受控关闭与
真实模型/工作区/恢复仍是独立资格，不由编译或有限进程测试推导。
原生复核可以用 `server_target` 只选择发生变更的目标；默认 `all` 才运行全部四个目标，单目标通过
不能写成三平台通过。main 上全部目标通过后可显式开启 `server_release_draft` 组装 GitHub draft Release；
它校验 source SHA、release profile、版本及平台一致，不自动公开发布或晋升默认安装指针。

## 安装和启动

程序与数据分开：Unix 安装器管理 `~/.local/share/rovai-server/revisions/`，以 `current` 原子链接选择程序，
命令入口为 `~/.local/bin/rovai-server`。Windows 安装到当前账号 LocalAppData 的 `Programs/RovaiServer/current`，
将其加入用户 PATH；更新前须先停止该安装的 Server，安装器不终止进程。两种安装都不建立系统服务。
安装器不会打开、迁移或重置业务数据，不会替换 Desktop 随包 Host。

取得原生压缩包及同一 Release 的 `SHA256SUMS` 后，可在已有脚本上执行本地安装（版本填写包的真实版本）：

```sh
sh scripts/install-server.sh --version <版本> --from-dir <发布资产目录>
```

Windows 对应 `install-server.ps1 -Version <版本> -FromDirectory <发布资产目录>`。脚本也包含在解包目录中。
Unix 默认配置 `.profile`、`.bashrc`、`.bash_profile`、`.zshrc` 的去重 PATH；Windows 配置用户 PATH。
安装器打印新终端和立即生效方法。自动验收使用隔离安装位置；Windows 测试不修改真实用户 PATH。

官方源固定为 GitHub Releases，Server tag 为 `server-v<版本>`。资产名为
`rovai-server-<版本>-<target>.tar.gz`（Unix）或 `.zip`（Windows），`SHA256SUMS` 每个资产恰好一项。
安装器先完整下载、校验 SHA-256，检查归档路径/类型和包内版本/目标，再切换入口；下载/校验失败保留旧安装。
默认版本由仓库 `scripts/server-channel.txt` 指定；目前为 `unpublished`，因此默认网络安装明确失败。
只有实际发布相应资产并晋升该指针后，才能把网络安装命令描述为可用。没有独立域名或下载服务。

安装完成后可在任意工作目录运行：

```sh
rovai-server
rovai-server --data-dir /data/rovai
rovai-server --data-dir /data/rovai token
```

Windows 同一个参数接口：`rovai-server.exe --data-dir "D:\RovaiData"`。`token` 的 stdout 是秘密，供登录使用，
不要接入日志采集。交互式终端启动成功后已直接显示当前 Token，可立即复制登录；展示不会轮换 Token。
非交互启动或 stdout 重定向不显示 Token，仍可用上面的 `token` 命令查询。凭据不会进入 Server 文件日志。
该私有令牌文件会随原数据根保留，浏览器 Session 仍按进程撤销。

启动摘要显示实际版本、就绪地址、访问范围、数据根与日志位置。默认前台运行，Ctrl-C 受控停止；
终端挂断也进入受控关闭。普通诊断写入 `<data-dir>/logs/server.log`，需要同时在终端排障时使用
`rovai-server --verbose`（自定义数据根仍传相同 `--data-dir`）。无刷屏不表示服务已转入后台。
独立 Server 的 Web 默认地址为 `http://127.0.0.1:8767`，配套 UI 从可执行文件真实目录定位，不依赖当前工作目录。

独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。
Desktop 设置中开启的 Web 服务属于该 Desktop 实例，可以管理已有账号的 Bot 发布、重试和结构化审批人选择；
它与独立 Server 不自动共享渠道配置或登录态。账号连接、切换和重新登录在运行服务的那台 Desktop 中完成。

不传内部路径参数：默认使用当前账号 `~/.rovai-server`，其中包括 `rovai.sqlite`、`mcp.json`、`skills/`、
`instances/<instance-key>/runtime-files/`、`logs/server.log` 及私有布局/令牌文件。自定义 `--data-dir` 后全部跟随，
不会默认写回 Desktop 的 `~/.rovai`。`rovai-server paths` 只读显示推导路径。
不存在的根由 Host 初始化；既有根复用原数据，同根第二个 Host 拒绝启动。改参数选择另一实例，不搬迁旧数据。

## 旧预览数据的兼容入口

以下仅供已经使用旧显式路径布局的实例，不是新用户的安装步骤。没有独立 Server 布局标识的既有数据库，
以及旧默认建议位置 `~/.rovai/server` 的数据，都会触发明确兼容提示，避免误开空实例。
继续使用原命令和完整关联路径；不要只复制 SQLite、手工伪造 marker 或修改身份校验来冒充迁移。
本轮不迁移 Desktop，不新增通用迁移向导。


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
新入口可用 `--listen 0.0.0.0:8767 --allow-insecure-lan`；
反向代理可补充 `--public-origin https://<代理地址>`（旧入口参数为 `--web-public-origin`）；不要求唯一手填 LAN 地址。地址发现排除 198.18.0.0/15，
不提供展示、复制或扫码；网络层不主动封禁。明文网络可能暴露令牌和内容；不可信网络使用
外部 HTTPS 或可信 VPN。本实现不创建域名、证书或预览代理，不信任任意代理转发头。

Unix 用 SIGINT/SIGTERM；Windows 用 console Ctrl-C/Ctrl-Break。停止沿用 Core protocol 3；只有 durable
收口完成才以 0 退出。强杀不构成执行完成，下一次启动由 Core 恢复。两个 Host 不得共用数据目录。

Desktop「设置 → 远程连接」控制当前 Host，Web 默认关闭，端口默认 `8766`；独立 Server 默认 `8767`，允许两者在同一电脑使用独立数据根并行运行。手动设置端口或传入 `--listen` 时以显式值为准。关闭 Web 只撤销网络会话与订阅，
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

## 更新、备份与既有 Mac 包演练

新入口更新时重新运行同一安装器，替换匹配程序与 UI，仍用原 `--data-dir` 启动。自定义数据根不会被安装器改写。
WebUI 检查/更新并重启、`rovai-server upgrade` 仍是后续便利入口，当前尚不可用；不宣称无损热升级或自动回滚。
停机备份新布局时保留整个数据根及其权限、目录身份要求；源附件、用户项目与 Agent CLI 原生认证/会话独立保留。
恢复前保留当前数据，不让旧程序直接打开已升级 schema。

下面记录的演练针对既有 `rovai-host run` 包和显式关联路径，不代替新入口或其他平台的资格。

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
