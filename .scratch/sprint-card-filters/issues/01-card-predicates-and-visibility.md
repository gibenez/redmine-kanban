# Card predicates and filtered visibility

Status: ready-for-agent
Type: task

## Scope

Implement the matching and grouping behavior in [the spec](../spec.md), keeping complete membership separate from visible Cards.

- Separate selected-Sprint filter state from Backlog filters.
- Support multi-value project, assignee (including Unassigned), and priority predicates and the specified ID/title search.
- Preserve complete heading/ancestor context and nearest-planned-ancestor grouping.
- Hide zero-match Swimlanes/Ungrouped only while filters are active; preserve existing unfiltered empty headings.
- Filter outside-status disclosures and flat-mode Cards consistently.
- Reapply predicates after data changes; never narrow planning-action inputs.

## Likely code locations

- `src/swimlanes.js`
- `src/main.js`
- `tests/swimlanes.test.js`

## Acceptance criteria

Cover spec criteria 2–5 and the matching/data-isolation portions of criterion 10 with unit tests. Verify parent attributes cannot keep a lane visible and filtering cannot regroup a matching child.

## Comments

- Implemented in `src/sprint-filters.js` and integrated in `src/main.js`. Full membership and ancestor context remain intact; planning inputs are unchanged. Unit and browser coverage pass; see the spec for verification totals.
