---
document_type: protocol-contract
contract: planned-shutdown-v8
authority: local-input-and-supervised-core-task-settlement
status: accepted
version: 8
source_version: v1.60
last_updated: 2026-09-19
---

# Planned Shutdown v8

v8 inherits [v7](planned-shutdown-v7.md)'s protocol 3 wire, durable cancel-all transaction, ten-second hard deadline,
writer fences and Renderer preparation. It replaces two local lifecycle details.

Public Composer content is already saved by the Desktop-local per-Camp store in
[Camp Composer Draft v15](camp-composer-draft-v15.md). Renderer preparation still flushes an in-progress Lexical,
quote, attachment or send operation before teardown, but it neither writes a Core Draft nor discards an already saved
local snapshot. Refresh, window recreation and ordinary restart may restore that local snapshot; no other client can
read or merge it.

The AgentRun Scheduler and the legacy 500ms maintenance loop are sibling tasks owned by `run_core`'s shutdown
supervisor. Normal shutdown signals and waits for both. If launch handoff exceeds its grace, the supervisor aborts and
waits for both before considering writer fences quiesced. Cancelling the Scheduler cannot detach a maintenance task or
leave a slow non-batch preflight running behind an already emitted shutdown report.

