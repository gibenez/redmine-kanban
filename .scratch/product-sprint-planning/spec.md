# Product Sprint membership and context-only Swimlanes

Status: implemented

## Latest confirmed revision: independent membership for all issues

This section supersedes the earlier context-only parent and descendant-planning rules below, which record the earlier design history.

- Every issue, including Swimlane-capable issues, belongs to the selected Sprint if and only if its own configured field contains the selected version.
- Render a heading for every planned Swimlane-capable issue, including empty headings. Its children do not create or remove that heading.
- A child appears only through its own membership. Group it under its nearest planned qualifying ancestor; otherwise use Ungrouped. Unplanned ancestors are traversal context only.
- Planning or dragging a parent updates only that parent. Remove descendant bulk planning and its implementation/tests; no implicit child or sibling writes remain.
- Retain multiple-value append/remove-only-selected behavior, missing-field exclusion, product scope, filters and Show closed for Backlog parents. Parents absent from the selected Sprint remain available in Backlog under the existing parent visibility rules.
- Verified: 69 unit tests and all 81 browser tests passed; browser run includes the production asset build. New coverage checks empty planned headings, unplanned-parent children under Ungrouped, parent-only writes, independent child membership, multi-value preservation and closed-parent visibility.

## Goal and authorization

Plan product-wide Sprints across module subprojects without consuming Redmine's standard Target version field, and make Swimlanes grouping context independent of parent Sprint membership.

The user confirmed the complete design with “yes, i confirm”, then authorized implementation with “commit, and then let's proceed with the implementation”. The design was committed as `16266f1` before implementation began.

## Sprint membership

- One product version represents exactly one Sprint; no additional Sprint entity or release-to-multiple-Sprints model.
- Require a deployment-wide numeric custom-field ID identifying a Redmine Version issue field. Support multiple values, with scalar single-value fields also readable. Enable that same field on the relevant projects and trackers.
- Read, query, set, clear and verify Sprint membership exclusively through that field. No Target-version mode or fallback.
- An issue can belong to multiple Sprints. Membership means the field contains the selected version. Empty means Unplanned; a missing or unreadable field does not mean empty. Add appends without duplicates; removal removes only the selected Sprint, preserving all other values.
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
- Add open descendants eligible under the Backlog Scope's status rule: configured New status only, or every open status, as selected. Existing membership in other Sprints does not disqualify a descendant.
- Ignore presentation filters such as search and assignee when collecting candidates, and explain that scope in confirmation.
- Leave descendants already in the selected Sprint unchanged. Append the selected Sprint to other eligible descendants, preserving existing memberships, including changes read immediately before the write.
- Disable drag-to-plan when no eligible descendants missing the selected Sprint remain, while retaining the shortcut's visibility according to the rules above.
- Change only the Sprint custom field. Preserve every status, regardless of the drop Column, and preserve Target versions.
- Swimlane headings are non-draggable. Remove the old parent-inclusive group operations and bulk-removal action. Individual Cards remain independently plannable, removable and movable between status Columns.

## Failure and concurrency behavior

- Issues whose API response omits the configured Sprint field are excluded from board Cards, parent shortcuts/headings and descendant-planning candidates, even if omission is caused by permissions. Continue traversal through excluded ancestors to find eligible descendants. Never infer empty membership from absence or fall back to Target version.
- Present invalid values remain errors; multi-valued arrays are supported. Abort a bulk add before writes for an invalid candidate value; retain fail-before-write behavior for an unreadable hierarchy.
- Recheck scope, membership and Sprint editability before writes. Skip/report concurrent changes rather than overwrite them.
- Verify individual updates and report successes, skips and failures. Redmine writes are not atomic; do not retry or roll back automatically.
- Refresh after the operation. A parent becomes a Swimlane as soon as a successfully planned Card groups beneath it, even when other writes failed.

## Acceptance scenarios

