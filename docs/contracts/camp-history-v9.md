---
document_type: protocol-contract
contract: camp-history-v9
version: 9
status: accepted
authority: public-camp-history-read-scope
last_updated: 2026-09-24
---

# Camp History v9

v9 inherits [v8](camp-history-v8.md) authentication, public Camp scope, request shapes, publication boundaries, complete-result behavior, attachment projection and viewer-specific quote-source validation. It changes explicit history visibility and `camp.read` withdrawal projection. Private Single Chat and Runtime-private records remain outside this contract.

## Explicit read and search visibility

An authenticated Agent's `camp.read`, `camp.search` and `history.search` may return a published message while its `recall_state` is `recallable` or the viewing Agent still has a `waiting` Delivery. A read or search does not claim that Delivery, close recall, advance an accepted watermark or add the message to the current Run's frozen input. The Principal may still withdraw a local Composer message until the first target claim, subject to the existing message-version check. Previously returned tool results are not rewritten; subsequent calls use the current message state.

`camp.read` uses the selected extant public Camp's live sequence boundary at call time, including when that Camp differs from the calling Run's Camp. `camp.search` on the current Camp also remains live. Cross-Camp `camp.search`, `history.search` and `camp.list` retain the calling Run's frozen global publication boundary. IDs and cursors do not bypass Camp existence, publication, tombstone or these boundaries.

`camp.search` and `history.search` preserve their existing query, rank, snippet, limit and result schemas. They may match recallable or waiting messages within their boundary, but withdrawn messages are excluded from body, reference and structured Principal-mention candidates. A withdrawn marker is never searchable text.

## `camp.read` result items

The existing normal message item shapes remain unchanged. Timeline and thread normal items retain `messageId`, `sequence`, `authorType`, `authorId`, `anchorMessageId`, `createdAt`, `body`, `attachmentCount` and optional `quotes`. Exact-item normal results also retain `attachments`, attachment truncation fields and `addressing`.

After withdrawal, timeline and exact-item reads return an item with exactly these fields:

```json
{"messageId":"<id>","sequence":42,"withdrawn":true,"displayText":"Message withdrawn"}
```

The marker is generated from the current message state at read time. It occupies the message's original sequence and one page slot, so `limit`, `before`, `hasMore` and `nextCursor` continue to use sequence ordering. The marker has no `body`, author, timestamp, anchor, quote, attachment, addressing or recipient field. It does not restore erased content or change the withdrawal transaction. Exact ID outside the selected Camp or current read boundary returns `camp.read_unavailable`, even if a matching withdrawn row exists elsewhere.

A withdrawn thread anchor continues to return `message.withdrawn`. Withdrawal clears the reply association, so a withdrawn reply is not reinserted into its former thread. Automatic `SHARED_CONVERSATION`, mandatory `RUN_INPUT` selection and quote-source validation retain their existing recallable and waiting-Delivery suppression; a direct read or search result does not loosen those paths.
