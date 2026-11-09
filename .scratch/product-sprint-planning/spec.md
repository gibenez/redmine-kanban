# Product Sprint membership and context-only Swimlanes

Status: confirmed-design

## Goal and authorization

Plan product-wide Sprints across module subprojects without consuming Redmine's standard Target version field, and make Swimlanes grouping context independent of parent Sprint membership.

The user confirmed the complete design with “yes, i confirm”. This authorizes recording the spec, glossary and replacement ADR, not implementation. Implementation has not started.

## Sprint membership

- One product version represents exactly one Sprint; no additional Sprint entity or release-to-multiple-Sprints model.
- Require a deployment-wide numeric custom-field ID identifying a single-valued Redmine Version issue field. Enable that same field on the relevant projects and trackers.
- Read, query, set, clear and verify Sprint membership exclusively through that field. No Target-version mode or fallback.
- An issue has zero or one Sprint. Empty means Unplanned; a missing or unreadable field does not mean empty.
- Preserve module Target versions in all board actions. No automatic migration, remote data deletion or copying from existing Target versions.
- Selectable Sprints are versions owned by the selected Product Project and shared with its descendants; exclude module releases and versions merely shared from other owning projects.
- Retain existing Sprint lifecycle behavior: open Sprints are editable, optionally displayed closed Sprints are read-only, locked versions are excluded, and lifecycle is managed in Redmine.

## Board boundary

- Include issues in the selected Product Project and all nested subprojects.
- Exclude projects outside that hierarchy, even if they share the selected version.
- Apply the boundary to feeds and descendant-planning operations. Current queries explicitly exclude subprojects and must change during implementation.

## Context-only Swimlanes

- Configured tracker types identify Swimlane-capable issues. These never render as Sprint Cards or receive Sprint planning actions themselves; ignore their own Sprint values without clearing or changing them.
- Group each Sprint Card under its nearest Swimlane-capable ancestor at any depth. Unplanned intermediate ancestors do not break grouping.
- A parent heads a Swimlane only when at least one Card in the selected Sprint groups beneath it. Cards without such an ancestor remain Ungrouped.
- A parent heading a Swimlane disappears from Backlog. Otherwise it remains a Backlog shortcut, including when its descendants belong to other Sprints or no eligible Unplanned descendants remain.
- With nested qualifying ancestors, only the ancestor actually supplying the Swimlane disappears from Backlog; outer ancestors do not disappear merely because a deeper descendant is planned.
- Swimlane headings remain available whether the parent is open or closed. Their visibility does not depend on the Backlog closed-parent toggle.
- Backlog parent shortcuts are open-only by default, independent of the configured New status. An icon button labeled/tooltipped “Show closed” toggles closed parent shortcuts, has an accessible pressed state, and persists its preference locally.
- “Show closed” applies to parent shortcuts only; it does not admit closed ordinary Cards or make closed descendants eligible for planning.

## Descendant-planning shortcut

- Allow dragging a Swimlane-capable Backlog shortcut into the selected Sprint, with confirmation of the eligible issue count and scope before writes.
- Traverse descendants at all depths inside the product hierarchy. Exclude every Swimlane-capable issue, including nested parents; do not write the dragged parent.
- Add only open, Unplanned descendants eligible under the current Backlog Scope: configured New status only, or every open status, as selected.
- Ignore presentation filters such as search and assignee when collecting candidates, and explain that scope in confirmation.
- Leave descendants already in the selected Sprint unchanged. Leave those in another Sprint unchanged and report the skipped count.
- Disable drag-to-plan when no eligible Unplanned descendants remain, while retaining the shortcut's visibility according to the rules above.
- Change only the Sprint custom field. Preserve every status, regardless of the drop Column, and preserve Target versions.
- Swimlane headings are non-draggable. Remove the old parent-inclusive group operations and bulk-removal action. Individual Cards remain independently plannable, removable and movable between status Columns.

## Failure and concurrency behavior

- Invalid, unavailable or unreadable Sprint-field configuration produces a clear configuration/access error. Never infer empty membership from absence and never fall back to Target version.
- Block planning for affected issues. Abort a bulk add before writes if a potentially eligible descendant's membership cannot be determined; retain the existing fail-before-write behavior for an unreadable hierarchy.
- Recheck scope, membership and Sprint editability before writes. Skip/report concurrent changes rather than overwrite them.
- Verify individual updates and report successes, skips and failures. Redmine writes are not atomic; do not retry or roll back automatically.
- Refresh after the operation. A parent becomes a Swimlane as soon as a successfully planned Card groups beneath it, even when other writes failed.

## Acceptance scenarios

1. A module issue with Target version “Module A 3.2” and no Sprint is Unplanned. Adding it to “Product 2026.11” sets only the custom field; removing it clears only that field.
2. Selecting a Product Project includes issues from nested Module Projects, but not unrelated projects sharing its Sprint version. The Sprint selector contains only eligible product-owned versions.
3. An unplanned Feature with a Task in the selected Sprint supplies a Swimlane and is absent from Backlog. Its own Sprint value, if set externally, neither creates membership nor changes grouping.
4. A Feature whose children belong only to another Sprint remains a Backlog shortcut. With no eligible Unplanned descendants, its drag action is disabled.
5. Given Epic → Feature → Task with both ancestors Swimlane-capable, a planned Task appears under Feature. Feature leaves Backlog; Epic remains there unless it independently heads another Swimlane.
6. Dragging an Epic with nested Feature parents plans only eligible Unplanned ordinary descendants across the product hierarchy. It changes neither parent, skips already-planned work, ignores search/assignee filters, and preserves statuses and module Target versions.
7. Backlog Scope restricts bulk-add candidates. “Show closed” reveals closed parent shortcuts only; it does not make closed descendants eligible. A closed parent remains a Sprint heading when needed even with the toggle off.
8. A missing custom field is not treated as Unplanned. An unreadable potentially eligible descendant aborts bulk planning before any write.
9. A concurrent membership change is not overwritten. Partial success is reported without rollback; refreshed Swimlane/Backlog placement reflects actual retained membership.
10. No bulk-removal control or draggable Sprint heading remains. Ordinary Card planning, removal and workflow changes still work independently.

## Implementation follow-through (not performed)

- Replace fixed-version assumptions in membership, feeds, individual edits, verification and hierarchy actions with custom-field behavior.
- Broaden project scope deliberately rather than relying on Redmine query defaults; validate product-version ownership and availability.
- Add required configuration plumbing and validation across browser, development and Docker runtime paths. Ordinary-user metadata visibility is limited in Redmine; do not assume admin-only custom-field discovery is available.
- Update current user/setup documentation and tests for the confirmed model. Historical specs remain historical.
- Cover the acceptance scenarios in applicable unit/browser tests and production configuration checks; report any live Redmine assumptions that cannot be verified.

## Decision record

See [ADR 0004](../../docs/adr/0004-product-sprints-and-context-only-swimlanes.md), superseding ADR 0003. Build-issue relation-based Sprints remain retired.