1. A module issue with Target version “Module A 3.2” and no Sprint is Unplanned. Adding it to “Product 2026.11” sets only the custom field; removing it clears only that field.
2. Selecting a Product Project includes issues from nested Module Projects, but not unrelated projects sharing its Sprint version. The Sprint selector contains only eligible product-owned versions.
3. An unplanned Feature with a Task in the selected Sprint supplies a Swimlane and is absent from Backlog. Its own Sprint value, if set externally, neither creates membership nor changes grouping.
4. A Feature whose children belong only to another Sprint remains a Backlog shortcut and can append the selected Sprint. With no eligible descendants missing that Sprint, its drag action is disabled.
5. Given Epic → Feature → Task with both ancestors Swimlane-capable, a planned Task appears under Feature. Feature leaves Backlog; Epic remains there unless it independently heads another Swimlane.
6. Dragging an Epic with nested Feature parents appends the selected Sprint to eligible ordinary descendants across the product hierarchy. It changes neither parent, skips work already containing the selected Sprint, ignores search/assignee filters, and preserves existing Sprint values, statuses and module Target versions.
7. Backlog Scope restricts bulk-add candidates. “Show closed” reveals closed parent shortcuts only; it does not make closed descendants eligible. A closed parent remains a Sprint heading when needed even with the toggle off.
8. A missing custom field is not treated as Unplanned: skip that issue and continue planning eligible descendants. A present invalid value or unreadable hierarchy aborts bulk planning before any write.
9. A concurrent membership change is not overwritten. Partial success is reported without rollback; refreshed Swimlane/Backlog placement reflects actual retained membership.
10. No bulk-removal control or draggable Sprint heading remains. Ordinary Card planning, removal and workflow changes still work independently.

## Implementation follow-through

- Replace fixed-version assumptions in membership, feeds, individual edits, verification and hierarchy actions with custom-field behavior.
- Broaden project scope deliberately rather than relying on Redmine query defaults; validate product-version ownership and availability.
- Add required configuration plumbing and validation across browser, development and Docker runtime paths. Ordinary-user metadata visibility is limited in Redmine; do not assume admin-only custom-field discovery is available.
- Update current user/setup documentation and tests for the confirmed model. Historical specs remain historical.
- Cover the acceptance scenarios in applicable unit/browser tests and production configuration checks; report any live Redmine assumptions that cannot be verified.

## Decision record

See [ADR 0004](../../docs/adr/0004-product-sprints-and-context-only-swimlanes.md), superseding ADR 0003. Build-issue relation-based Sprints remain retired.

## Implementation outcome

Multiple-membership clarification: the user configured a multiple-value Version field and confirmed append semantics for individual and descendant additions, including descendants already in other Sprints. Remove only the selected value; issues with remaining values do not return to Backlog. Status is shared issue data and affects every Sprint containing that issue. This supersedes the original single-membership and Unplanned-only bulk-add restrictions.

Multi-value follow-up validation: 76 unit tests passed; the complete 89-test browser suite passed, followed by all 16 Swimlane browser tests including the new selected-value-removal scenario. Production-container revalidation was attempted but timed out fetching nginx image metadata before the build completed; the previous production checks below predate multi-value support.

Follow-up clarification: the user confirmed the field is not enabled for every tracker and requested completely skipping issues without it. Missing-field issues are now excluded rather than failing refresh or bulk preflight; present malformed values still fail safely.

- Implemented custom-field membership, explicit product/descendant query scope, product-owned shared version selection, context-only nearest-ancestor grouping, Backlog shortcuts and the locally remembered Show closed toggle.
- Descendant planning adds eligible Unplanned work only, preserving parent fields, statuses, Target versions and other Sprint memberships. Missing membership blocks planning; individual and bulk writes recheck scope/membership and verify retention.
- Added required `SPRINT_FIELD_ID` / `sprintFieldId` configuration through Vite, Compose and Docker startup, with no usable default. Updated setup/upgrade documentation; did not guess a field ID or modify local credentials/configuration.
- No live Redmine requests, data migration or remote writes were performed. Tests use simulated Redmine responses. An administrator must verify the real field's Version format, single-value/filter settings, visibility, edit permissions and allowed shared versions; ordinary-user REST responses do not provide authoritative global field metadata.

Validation:

- `npm test`: 73 tests passed across 7 files.
- `npm run test:e2e`: all 89 tests passed, including the final confirmation wording.
- `bash tests/docker-smoke.sh`: production image build, required/invalid Sprint-field configuration, proxy/security checks and all 89 browser tests passed, including the additional configuration, concurrency and exact-tag scenarios.
- `git diff --check`: passed.
