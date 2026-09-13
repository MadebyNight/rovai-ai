---
document_type: protocol-contract
contract: host-web-v2
authority: shared-host-web-transport
status: accepted
version: 2
source_version: v1.59
last_updated: 2026-09-13
---

# Host Web v2

v2 replaces [v1](host-web-v1.md) for new Web sessions. One Core, local management, memory-only browser Bearer credentials, bounded admission, CSP and invalidation SSE remain.
The single-Owner model, directory access, local token rereading and multiple interface origins below supersede v1 restrictions.
This contract admits the shared Camp write path; it does **not** qualify a platform for secure network release.
Implementation and remaining acceptance evidence belong to the [version plan](../versions/v1.59/implementation-plan.md).

## Product and network trust model

One Owner operates a trusted self-hosted Host. An authenticated remote Owner has the same intended business capabilities
as Desktop; incomplete adapters are implementation gaps, not a restricted remote role. This release does not build a
multi-tenant or strongly isolated execution platform and does not promise to defend arbitrary malicious same-UID processes.
The former S1 isolation proof is not a delivery gate. Existing Runtime permission modes, approval, process cleanup and
file-operation validation remain unchanged. Known sentinel failures remain evidence; they are not relabeled as passes.

Local `host.web.status` returns `enabled`, `listen`, optional `origin`, `addresses` and session counts, never credentials.
Each address contains `origin`, `interface` and `recommended`. Rust enumerates actual interfaces compatible with the
listener. Discovery excludes 198.18.0.0/15 (including mapped IPv4 literals); these addresses are not shown, recommended,
copied or encoded as QR codes. This is a presentation filter, not a network ban. IPv6 link-local URLs requiring
browser-unsupported scope IDs are not advertised. Selecting an address is local presentation state only: it cannot
change the listener, Owner, permissions or credentials. QR codes contain only the selected address, never credentials.
`origin` is the first advertised address and is omitted when discovery is empty; starting the listener does not require
an advertised address. Interface discovery does not guarantee remote reachability.
The listener accepts its actual interface authorities and optional explicit reverse-proxy `publicOrigin`; an Origin
header must match the same authority's complete origin. Arbitrary Host, cross-origin requests and query parameters are
rejected; there is no credentialed CORS. LAN HTTP requires an explicit enable choice, with HTTPS/VPN for untrusted networks.
In Desktop, the Remote Access switch is that explicit choice: it starts the IPv4 wildcard listener without a separate
local/LAN selector, and shows local and remote addresses separately. The always-visible port is pending launch-form state:
editing it does not restart or reconfigure the running service; the next start uses it. Stopping needs no second confirmation.

Trusted local `host.web.token` returns `{administratorToken}` repeatedly without rotation or session revocation,
including before the first listener start and after stop. The Host initializes a random token on the first local read
or managed start; start reuses that token and returns it. Rotate returns a new token. The Host retains the administrator
token in private process memory for local readback and subsequent listener starts, with no Debug/Serialize on the credential store; authentication continues to use a typed digest and
constant-time comparison. Status, public HTTP operations, diagnostics and logs never include it. Rotation is a separate
explicit local operation that changes the token and revokes sessions. Web stop closes the listener and revokes all
browser sessions, but retains the administrator token for local viewing/copying and the next start in the same Host
process. It is not persisted across Host process restarts. Desktop settings always shows the masked token field with
visibility and copy actions; it has no refresh/regeneration button. Standalone startup accepts the Owner's
token on stdin as before. Browser authentication still keeps only a short-lived session and editing proof in page memory.

## Authentication and editor ownership

`POST /api/v1/login` accepts `{ protocolVersion: 2, administratorToken, editor? }`.
`editor`, when present, is exactly `{ clientId, proof }`. An incompatible protocol is rejected before issuing a session.
The response contains `protocolVersion: 2`, `token`, `clientId`, `editorProof`, `ownerId`, `expiresInSeconds` `epoch` and `channels: "desktop" | "unsupported"`.
The browser checks the response protocol before mounting business pages or sending commands.

Fresh login creates a Core-owned random 256-bit editor identity and an independent random recovery proof.
Core persists only the proof digest, bound to the current Owner; the Host must first verify fresh administrator
authentication before it can resolve or resume that editor. A client ID, Draft ID or proof alone never authenticates
a Session. Another client's proof cannot resume the named editor. Reauthentication replaces that editor's old Session,
including at session capacity. Rotation and Web shutdown fence an in-flight login as well as existing sessions.

