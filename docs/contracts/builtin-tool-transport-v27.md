---
document_type: protocol-contract
contract: builtin-tool-transport-v27
authority: builtin-tool-transport
status: accepted
version: 27
last_updated: 2026-09-17
---

# Built-in Tool Transport v27

Inherits [v26](builtin-tool-transport-v26.md), including the 26-operation catalog, authentication,
execution fencing, command replay, IPC 2, Envelope 1, receipt 1 and Agent Output Projection 3. Contract and
CLI command versions are 27; Runtime capability is `builtin_cli.transport.v27`.

Only the closed `mission.get` result changes:

| CLI | Input | Output |
| --- | --- | --- |
| `rovai mission get` | `{}` | `{missionId,title,description,status,sourceMessageId,attachments}` |

`attachments` is required and has schema `string[]`; an empty Mission returns `[]`. Values are current
Mission attachment source paths with the semantics and authorization in [Mission v2](mission-v2.md).
The canonical result and Agent output use the same shape. Missing `attachments`, a non-array value, or a
non-string item fails the closed output contract with the existing non-retryable
`builtin_tool.output_contract_mismatch` projection.

The catalog description, result schema and digest change atomically with the Core result. Bundled CLI and
Core advertise only v27 together; v26 remains the historical five-field contract and there is no mixed
v26/v27 mode. Built-in invocation evidence intentionally continues to omit attachment paths. Formatter 25,
ContextManifest 25, Profile 6, Bootstrap 3, Run Facts 4, Agent Output Projection 3, IPC 2, Envelope 1,
receipt 1 and the fixed command count remain unchanged.
