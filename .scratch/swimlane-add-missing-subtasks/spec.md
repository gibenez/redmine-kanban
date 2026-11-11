# Add missing subtasks to a Sprint

Status: implemented

## Authorization and scope

The user confirmed this design after a grilling session, then authorized implementation with “proceed with implementation”. This spec supersedes the parent-only dragging and prohibition on descendant planning in ADR 0004 and the earlier product Sprint planning spec.

## Eligible missing subtasks

- Traverse descendants at every depth within the selected Product Project and its nested Module Projects.
- Include ordinary issues, both open and closed. Backlog search, Tracker, Assignee, Tag and Show closed filters do not constrain this collection.
- Exclude Swimlane-capable descendants themselves, but traverse through them to collect eligible ordinary descendants.
- A descendant is missing if its configured Sprint field does not contain the selected Sprint. An empty field and membership in other Sprints both qualify; membership in the selected Sprint alongside others does not.
- Append the selected Sprint without replacing other memberships. Preserve status and Target version for every descendant.
- Membership determines visibility independently for each issue. Group added Cards under their nearest planned qualifying ancestor, even if that differs from the header where the action began. Issues outside displayed statuses remain accessible through the existing heading notice.

## Header action

- Place an accessible “Add missing subtasks” button at the extreme right of each issue-backed Swimlane header; no such action on Ungrouped.
- Require attention whenever at least one eligible descendant is missing the selected Sprint, including descendants assigned only to other Sprints.
- Disable when no eligible descendants are missing. Closed Sprints remain read-only.
- Clicking immediately starts the operation, without a confirmation dialog or per-issue selection.
- Change only descendant Sprint memberships; do not change the heading issue or create memberships for excluded Swimlane-capable descendants.
- Discover actual descendants; currently loaded Sprint Cards and paginated Backlog results are not a complete candidate set.
- An unreadable hierarchy is an error/unknown state, never evidence that nothing is missing.

## Backlog drag action

- Dragging a Swimlane-capable issue from Backlog into the selected Sprint plans the parent and the same eligible missing descendants defined above.
- Set the parent's status to “opened” regardless of the destination Column. Descendant statuses remain unchanged.
- Introduce an explicit deployment setting `openedStatusId`, validated against Redmine as an existing nonclosed status. Do not infer it from a name, numeric convention or Column position.
- If the parent already has that status, no transition is required. Otherwise validate the transition against Redmine's allowed statuses during preflight. A forbidden or unverifiable required transition aborts the entire operation before any writes.
- Preserve the parent's Target version and existing Sprint memberships.
- This decision concerns dragging from Backlog, not changing the individual planner into a cascading action. Sprint headings remain non-draggable; no bulk removal is introduced.

## Safety and partial results

- Validate the complete eligible candidate set, hierarchy readability, Sprint memberships, product scope, selected Sprint openness and required parent transition before writing.
- Missing or unreadable Sprint-field data must not be interpreted as an empty field. If it prevents validating an otherwise eligible candidate, fail preflight rather than silently claiming the complete set was added.
- Re-read issues before updating and calculate append-only membership changes from fresh values. Respect field cardinality: never replace another membership to work around a scalar field.
- Send changed attributes only and verify retained values. Do not issue unnecessary writes for already satisfied memberships.
- If a write fails or its result is unconfirmed, stop further writes, refresh confirmed state, and report added, failed/unconfirmed and not-attempted issues. Do not describe an uncertain write as definitely failed.
- No automatic rollback or write retry. If refresh also fails, explicitly report that the displayed state may be stale.

## Acceptance scenarios

1. A header with an empty-Sprint child requires attention; clicking appends the selected Sprint immediately.
2. A child assigned only to another Sprint also triggers attention; adding preserves that Sprint and appends the selected one.
3. A child already assigned to the selected Sprint and another Sprint is skipped. A header with no missing eligible descendants is disabled.
4. Closed descendants are included even when Show closed is off; no descendant status or Target version changes.
5. Grandchildren and deeper ordinary descendants are included, including through nested Swimlane-capable issues; those nested candidates themselves are not added.
6. An added descendant beneath an already planned nested parent appears under that nearer heading. Ungrouped has no header action.
7. Backlog presentation filters and pagination do not hide eligible descendants from collection.
8. Dropping a Backlog parent in any Sprint Column adds parent and eligible descendants, sets only the parent to `openedStatusId`, and preserves other memberships and all Target versions.
9. A parent already opened needs no transition. A forbidden or unverifiable required transition prevents every write.
10. A closed Sprint, unreadable hierarchy, invalid membership or unsupported additional scalar membership prevents writes during preflight; unknown data does not appear as an all-clear attention state.
11. A mid-operation failure stops further writes and reports confirmed additions, failed/unconfirmed writes and unattempted issues after refresh, without rollback or retry.

## Documentation and implementation follow-up

ADR 0004 records the accepted amendment; the glossary keeps independent issue membership distinct from operations that plan several issues. Implementation includes drag/header tests, configuration loading and deployment wiring, hierarchy collection, write orchestration, runtime help and user documentation. `OPENED_STATUS_ID` / `openedStatusId` is required and deliberately has no inferred default. Hierarchy visibility remains bounded by Redmine's API permissions; omitted children cannot be detected if Redmine silently hides them.

Validation: 103 unit/configuration tests and 92 browser tests passed. Browser validation includes the production asset build. Container configuration tests exercise the actual shell/jq generator without writing into nginx's production directory; these tests require `jq` on the test host.