Session expiry, reconnect and same-page reauthentication change authentication/connection generations, while retaining
the editor identity, mounted Composer, unsent local edits and original outstanding command IDs. Host or Owner changes
require a different editing/cache scope. Production Web currently has one fixed origin per page and refuses an Owner
change in place. Separate pages create separate editors. Tokens and recovery proofs are kept only in page memory;
a full reload creates a new editor and is not a cross-page Draft recovery service. Presentation preferences may use
origin/Owner-scoped browser storage; business state, credentials and Drafts must not enter that store.

## Admitted operations

The Rust `operations::Operation` enum remains a closed network allowlist. It now admits the existing Core operations for
Camp creation/preflight/membership, member configuration, Runtime discovery/check/catalog, scoped Camp Draft mutations,
pending editing, send, cancellation, approval, execution detail and read-only command reconciliation.
The management increment also admits Task create/update, Memory governance/export, Automation definition/run operations,
Skill inspection/import/assignment/deletion, MCP config/assignment/import and Runtime startup settings. These call the
existing Rust handlers; they do not admit the scheduler control/tick, platform recovery or arbitrary source binding.
Task projections retain only Core-advertised `update` on Task objects; unknown actions remain filtered. It does not admit
arbitrary internal RPC, local management, source binding or editor-resolution methods. Host workspace paths are admitted
for browsing and existing Core workspace operations after Owner authentication.

HTTP stamps the verified editor on the trusted Core request; JSON cannot select that field. Core applies the same
domain services and command gateway as Desktop. [Camp Draft v13](camp-composer-draft-v13.md) and
[Pending Input v4](pending-camp-input-v4.md) own the editing boundaries. Approval options and versions come from Host
authority, and resolution uses the existing atomic domain command, not a frontend approval state machine.

`commands.reconcile({ operation, params })` reads the original gateway receipt with the original command ID, payload
digest, Owner and editor. It returns `recorded` with the original result or `unknown`; it never executes a command.
For Draft APIs whose original response throws a recorded domain rejection, `recorded.error` carries that same error;
the client settles the original submission as rejected instead of leaving it in an unknown/submitting state.
An admitted request survives HTTP disconnect. Unknown results retain their original request and submitting promise in
the page. Reconnect/reauthentication/SSE only reconcile; an explicit user retry may resubmit the identical ID and payload.
An unsuccessful retry does not prove that the earlier attempt was uncommitted.

Ordinary HTTP timeouts remain 15 seconds; native Runtime check/discovery/catalog reads allow 120 seconds. SSE never
holds the command queue. Capabilities report protocol 2 and the admitted Composer/upload/approval path, while
`releaseQualified` remains false. Read projection filtering still excludes private fields and unsupported actions;
the new write allowance is not permission to expose every internal action.

## Workspaces, uploads and resources

There is no local directory preauthorization list and no `authorizedWorkspaces` / `--web-workspace` grant.
Authenticated `POST /api/v1/workspaces` accepts `{path?, offset?}`. Omitted path starts at the Host account's home;
absolute paths are canonicalized and must be readable directories. The response includes `projectPath`, `name`,
`parentPath`, filesystem `roots`, `directories: [{name, projectPath}]` and `nextOffset`. A page scans at most 4096 entries
and returns at most 256 directories, with a 15-second timeout and shared request capacity. Unavailable paths fail explicitly.
The picker can browse parents, drives and subdirectories or enter an absolute path. Core's existing workspace inspect,
validate and create operations determine project validity; an OS denial remains an error. Selecting a Host directory is
separate from uploading a file chosen on the browser device. Directory listing is discovery, not a permission grant.

`POST /uploads` accepts multipart `intent` JSON and exactly one `file`. Intent contains an original UUID command ID,
Camp, exact Draft revision, display name, byte count and SHA-256. The file limit is 20 MiB, with four uploads in flight.
The endpoint creates a private OS temporary file and asks Core to atomically bind a source reference and receipt to the
verified editor's Draft. The digest excludes the physical temporary path, so a duplicate physical upload can replay
the same command. `POST /uploads/reconcile` reads that binding receipt. A detached binding attempt survives disconnect.

The endpoint cleans failed or provably unbound files; an unknown binding is retained for reconciliation. After Core
accepts a reference, deleting a reference, failed send, logout or shutdown does not delete its source. Draft → Pending →
Message transfers use the existing Core transactions. OS cleanup can make history unavailable. No permanent user asset
store is introduced; [Camp Attachment v9](camp-attachment-v9.md) and Agent Managed artifacts keep their lifetimes.

