# Hide empty Ungrouped

Status: implemented

## Agreed behavior

The user confirmed this design after a grilling session and authorized implementation with `/implement`.

- When Swimlanes are enabled, show Ungrouped only if at least one issue in the selected Sprint belongs to Ungrouped under the existing grouping rules.
- Determine emptiness across all statuses, not just the statuses displayed as Columns. An Ungrouped issue outside the displayed statuses keeps the heading and its existing notice visible.
- Hide the entire Ungrouped section, including its heading and empty drop areas, when no Ungrouped issues remain.
- Update visibility automatically as Sprint membership or grouping changes: hide when the last Ungrouped issue leaves, and show when an issue becomes Ungrouped.
- Hide Ungrouped in a completely empty Sprint.
- When present, Ungrouped remains last.
- Preserve empty issue-backed Swimlane headings.
- Do not add a visibility toggle or change grouping rules, drag-and-drop semantics, Backlog filtering, or the flat view used when Swimlanes are disabled.

## Acceptance scenarios

1. An empty Sprint has no Ungrouped heading or drop areas.
2. A Sprint containing only issue-backed Swimlane headings and their grouped Cards has no Ungrouped section; empty issue-backed headings remain visible.
3. A Sprint with at least one Ungrouped issue displays Ungrouped last.
4. An Ungrouped issue whose status is outside the displayed Columns keeps Ungrouped visible and remains accessible through its heading notice.
5. Removing or regrouping the last Ungrouped issue hides the section after the board updates.
6. Adding an Ungrouped issue, or regrouping a remaining Sprint issue into Ungrouped, makes the section appear again.
7. Disabling Swimlanes preserves the existing flat view.

## Implementation context

`src/swimlanes.js` includes Ungrouped only when its full issue set is nonempty. `src/board-view.js` keeps empty Sprint Columns available as drop targets when no Swimlane sections remain. Empty issue-backed headings and issues outside displayed statuses are preserved.

Validation: all 123 unit tests and 107 browser tests passed. Browser validation includes a production build and covers automatic hiding/reappearance, outside-status notices, empty issue-backed headings, and dragging from Backlog into an empty Sprint.
