# 登录页与 Server 更新验证（2026-09-14）

实现基于分支 `rovai/unified-rust-host` 的 `205cb0d3`，保留同期 Linux 验证提交。

| 验证 | 结果与范围 |
| --- | --- |
| `pnpm typecheck`、`pnpm build:web` | 通过；Vite 保留既有大 chunk 提示 |
| Vitest `server-updates` / `client` / Desktop `app-updates` | 3 文件、38 项通过；可控时间覆盖断网、重启未确认、重连换版本和旧响应竞争 |
| `cargo test -p rovai-host --lib server_updates` | macOS 4 项通过；固定发布坐标、校验错误、重复/失效操作、停机未确认不安装、目录切换失败恢复、Unix revision/current、共享程序占用、真实子进程交接与参数保留 |
| `cargo test -p rovai-web` | 7 项通过；包含已有认证持久化与资源一致性测试 |
| `cargo clippy -p rovai-host -p rovai-web --all-targets -- -D warnings` | 通过 |
| `host-web-channels` + `host-web` 串行执行 | 3 项通过；Desktop 的四种更新操作均不开放，共享 Core/Web/渠道生命周期保持 |
| `server-entry` | 本机 3 项通过、Windows console 项按平台跳过；数据根、Token、终端与退出保留 |
| `host-web-mobile` 的 workbench 与 standalone Server 用例 | 2 项通过；真实 macOS Host/Server 与 Chrome，375/844/1440 登录页、明暗主题、退出后的初始表单；Desktop 只读说明、Server 更新控件、鉴权与封闭操作准入 |
| 文档门禁、`git diff --check` | 通过 |

首次多套 Host 测试与 Rust 编译并发时，channels 和 shared-Core 用例超过既有 15 秒步骤期限；未修改期限，串行复跑两者通过。

程序更新流水线使用本地 HTTP 与受控归档；交接测试执行测试程序作为下一版本，不启动真实 Core 或模型。
浏览器用例使用隔离数据、Skill Library、MCP 和 Chrome profile，没有操作日常 App 或用户 Server。
截图保存在本机 Downloads/Rovai-Server-Update-20260914；安装结果另行记录。

这些证据不等于正式 GitHub Release 升级：当前 `scripts/server-channel.txt` 仍为 `unpublished`。
Windows helper 与 Linux 实机更新尚未在本轮获得原生验收结果；它们已接入现有 Server 原生 CI 测试入口。
后续发布后还须用两份正式包验证检查、下载、重启、会话恢复及业务数据保留。