`POST /files` and `POST /attachments` use exact Core owner locators or Core-resolved workspace/evidence sources. Every
read revalidates source ownership; opaque handles/reopen tokens are scoped to the editor and Web instance. An exact external file admitted by Core follows Desktop's existing file semantics: its canonical parent is an ephemeral
child/watch boundary, not a directory grant. Relative resources are resolved under that boundary; canonical checks and
handle-based no-follow opening prevent replacement from changing the retained source.
There are at most 128 handles per server and 32 per editor. Reads have byte and generation bounds. Download uses an
octet-stream response with an encoded original filename; credentials never enter the download URL.

The initial resource adapter supports bounded UTF-8 text/Markdown and PNG/JPEG/WebP. HTML/SVG use text or download,
never executable preview. UTF-8 text above 2 MiB is paged (256 KiB pages, 20 MiB read bound); byte offsets preserve
Unicode scalars. Child links retain the Core-authorized parent source; project children receive independent workspace
restore requests, matching Desktop. Local PNG/JPEG/WebP images are read lazily through the same authenticated,
generation-bound parent. The browser creates only in-memory object URLs, revoked on unmount. File metadata polling
marks open tabs changed; reload reauthorizes the source and replaces its generation. Native open/reveal actions are
absent, while download and displayed-path copy use browser controls. Attachment storage paths stay hidden.
Static assets remain separate from user files.

## Shared presentation and verification

Actual Web login mounts the production `BusinessApp`, `CampNavigation` and `CampWorkspace`. Desktop injects IPC and
native APIs; Web injects HTTP, resources and browser preferences. Missing Web dependencies fail explicitly. Desktop
bootstrap, window session, updates and native lifecycle remain in its entry point. No global Electron bridge is forged.

SSE resync/invalidation rereads authorized navigation, active Camp/execution projection and member state through the
existing shared refresh coordinators. Running text/tools, approvals, stop and terminal state must refresh in place;
the connection revision is not a database watermark, and refresh must not remount the Composer or move history.

Verification owners remain v1's auth/operation/client/real-Host tests, extended for ownership, source binding, receipts,
revocation and protocol rejection. Real Runtime execution and real Desktop/browser UI evidence are separate from
component fixtures and no-model HTTP tests. The removed S1 promise does not turn historical failures into passing evidence; release qualification still requires the
remaining business, network and platform checks recorded in the version plan.

## Shared management resources

Management pages receive request, invalidation and resource adapters explicitly. An invalidation rereads the authorized
list/detail while retaining local drafts and version conflict handling. Skill directory selection refers to the Host
filesystem; Runtime startup on Web accepts a Host absolute program path. Browser keyboard conventions remain local,
while installation and Runtime qualification use the Host health platform. Channel capability comes from the authenticated Host deployment; native system-file integration remains absent in Web. Browser code never dereferences an Electron bridge.

`POST /api/v1/avatars` accepts a closed `read | save` action. Save carries bounded normalized PNG source/icon and crop,
never an arbitrary path; the shared Rust member-avatar store verifies dimensions, crop, format and byte limits before
atomic compound publication. Content identity makes repeated saves reuse one asset. Reads require a canonical managed
avatar reference, fixed manifest file names and matching digest, and return PNG bytes. Desktop IPC uses the same Rust
read/save handlers. The network body is limited to 24 MiB and shares the upload concurrency quota. Renderer avatar caches
are scoped to the injected reader, so identical avatar IDs on different Hosts cannot share bytes or late responses.

MCP config and mutation projections include only admitted editor fields. Rust masks stored credential headers/environment,
URLs containing user information or query parameters, and credential-bearing argument lists; masked edits preserve their
exact existing field/index under the original config digest. Explicit reveal is an ephemeral authenticated read requested
by the editor control; it never enters list refreshes, SSE or command receipts. MCP configuration continues to use its
existing config-digest CAS. A lost result requires rereading authority and resolving a conflict, without silently claiming
success or automatically retrying a configuration change. SQLite-backed Task/Memory/Automation/Skill commands instead
use their existing durable gateway receipts and the original command ID.

## 私聊与其他上传目标

Migration 154 将 Single Chat Draft 改为 `(conversation_id, client_id)`，既有记录归 Desktop，
Pending 的来源与活动编辑也记录后端 client。认证后的 Owner 共享已提交的私聊会话，但未提交附件、引用、
编辑令牌和 Pending working refs 只通过已校验的编辑身份读取；命令的幂等摘要包含该身份。
Desktop 的默认身份不增加旧命令的序列化字段。结束私聊沿用 Core 的线性化点，清除该会话全部客户端 Draft。

