---
document_type: contract
name: Runtime Launch and Verification
version: v41
status: accepted
source_version: v1.58
last_updated: 2026-09-13
---

# Runtime Launch and Verification v41

继承 [v40](runtime-launch-and-verification-v40.md) 的本机启动设置、手动路径封闭、Runtime 环境隔离、
CAS 保存和已有进程不受影响的规则。本版只改变主动检查的查找环境刷新、请求关联及结果呈现。
不增加自动升级、版本排序、轮询、页面打开深检或新的持久化字段。

## 本次检查环境

所有正式用户检查（`runtime.product.check` 和 managed installation 的显式刷新）在后端统一读取最新基础
查找环境，以原有目录优先级合并继承环境、平台注册表、交互 Shell 与已知目录，再从数据库加载已保存的
启动设置，形成不可变 Search Environment。发布与保存共用更新锁并推进现有搜索代数；单项检查只深检
目标 Runtime，不调用全目录深检。安装、登录指南与运行时列表共用此入口，不再先发另一条 rescan。
原 `runtime.discovery.rescan` 保留，负责用户显式刷新目录及既有有界浅检。

既有 `ROVAI_*_BIN` 覆盖值与 ZCode 默认入口也由基础环境捕获一次；候选解析不在检查中途再次读取它们。
其原有优先级不变；测试快照不继承宿主的覆盖值或默认应用入口。

`runtime.startup.inspect/check` 也读取最新基础环境，但只在临时快照上叠加当前草稿，不激活全局环境、
不写数据库、不推进正式搜索代数、不发布正式可用性或模型目录。“恢复自动”清空当前草稿的指定路径，
立即请求这一私有浅检；保存前，原正式指定路径仍有效。

`programPath` 非空时只检查指定入口。没有启动设置记录的旧显式安装仍是封闭候选，移动、删除或无效时
不得回退到自动程序；只有明确保存自动配置才取消指定。配置中的 `PATH` 只注入目标检查进程，不参与主程序
选择。不改变系统/Core 进程环境，也不覆盖其他 Runtime 配置。

## 身份、并发与进程

正式检查请求与 attempt 持有本次 Search Environment；不同搜索代数不能合并，排队期间失效的请求返回
`deferred`，不把旧检查结果当成刷新后的响应。所有正式成功、失败、rebound 与 manager 终态写回都在相同
更新锁内重验搜索代数，配置保存或再次刷新后，旧 attempt 不能修改当前状态。保存的 revision CAS、安装
身份与 locator/fingerprint 校验仍有效。

正式深检沿用 Adapter 自己的一轮版本、认证、协议和模型验证；不用额外的 `--version` 结果拼接后来另一份
程序的深检。草稿深检使用同一轮 Adapter 结果返回版本；草稿浅检与深检均校验原入口、locator 和 executable
身份，发生变化只报告未完成。正式检查继续使用已有有界重试与 `superseded` 收口，不提交混合身份的结果。

所有深检仍归 Check Manager 管理：全局最多两项、同 Kind 串行、90 秒总 deadline、超时与进程树清理。
新请求不通过结束旧任务来获取检查槽位。配置保存、检查和旧 installation 刷新均不调用 Fleet 强制失效；
已有进程继续使用创建时的环境，新进程使用届时有效的已保存配置。

## 返回值与诚实展示

草稿返回值在 v40 字段之外 additive 增加 `searchEnvironment`，形状沿用 health 的环境摘要。
环境摘要 additive 增加 `diagnosticCodes: string[]`，只含封闭原因码，不含路径列表或环境变量值。
Shell 失败/超时继续保留原 `shell` 诊断；注册表来源不可用或 PATH 合并使用回退来源均保留相应原因码。
读取 worker 失败时返回错误，不静默复用旧快照并宣称已重新读取。回退来源可用于检查，但不能被称为完整环境捕获。

正式页面优先显示当前搜索代数实际检查程序的版本；当前版本未知或手动入口缺失时显示未知，不以旧 snapshot
版本补齐。版本识别不等于完整检查通过；`stable_failure` 与 `deferred` 分别显示失败和未完成。历史成功与 LKG
可以按原规则保留，但不得包装为本次成功。草稿失败不回退显示旧正式结果，离开/编辑后旧预览不得覆盖当前页面。

## 验证边界

可控环境读取、临时目录、合成入口与私有数据库证明新环境选择、原路径升级、手动不回退、PATH overlay 不选主程序、
草稿/恢复自动不生效、保存和新检查不与旧 attempt 混并。程序替换沿用 identity-checked probe 的回归 owner。
Renderer 继续使用生产设置组件的隔离 Electron fixture，验证预览失败和迟到结果，不访问日常数据或真实账号。
具体命令与合同 owner 见[测试说明](../development/testing.md#主动检查的环境刷新)。
