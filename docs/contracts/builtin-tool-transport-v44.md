---
document_type: protocol-contract
contract: builtin-tool-transport-v44
authority: builtin-tool-transport
status: accepted
version: 44
source_version: v1.72
last_updated: 2026-10-20
---

# Built-in Tool Transport v44

继承 [v43](builtin-tool-transport-v43.md)；本版增加当前聊天 Run 范围的飞书沟通工具。
Transport/CLI **44**，capability `builtin_cli.transport.v44`；IPC **3**、Envelope **2**、Agent Output **14** 保持。

## 发现与身份

`rovai --help` 列出 `rovai feishu status|search|result|forward|ask|items|report|close`；每项 exact help 来自同一闭集 schema。
沿用现有 process token、lease、Run/epoch 认证；CLI 不接受模型传入的 Bot appId、provider、Owner 或任意 open_id。
Core 从当前 Run 实际认领的入站消息定位 Bot、会话及请求者，缺失或失效的绑定拒绝执行。
这不是 Desktop User Automation，不新增 Renderer 通用权限，不通过 `rovai app` 绕过 Run 身份。

不修改 SESSION_CHARTER、Dynamic Context、共享 Skill、ContextManifest、Profile/Formatter 或冻结正文。
既有 Bootstrap 中的 `rovai --help` 指引继续负责发现。Runtime 原生 Shell 审批不因新增工具被自动批准。

## 操作输入

| operation | CLI action | 输入 |
| --- | --- | --- |
| feishu.status | status | {} |
| feishu.search | search | {query, inputRef?} |
| feishu.result | result | {requestId} |
| feishu.forward | forward | {targetRef, text, inputRef?} |
| feishu.ask | ask | {targetRef, question, inputRef?} |
| feishu.items | items | {inputRef?} |
| feishu.report | report | {itemId, text, inputRef?} |
| feishu.close | close | {itemId, inputRef?} |

`inputRef` 只能引用本 Run 已认领的外部输入。省略时必须能确定唯一输入，批次歧义返回错误，不能取最新一条猜测请求者。
`targetRef` 是 Core 从本 Run 联系人查询结果或该输入的明确提及生成的受限引用；不得把可猜的姓名或裸 open_id 当作授权。
`ask` 的 `targetRef=owner` 是唯一特殊值，由 Core 解析当前 Bot 负责人；无负责人身份时明确失败。
发送及代问仅用于当前用户明确委托的沟通，不支持批量群发或无关自动转发。

## 完整结果

所有结果都是以下闭集对象，空集合保留空数组；结果不静默截断：

```json
{
  "status": "ready",
  "requestId": null,
  "contacts": [{"targetRef": "opaque-target", "name": "display-name", "department": null}],
  "items": [{"itemId": "opaque-item", "question": "text", "status": "waiting", "requesterName": "display-name", "targetName": "display-name"}],
  "inputs": [{"inputRef": "opaque-input", "authorName": "display-name", "isOwner": false}],
  "errorCode": null
}
```

`status` 为 ready|queued|sent|failed|unknown|closed；`requestId` 和 `errorCode` 类型为 string|null。联系人候选至多20项，事项与输入至多100项；超过事项或输入限制明确失败，不静默漏掉身份。查询仅在当前Bot授权范围内执行，不提供全租户通讯录导出；扫描预算耗尽不声称“没有联系人”。
CLI 对 failed 返回退出码2，对 unknown 返回3，其余状态返回0；queued的0只证明受理，不证明送达。
`queued` 仅表示持久入队，不表示已找到联系人或已送达；使用 `result` 读取同一请求。
`sent` 只有平台确认后才返回；`unknown` 表示结果不可确认，不能盲目再次发送。
拒绝应给出安全业务码，不把 SDK 原始响应、appSecret、access token 或凭据路径放进错误结果。

## 持久幂等与Host边界

认证 lease 的内存 replay 不能替代业务持久幂等。相同 Run/epoch/输入/操作及规范化参数的重新调用复用同一效果；
复用请求ID但更换参数拒绝。新的合法 Run/用户委托不因旧Run摘要而被错误去重。
结果查询只读，不能触发发送或重建事项。

飞书凭据只留在现有渠道 Host。Core 持久化查人请求，Host 在所绑定 Bot 权限内执行并按 worker/lease 结算；
工具写操作复用现有出站队列。停止执行、模式变化、跨 Bot/Run 输入、失效目标和迟到租约均不得扩大授权。

代问先创建事项与出站记录，再发送。被询问人的报告只能回到已冻结原会话；引用匹配或唯一等待事项可以关联，
多事项无引用必须澄清。阶段/补充不自动关闭；只有当前 Bot Owner 可以关闭事项，关闭后的迟到回复不可重开。

## 执行证据

新增操作接入现有证据投影版本4：输入仅保留授权引用和正文长度/摘要，结果仅记录状态、请求引用及集合计数。不把联系人姓名、询问正文、回复正文或SDK原始错误复制到执行证据摘要。既有摘要绑定校验与冻结输入不变。

## 验证边界

必须覆盖CLI help/输入与输出schema、受认证调用、Host查询与回执、权限拒绝、歧义、跨范围调用、重复请求、重启及unknown不重发。
真实飞书账号/联系人和真实模型调用须另行授权；模拟通过不等于真实平台验收通过。
