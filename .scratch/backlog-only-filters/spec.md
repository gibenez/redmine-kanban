# Backlog-only filters

Status: Implemented and verified.

## Requested behavior

- Search, Tracker, Assignee, and Backlog tag filter only Backlog issues, not the selected Sprint's Cards or Swimlanes.
- Tracker choices are limited to configured Swimlane-capable tracker types.

## Confirmed decisions

- Put Search backlog inline with the Backlog heading. Put Tracker, Assignee and Backlog tag below the heading in a “Backlog filters” disclosure that starts collapsed (user's follow-up supersedes the original all-four-below-heading layout).
- Keep the search accessible as “Search backlog”.
- Latest UI refinement: search placeholder is “Search”. A tiny chevron button immediately to its right toggles the initially hidden filter panel; remove the separate “Backlog filters” disclosure row and unused heading space. Move Show closed from the header into this panel as a “Show closed issues” checkbox with description “Include closed issues in Backlog.” Retain its existing remembered preference and Clear filters behavior.
- Keep the controls above the Backlog issue scroll area, so they remain visible while its issues scroll.
- When filters produce no matches, show “No backlog issues match these filters” and a “Clear filters” action. Keep the controls visible.
- Clear filters resets Search, Tracker, Assignee, and Backlog tag only; it does not change Show closed or the selected Sprint.
- Backlog filtering must leave selected-Sprint content and interactions unchanged, including while loading or on failure. It must not cancel dragging or disable Sprint planning actions.
- Collapsing Backlog hides its filters and retains their values. Show a small “Filtered” indicator on its collapsed heading when any of the four filters is active.
- Tracker choices include configured Swimlane-capable tracker types available in the Product Project or its Module Projects, including choices with no current Backlog matches. Exclude unrelated projects and ordinary tracker types.
- Label the default tracker choice “All eligible trackers”. Clear a selected tracker if it becomes invalid; disable the dropdown when no eligible trackers are available.
- Retain filters during Sprint switches and in-app refreshes. Clear all four on Product Project change, sign-out, or page reload. Do not introduce persistent filter storage.

## Acceptance criteria

1. All four filters are contained in Backlog; search is inline in its header, and the other three are in a disclosure that starts collapsed. No global filter bar remains above the Sprint Board.
2. Each filter, alone or in combination, narrows only Backlog results. Selected-Sprint Cards, Swimlane headings, totals, and notices do not change because of these filters.
3. Loading, failed, and superseded Backlog searches do not disrupt selected-Sprint interactions. Backlog retains appropriate loading/error feedback.
4. Tracker options follow configured Swimlane eligibility and Product Project scope, regardless of which issues have been loaded.
5. Scrolling, collapse, filtered-empty state, Clear filters, and filter lifetime follow the confirmed decisions above.
6. Existing exact, case-sensitive Backlog tag matching and Backlog eligibility rules remain unchanged.
7. Replace tests that encode shared Sprint filtering with Backlog-only assertions. Preserve coverage for pending/failed/superseded searches, focus and scroll stability, pagination reset, server-side matching, and compact layouts.
8. Update user-facing documentation/help that describes filters as affecting the entire Sprint Board. Remove or replace filtered-Sprint messaging made obsolete by Backlog-only filtering.

## Documentation scope

This is a reversible UI/filter-scope change; no new ADR is needed. Existing glossary terms suffice, and Backlog membership remains unchanged.

## Terminology

The glossary calls the overall surface the Sprint Board. In this request,
“Kanban” refers to its selected-Sprint area, excluding Backlog.

## Existing behavior to change

- Search, Tracker, and Assignee currently filter both Sprint and Backlog results.
- Backlog tag is already Backlog-only.
- Filters currently sit above the entire Sprint Board.
- Changing filters currently invokes shared loading behavior that can cancel dragging and disable planning actions.

## Comments

- User confirmed the recommended placement and labels. Remaining decisions are not yet agreed.
- User subsequently accepted all recommendations for empty results, interaction isolation, scrolling/collapse, tracker eligibility, and filter lifetime. No design questions remain open; final shared-understanding confirmation is pending.
- User confirmed the complete design summary. The interview is complete; this spec is ready for implementation planning.
- User authorized implementation. Controls now live inside Backlog; queries and loading locks are Backlog-scoped. Added coverage for eligible Module tracker metadata, disabled tracker configuration, pending-search Sprint dragging/editing, filter lifetime, and Clear filters. README and quick guide reflect the new behavior.
- Verification: 77 unit tests and 88 Playwright browser tests pass. Production build succeeds as part of the browser suite; git diff whitespace checks pass.
