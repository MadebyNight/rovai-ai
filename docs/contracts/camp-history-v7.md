---
document_type: protocol-contract
contract: camp-history-v7
version: 7
status: accepted
authority: live-agent-visible-camp-history
last_updated: 2026-09-18
---

# Camp History v7

v7 inherits v6 identity, authorization, attachment-path and cursor contracts, and changes public message
visibility and result sizing.

`camp.read` evaluates the calling Agent's latest authorized Camp state at call time. It is not restricted by
the current Run's ContextManifest, public-tail window or frozen visibility snapshot. It applies `limit <= 20`
and cursor first, then returns the selected page with complete bodies, quotes, attachments, metadata and
`anchorMessageId`. The former 80,000-scalar aggregate budget, prefix bodies and size-driven page shrinking
are removed.

Every Agent-facing read/search/thread/reference path applies the same visibility policy:

- a recallable local-Principal message is invisible to every Agent;
- after the first target claim, an unclaimed target remains suppressed until its own Delivery is claimed;
- claimed targets receive the message through `RUN_INPUT`; non-target Agents then use ordinary public rules;
- withdrawn messages are absent from collections and pagination; exact ID returns `message.withdrawn`.

Reading does not claim a Delivery, close recall, or advance accepted watermarks. A cursor cannot bypass
current authorization, suppression or withdrawal.

