---
document_type: protocol-contract
contract: message-delivery
version: 9
status: accepted
authority: public-message-delivery-first-queue
last_updated: 2026-09-18
---

# Message Delivery v9

v9 replaces [v8](message-delivery-v8.md) for new public Camp work. Historical v1–v8 rows remain
read-only evidence; they are not dispatched by the v9 scheduler.

## Responsibility and ordering

Publishing one `CampMessage` creates at most one Delivery for each explicit target. A Delivery is the
durable fact that one Agent must receive that message; it is not an execution attempt or completion
aggregate.

```ts
type CampMessageDeliveryV9 = {
  id: string
  campId: string
  messageId: string
  recipientAgentId: string
  recipientMembershipVersionAtAdmission: number
  queueSequence: number
  status: 'waiting' | 'claimed' | 'settled' | 'failed' | 'cancelled'
  claimedAgentRunId?: string
  failureCode?: string
  version: number
}
```

`(campId, recipientAgentId, queueSequence)` is unique and ordered by the source message sequence.
`(messageId, recipientAgentId)` is unique. Waiting rows do not freeze Runtime configuration and do not
create an AgentRun.

## Claim

The scheduler atomically claims a complete FIFO prefix for one `(campId, agentId)` lane. The transaction:

1. validates current membership and execution/isolation admission;
2. reads the Agent's current Runtime, model, mode, workspace, tools and permissions;
3. selects the largest complete prefix that fits the current input profile, without skipping the head;
4. creates one immutable `AgentRun` plus ordered `AgentRunInput` rows;
5. binds every selected Delivery to that Run and changes it to `claimed`.

The Run's last input is its `anchorMessageId`. Later settings and messages cannot change the frozen Run.
A crash before commit leaves waiting Deliveries; a crash after commit recovers the same Run.

Sources do not form batch boundaries. User, Agent/A2A, Mission, Automation and Channel messages can share
one Run. No budget root, depth, caller lineage, Gather or CampTurn is consulted. Self-send remains invalid.

## Terminal behavior

Run settlement changes each claimed Delivery to `settled`, `failed` or `cancelled` with monotonic evidence.
There is no user business-retry transition and no replacement Run for accepted/unknown input. A safe
transport continuation may resume the same frozen Run only when the Runtime did not accept it.

Stopping a Run does not cancel waiting Deliveries. Membership removal cancels that membership lifetime's
waiting Deliveries; rejoining creates a new lifetime and only later messages create new work.

## Migration

Migration 162 preserves already-public legacy work that has no frozen ContextManifest or accepted Runtime
input as v9 waiting Deliveries. It terminalizes the old mutable Run/attempt placeholders. Frozen or
accepted legacy work is never requeued.

