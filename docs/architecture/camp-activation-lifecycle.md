---
document_type: architecture
authority: camp-activation-component-boundary
status: accepted
last_updated: 2026-09-18
---

# Camp Activation Lifecycle

## Component authority

| Component | Responsibility |
| --- | --- |
| Rust Host / Core | Stores the shared one-click preference and saved default member/Lead configuration under the instance data root; see [Host Web v2](../contracts/host-web-v2.md#shared-creation-preferences). |
| Electron Main | Imports legacy creation preferences once through Core and adapts local presentation preferences; it does not store Camp activation or public Composer content. |
| Renderer | Chooses `pending` for a valid one-click entry and `active` for the explicit Dialog. A pending Camp's unsent input, quotes and attachment references exist only in the currently mounted Renderer. |
| Core collaboration service | Validates creation structure, persists Camp activation, guards pre-activation mutation/discard, and activates a Pending Camp in the first accepted public-message transaction. |
| Navigation / Read Model | Lists Active Camps. A newly created Pending Camp is only the current transient surface; it is not a restorable or navigable Draft. |
| SQLite startup recovery | Removes Pending Camps that still satisfy the empty initial-state predicate. It never reconstructs public Composer input. |

## State flow

```text
one-click entry
  -> camps.create(pending)
  -> current Renderer opens an empty local Composer
     -> send rejected/failed: local input remains in that mounted Renderer
     -> send accepted transaction:
          Active + camp.activated + CampMessage + waiting Deliveries
     -> switch / refresh / close before send:
          local input is not persisted or restored
          empty Pending Camp remains hidden and is eligible for guarded cleanup

explicit Dialog
  -> camps.create(active)
  -> durable zero-message Camp
```

The first accepted send is the only Pending-to-Active transition. It validates the one frozen local send snapshot and,
in one Core transaction, activates the Camp, publishes the message and creates target Deliveries. A rejection or
rollback leaves the Camp Pending and does not clear the mounted Renderer input.

Renderer navigation may wait for an already-started local quote or source-attachment operation to settle before
unmounting. That wait is not autosave, a durable leave guard or a restoration promise. Public Composer state is never
written to Core merely because the user switches Camps, refreshes, closes a window or exits the App.

## Invariants

- A Pending Camp cannot have an accepted public message; its first accepted public send activates it atomically.
- Active never transitions back to Pending.
- A Pending Camp is not made navigable or restorable by unsent Renderer content.
- `camps.discardPending` and startup cleanup may delete only an otherwise untouched empty Pending Camp.
- Single Chat's private Draft/Pending lifecycle is independent and unchanged.

## References

- [Camp lifecycle invariants](foundational-invariants.md#camp-lifecycle)
- [Pending Camp Activation v2](../contracts/pending-camp-activation-v2.md)
- [Camp Composer Draft v14](../contracts/camp-composer-draft-v14.md)