`singleChat.open/get/list/send/end`、原 Pending 编辑和移除草稿附件均调用同一 SingleChatService。
上传 intent 保持原 Camp 默认形状，显式 target 可选择 Camp Pending、Single Chat Draft 或 Single Chat Pending。
四种目标共用上传限额、摘要校验、弱持久 Source Ref 和命令回执；目标的版本、编辑令牌和 client 检查发生在原领域事务中。
上传回执查询不重新派发；返回对应客户端当前授权视图。SSE 只发失效通知，共享私聊页面重读列表／当前快照，
不把失效消息解释为私有 CoreEvent。正文输入仍由当前页面保存，同 Owner 重新认证不重挂业务子树。


Shared administration now includes Camp rename/delete/discard, member reorder/removal preview/removal, Camp Fast
configuration, accepted-input recovery decisions, notifications, monitoring, diagnostics and Skill reconciliation.
Each public method is individually admitted; durable commands use their existing Core envelope and receipt lookup,
including after Camp deletion. No host shutdown, token management, raw source resolver or source-path ingress RPC is
made public. Diagnostics download uses Core's redacted v5 export; monitoring uses the existing filtered snapshot.
Notification preferences and acknowledgements belong to the single Owner; heads-up queues, focus and visible-source
observations remain per browser. Invalidations reread authorized notification changes/preference; they are not CoreEvents.
Channels are supported in Desktop-hosted Web through the closed adapter below; standalone Server channels remain outside stage 1–4 qualification.


## Desktop-hosted channels and logout

The authenticated login reply and `/api/v1/capabilities` declare `channels: "desktop" | "unsupported"`.
Standalone Server omits the channel settings navigation; retained routes show:
“独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。” No manual Bot import or credential migration route is added.

Desktop-hosted Web mounts the production `ChannelSettings` page with an injected channel client. Account connection,
switching and reauthentication stay on the computer running that Desktop; only genuinely native steps redirect there.
Publishing, retrying and structured approver selection remain browser actions against the existing Desktop coordinator,
provider service, publication identity and Core persistence. Unknown creation outcomes never authorize a new Bot.

`POST /api/v1/channels` shares the authenticated, same-origin, bounded-body network boundary. Its closed tagged bodies are
`{operation:"get"}`, `{operation:"publish"|"retry",kind,agentId}` and
`{operation:"selectApprover",kind:"dingtalk",agentId,userId}`. IDs are nonempty, at most 256 UTF-8 bytes, with no control
characters. Extra fields, native login operations and arbitrary RPC methods are rejected. The Host bounds waiters to 16,
with a 60-second result deadline; losing a waiter never cancels admitted Desktop work. A result timeout is unknown,
not proof that the operation failed. Re-read the existing publication and use its existing recovery path.

The local parent pipe uses `host.channels.dispatch`/`host.channels.reply` with a Host-registered request identity and one
`host.channels.request` notification. Dispatch acknowledgement frees the Core queue before Desktop calls Core again.
These methods are never admitted as Web Core operations. The Desktop callback accepts only the same four operations,
fences responses by child generation, and projects the public snapshot field by field. Cookie, App Secret, native login
QR and raw exceptions are absent. Generic Main forwarding and new platform publication state machines are prohibited.
Desktop IPC and Web publication mutations share a per-provider admission gate in the existing coordinator.

The mounted Web page re-reads the authorized snapshot every two seconds, including progress that has no Core event;
responses are fenced by authentication generation. Read failure shows unavailable/unknown live state while retaining
stored publication facts. Each provider's `provisioning` retains its original publication progress independently;
the legacy aggregate cannot hide another provider's in-flight work or approver choices.
`connection.sessionStatus` is the latest runtime inspection (`valid`, `invalid`, `unavailable`,
`unknown`), distinct from account connection records. Bot `connectionStatus` is `online`, `offline` or `unknown`, separate
from publication status. `published` retains the durable Bot publication fact when a later retry/connection failed. Absent live fields are unknown; persisted records alone cannot establish current connectivity.

Only known expired/mismatched sessions produce `channel_session_expired` and the instruction:
“请在运行此服务的 Rovai Desktop 中重新连接账号，完成后返回本页重试。” Timeouts, platform approval and ordinary
recoverable failures stay in the current page. Existing structured approval candidates use the shared selection form.

Web logout is available once under Settings → Remote connection. It revokes only that Session; Host, tasks, other
sessions and channel services keep running. Closing a browser or stopping Desktop's Web listener does not stop channel
connections or admitted publication work. Only Desktop's existing controlled shutdown owns channel service shutdown.
