# Feedback, integration coverage, and documentation

Status: ready-for-agent
Type: task
Blocked by: 01, 02

## Scope

Complete feedback, integration validation, and documentation for [the spec](../spec.md).

- Add Showing X of Y Cards and filtered-empty feedback with Clear filters.
- Preserve complete commitment totals and use visible Cards for Column counts.
- Verify all-status counts exclude headings and disclosures only show matching children.
- Exercise updates, planning actions, flat mode, dragging, focus/scroll stability, and independent Backlog behavior while Sprint filters are active.
- Update README/help to distinguish Backlog controls from the selected-Sprint filter row and explain persistence and search semantics.
- Qualify ADR 0004's heading-visibility statement with the agreed active-filter presentation exception, preserving its membership/grouping decisions and unfiltered behavior.

## Acceptance criteria

Cover spec criteria 8–11 and end-to-end regression coverage for the remaining criteria. Run the project's relevant unit/browser checks and production build; record actual results without claiming unrun verification.

## Comments

- Implemented visible/all Card counts and filtered-empty feedback while preserving commitment totals. Updated README, quick guide, and ADR 0004. Verification: 130 unit tests and 114 browser tests pass, production build succeeds through the browser suite, and whitespace checks pass.
