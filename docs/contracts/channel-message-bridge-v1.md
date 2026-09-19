---
document_type: protocol-contract
contract: channel-message-bridge-v1
status: accepted
target_version: v1.60
last_updated: 2026-09-18
---

# Channel Message Bridge v1

A Channel is an asynchronous bridge, not a synchronous request/response wrapper around an AgentRun.
Inbound receipt completes when one external-principal `CampMessage` and its target Delivery are committed.
It does not wait for execution or an outbound reply. Later inbound messages enter the same Agent FIFO.

A Camp has at most one Channel binding. Every Agent message published through ordinary `rovai send` in a
bound Camp atomically creates one idempotent ChannelDelivery for that message. The outbound payload is the
published message and its explicit attachments, not Run inputs, logs or anchor ancestors. No `--to-channel`
flag exists.

ChannelDelivery retry/failure is independent of the inbound message, AgentRun and Camp Delivery. It never
reruns the model or silently converts the result to local-only publication.

