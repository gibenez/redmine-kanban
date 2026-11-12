# Selected-Sprint Card filters

Status: Implemented and verified.

## Scope

Add a filter row directly below the planning header for the selected Sprint area of the Sprint Board. In the request, “Kanban” means this area, excluding Backlog. Implementation was subsequently authorized with `/implement`.

## Confirmed decisions

### Controls and matching

- Tag extension requested after implementation: add a multi-select Tag dropdown sourced from all planned Swimlane headings, including empty ones, stable under other filters. A Card qualifies when its nearest planned heading has any selected exact, case-sensitive Tag; ignore the Card's own tags and outer ancestors' tags. OR within Tag, AND with other predicates. Ungrouped and flat-mode Cards have no heading tags and do not match active Tag selections. Tag shares persistence, absent-value retention, active-filter detection and Clear filters behavior. This explicitly qualifies the own-Card-only rules below for Tag, not the other controls.
- Layout refinement: contain all controls in a full-width bordered panel, with “Showing X of Y Cards” aligned at the far right, including while Clear filters is visible.
- Provide Search, Project, Assignee, and Priority in the new row, separate from existing Backlog controls and state. The existing Product Project selector continues to set board scope.
- Project, Assignee, and Priority are multi-select controls. Match OR within each control and AND across controls and search. An empty selection imposes no restriction.
- Include an Unassigned assignee choice.
- Match each child Card's own project, assignee, priority, ID, and title. Never match a Swimlane heading's attributes or inherit attributes from ancestors.
- Trim leading/trailing search whitespace. An empty trimmed query imposes no restriction.
- Search titles by case-insensitive literal substring; do not implement tokenization or a query language.
- A digits-only query also matches an exact issue ID: `123` matches issue #123 OR titles containing `123`.
- A query consisting of `#` followed by digits matches only the exact issue ID: `#123` matches only issue #123.
- Apply changes immediately, as search is typed, without an Apply button. Filtering is presentation-only and does not require a new server search.
- Clear filters clears search and all three selections, without changing Backlog controls, Product Project, selected Sprint, or other preferences.

### Grouping and visibility

- Preserve complete Sprint membership and ancestor context before applying Card predicates. Filtering must not remove heading roots from grouping inputs or regroup children under different headings.
- With any active search or dropdown filter, show a Swimlane only when it contains at least one matching child Card. A matching heading alone never keeps it visible.
- Apply the same zero-match rule to Ungrouped.
- Without active filters, preserve current behavior: planned issue-backed headings may be empty, and Ungrouped follows the existing complete-membership emptiness rule.
- Matching children in non-displayed statuses keep their Swimlane visible. Their existing outside-status disclosure contains only matching children.
- With Swimlanes disabled, apply the same predicates to ordinary Cards in the flat view.

### Choices and persistence

- Derive dropdown choices from the complete, unfiltered set of child Cards in the selected Sprint, including non-displayed statuses and excluding heading-only issues.
- Do not narrow available choices based on another active filter or search.
- Persist search and dropdown selections locally per Product Project, scoped to connected server/user. Do not mix accounts' or servers' saved filters.
- Retain selections across Sprint switches, reloads, and refreshes. Switching Product Project restores that project's saved selections.
- Keep saved selected values visible and removable even if absent from the current Sprint's choices. An absent selected value may legitimately yield no matches.

### Feedback and interactions

- Keep planning-header estimated hours, issue count, and unestimated count based on the complete Sprint commitment, including heading issues as today.
- Status Column counts reflect visible Cards.
- Show “Showing X of Y Cards” in the filter row: X is the matching child Card count; Y is the complete child Card count. Both include non-displayed statuses and exclude heading-only issues.
- When active filters match no Cards, show “No Cards match these filters” with Clear filters. Keep controls available.
- Filters do not alter Sprint membership, edit permissions, action eligibility, or the descendants considered by bulk planning actions.
- Reapply predicates after edits, moves, planning operations, and refreshes. A Card that no longer matches disappears from the filtered view.
- Preserve independent Backlog results, loading/error handling, filters, and filter lifetime.

## Acceptance criteria

1. The separate row appears below the planning header and contains accessible Search, Project, Assignee, Priority, and Clear filters controls, following the existing Ring UI-style visual language.
2. Each predicate and all combinations obey the own-Card matching rules, including Unassigned, literal case-insensitive title search, exact numeric ID matching, and `#ID`-only matching.
3. A heading that matches all selected attributes disappears if none of its children match; a nonmatching heading remains if a child matches. Group assignments do not change.
4. Active filters hide zero-match Swimlanes and Ungrouped; clearing all predicates restores original empty-heading behavior.
5. Non-displayed-status matches retain headings and filtered disclosures; flat mode also filters correctly.
6. Choices remain stable under filtering and derive only from complete Sprint Cards, with absent saved selections retained and removable.
7. Persistence isolates Product Projects, users, and servers and survives Sprint switches, reloads, and refreshes. Clear filters resets all four fields only.
8. Header commitment totals remain unchanged, Column counts reflect rendered Cards, and X/Y feedback follows the documented all-status child-Card definition.
9. Filtered-empty feedback and its Clear filters action recover the unfiltered board without affecting Backlog or Sprint selection.
10. Planning actions use full eligible data, not filtered subsets. Updates reapply filters without introducing Backlog coupling or regressions to dragging, reconciliation, focus, and scrolling.
11. Unit and browser tests cover these behaviors, including independent Backlog filtering, and user documentation distinguishes the two filter scopes.

## Documentation and architectural constraints

- ADR 0004 requires planned issue-backed headings even without children. This feature introduces a presentation-only exception while filters are active; explicitly document that qualification without changing membership or grouping rules. Preserve the unfiltered invariant.
- The prior Backlog-only-filter spec's prohibition on a global filter bar refers to shared filters. This is a new, separate selected-Sprint-only row, not restoration of shared scope.
- No new domain terms are required. Follow ADR 0001 for styling and accessibility.

## Implementation tickets

1. [Card predicates and filtered visibility](issues/01-card-predicates-and-visibility.md)
2. [Filter controls, options, and persistence](issues/02-filter-controls-and-persistence.md)
3. [Feedback, integration coverage, and documentation](issues/03-feedback-tests-and-docs.md)

## Comments

- User accepted independent Sprint scope, multi-select OR/AND semantics, immediate application, and per-Product-Project persistence.
- User accepted conditional empty-heading visibility, all-status matching, unfiltered Card-derived choices, full commitment totals, visible counts, and presentation-only planning behavior.
- User added ID/title search and accepted exact ID/literal title semantics, AND combination, shared persistence, and shared Clear filters behavior.
- Design interview complete. Application code has not been changed.
- User subsequently authorized implementation. Added local Card predicates and filtered projection, independent checkbox dropdowns/search, scoped persistence, all-status counts and empty feedback. Updated README, quick guide, and ADR 0004's visibility qualification. Planning inputs remain complete.
- Verification: 130 unit tests and 114 Playwright browser tests pass. Production build succeeds as part of the browser suite. `git diff --check` passes. Browser coverage includes scoped persistence, absent selected values, independent Backlog controls, flat mode, preserved Card identity/search focus, no extra search requests, outside-status matches, complete descendant planning, and narrow-screen keyboard dropdown use.
- Tag extension verification: 133 unit tests and 116 browser tests pass, with production build through the browser suite. Added nearest-heading versus own/outer tags, OR/AND combinations, case sensitivity, stable heading-derived choices, empty heading and Ungrouped exclusion, flat mode, absent saved tags, and Clear filters coverage.
