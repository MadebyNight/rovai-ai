---
document_type: version-decisions
version: v1.61
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-19
---

# v1.61 版本决定

<a id="v1-61-d01"></a>
## V1.61-D01：程序与模型共用内部 Mission ID，UI 保留展示编号，读取全局开放但修改仍绑定当前 Mission

- 状态：accepted
- 日期：2026-09-19
- 当前权威：Mission v5 与 Mission Architecture

让 `get` 只依赖当前 Camp，会迫使 Agent 通过工作目录、最近提及或临时成员关系猜目标。选择让所有有效
AgentRun 通过轻量 `list` 和显式 `get` 读取同一实时定义，并让数据库关系、内部事件、Agent Mission 操作与
模型上下文共用现有内部 `rvm_...` 主键。模型通常复制、传递 ID，不需要像人一样记忆或口述它；同一 ID
贯穿链路也避免了转换歧义。目标 Camp membership 继续用于参与、寻址和写入，不作为公共 Mission 定义的 read ACL。

读取附件路径意味着所有 Agent 得到同一份定义，而实际文件访问仍由 Runtime/操作系统权限决定。列表不加载描述、
附件、成员或工作区；游标绑定筛选并按数值倒序，避免 offset 漂移和字符串排序错误。`update/status` 不接受 ID，
因此跨 Mission 读取无法暗中改变写目标。

不可变 number 继续用于 UI `M-xxx`、Mission 分支和工作区名称，但 Agent 结果不增加 number。拒绝把 `M-xxx`
变成模型 selector，因为它要求程序在内部 ID 与显示编号之间转换；拒绝同时返回多套 ID，因为这会把选择责任
推给模型；也拒绝以临时加入目标 Camp 换取读取，因为它制造了真实协作副作用。

<a id="v1-61-d02"></a>
## V1.61-D02：Single Chat 以冻结 policy version 2 增加 Mission 只读能力

- 状态：accepted
- 日期：2026-09-19
- 当前权威：Single Chat v6、Built-in Tool Transport v29 与 Single Chat Architecture

只修改 Single Chat Charter 会产生“模型被告知可以调用、数据库或 Router 却拒绝”的不一致；直接改写 version 1
allowlist 又会改变历史 Run 的冻结权限。选择保留 `single_chat_v1` policy identity，并把新 Run 的
`operationPolicyVersion` 升为 2：只增加 `mission.list/get`，历史 version 1 仍只有三项历史读取。

Migration 165 把 AgentRun 列约束扩展到 1/2，并在关系约束中继续把普通 Camp policy 固定为 version 1。
Runtime terminal 与历史读取接受两种已知冻结版本，未知版本 fail closed。Single Chat 仍不加载完整
`cli-operations` Skill，也不开放 Mission mutation、消息发送、Task 或 Memory；这样新增发现能力不会把私聊变成
公共协作控制面。

拒绝为 Mission 建立第二套私聊专用工具，因为会复制 schema、授权和帮助；拒绝不版本化地扩大 version 1，
因为无法审计一个历史 Run 实际冻结了哪组能力。
