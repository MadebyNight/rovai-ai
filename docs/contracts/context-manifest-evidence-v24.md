---
document_type: protocol-contract
contract: context-manifest-evidence-v24
authority: agent-run-context-evidence
status: accepted
version: 24
last_updated: 2026-09-15
---

# ContextManifest Evidence v24

Inherits [v23](context-manifest-evidence-v23.md), including exact quotes, public history, private-session
boundaries, attachments and immutable evidence. New input uses Formatter/Manifest 24, [Profile 6](context-delivery-profile-v6.md),
[Run Facts 3](run-facts-v3.md), Session Charter revision 7 and [Built-in Transport 25](builtin-tool-transport-v25.md).
Bootstrap contract v3/Formatter 3, IPC 2, output projection 2 and receipt 1 remain unchanged.

## Mission input

Mission facts contain only `{missionId,title,status}`. Description is read through `rovai mission get`.
Only an explicit start proven by the persisted commission record projects
`{"kind":"mission_start","source":{"type":"user"},"missionId":"…"}` as CURRENT_INPUT. The internal
input evidence binds Mission, Camp, command and commission. User-authored lookalike JSON remains ordinary
message text. Ordinary messages and A2A keep their existing projection. No Mission version is exposed.

Mission Session Charter appends exactly:

```text
Rovai Mission Contract

- All current members may use `rovai mission get|update|status` to maintain this Camp's Mission.
- Change status only when the whole Mission's state changes, not merely when your Run ends.
```

Ordinary Camp and Single Chat Charter text is unchanged. Mission guidance does not grant private chats
Mission tools, require a get every Turn or impose a lead-only update policy.

## Workspace evidence

Mission public Run input may include `[WORKSPACE]` after RUN_FACTS and before A2A_GUIDANCE / CURRENT_INPUT:
`{workingDirectory,branch?}`. The absolute directory and Git branch come from the actual prepared Run
environment. Detached Git HEAD yields null; non-Git omits branch. This is information, not a path sandbox,
permission or instruction controlling the Agent.

The manifest persists the canonical workspace JSON, digest and inclusion decision. Include it until an
input carrying those facts is accepted on the current native binding/generation. Failed or unknown
delivery cannot advance the marker; late acknowledgement from a replaced binding cannot affect its
replacement. Unchanged facts are omitted after acceptance, including after restart on the same binding.
A new binding or changed resolved facts causes reinjection. Section bytes and internal evidence must agree.

Direct and A2A preflight share the payload budget policy without creating files. Once preparing resolves
the actual workspace, final materialization validates the environment, recomputes workspace evidence and
the final payload budget, then freezes bytes. The workspace section is not silently truncated.

Migration 156 admits new 24/24/6/RunFacts3 manifests. Existing frozen 22/22/4 and 23/23/5 input is accepted
only with exact frozen Delivery evidence and original payload digest; never relabeled or reformatted.
Historical evidence remains readable. Model schema golden: `packages/contracts/fixtures/agent-run-context-v24.json`.
