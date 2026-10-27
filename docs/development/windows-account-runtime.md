---
document_type: development-guide
authority: windows-account-runtime-setup-and-validation
last_updated: 2026-10-27
---

# Windows 账户启动（实验接线）

只新增 `windows_account`，默认 `shared` 与 `git_worktree` 不变。机制与失败收尾见
[Managed Runtime Process v2](../contracts/managed-runtime-process-v2.md#显式-windows-account-bootstrap)。
本接线不等于 Claude/Codex 聊天、续聊或 Rovai 内置工具的完整资格验收；尚未支持的跨账户资源不能自动开放权限。

## 显式配置

部署者先准备已有非管理员本地账户、该账户能访问的 CLI/Core EXE 与工作目录，以及独立 profileRoot。
账户密码由宿主账户通过 Windows DPAPI（PowerShell `ConvertFrom-SecureString` 不指定 key 的 hex 文件）保护。
Rovai 不自动创建账户、不重置密码、不修改文件 ACL、不提权。配置本身不含明文密码：

```json
{
  "username": "DedicatedRuntimeUser",
  "domain": ".",
  "dpapiPath": "C:/private-runtime-config/credential.dpapi",
  "profileRoot": "C:/Users/DedicatedRuntimeUser"
}
```

启动隔离开发实例前设置 `ROVAI_WINDOWS_ACCOUNT_CONFIG` 为上述 JSON 的绝对路径。
显式设置 `ROVAI_CHAT_ISOLATION=windows_account` 使后续尚未冻结工作区的 Runtime-managed Claude/Codex Run 选择该档。
它是进程部署级开关，不是新增 UI，也不只针对某个侧栏分组；其他 Adapter 不采用此开关。
已冻结的 Run 继续使用原隔离档。调度命令也可显式指定 `workspace.isolation`；只有 Claude/Codex 原生 EXE 接入该档。
移除开关恢复后续 Run 的原默认路径，不迁移旧 Session 或删除任一 profile。原冻结 Runtime/provider 环境保持不变，切换 Windows 账户不代表切换 provider 账号；
没有承诺剥离宿主认证环境。输入文件经内存 base64 帧传输，总帧上限 16 MiB，超过上限会拒绝启动，不截断输入。

profileRoot 是显式部署目录，不是“自动找到沙箱账户 Home”。不得用日常 HOME 做验收。须按
[本地开发隔离流程](local-workflow.md) 启动，不在日常 userData 执行，也不绕过 `pnpm dev`。
配置缺失、JSON 无效、DPAPI 解密失败、管理员账户、helper 无读取/执行权限或目标 cwd 无访问权限均拒绝启动，不回退宿主身份。

## 用户可见限制

启用隔离档后，Claude/Codex 的配置、缓存和原生会话文件会写入你指定的沙箱资料目录，并非完全不写磁盘；
宿主是否能读取它们由实际 Windows 目录权限决定，不能只看目录名称。Claude 启动时还会短暂使用 Rovai 的私有输入文件，
异常强杀可能在沙箱临时目录留下副本。目前 Rovai 内置协作工具的 Windows 通道只接受宿主登录身份，
隔离账户不能使用它；附件、Skill、工作目录和原生 CLI 登录也需要分别准备，不能沿用宿主私有目录。
管理员只需在部署阶段准备专用非管理员账户和必要目录/程序访问权限，日常运行不要求提权；程序不会替你放宽这些权限。
在真实聊天、续聊和停止验收通过前，这个档位只能视为实验性启动接线，不能说完整聊天 Bot 隔离已经上线。

## 验证

普通确定性回归（不调用模型、不读真实凭据）：

```sh
cargo test -p rovai-core --lib managed_process:: --offline -- --test-threads=1
cargo test -p rovai-core --features extended-tests --lib codex::tests:: --offline
cargo test -p rovai-core --features extended-tests --lib claude::tests:: --offline
cargo check -p rovai-core -p rovai-host --bins --offline
```

新自动 owner `account_bootstrap_requires_request_and_relays_native_exit` 负责 pre-GO EOF、真实 helper/stdout、原生 whoami 退出与 Job 归零，
并覆盖 64 KiB 启动输入传输及目标关闭 stdin 后大帧写入必须有界失败；
账户策略 owner 验证环境重定向、派生继承与兼容摘要。既有 capture owner扩展验证 shared/git_worktree 完全不选择账户且环境不变。
自有 helper 的 ignored 测试只作子进程入口；默认测试不需要系统账号。

人工确认已有账户和 DPAPI 配置后，可运行唯一需要真实凭据的原生 smoke：

```sh
cargo test -p rovai-core --lib existing_account_launch_uses_product_spawn --offline -- --ignored --nocapture --test-threads=1
```

它仅启动 Windows `whoami.exe`，不启动任何 AI CLI、不加载 provider 凭据、不调用模型。成功只能证明新产品启动路径的账户身份、stdio、退出码与 Job 回收；
不能替代真实 Claude/Codex、跨账户 Built-in IPC、目录不可见性或全生命周期文件写入证据。

### Rust 测试准入说明

账户环境/兼容摘要/派生继承由最低成本纯配置 owner `account_policy_resets_profile_and_preserves_explicit_runtime_environment` 拥有；
原 capture owner只管入口捕获，不覆盖账户 profile 重定向。新 bootstrap owner必须跨真实 pipe/进程验证，
纯序列化测试不能捕获 pre-GO EOF、stdin relay BrokenPipe 或 Job 延迟归零；这些 case复用同一 fixture，不建平行套件。
其修复前可失败输入包括非空 Windows OsString 环境 JSON map、64 KiB 文本输入和目标先关 stdin 再存活的大帧发送。
ignored `account_helper_entry` 是确定性子进程入口，不代表跳过验收；真实登录 smoke必须有人工凭据，故独立且默认忽略。
未删除、合并或永久禁用任何原 active test。最小命令均列于上文。
