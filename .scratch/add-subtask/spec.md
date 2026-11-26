# Create a subtask from a Swimlane

Status: confirmed

## Agreed behavior

- Each issue-backed Swimlane has an always-visible, low-emphasis `+ Add Subtask` button at the bottom-left of its configured New status cell, below Cards in normal layout, including empty cells. Keep an 8px bottom gap and an 8px left gap measured from the priority stripe's inner edge when present. Ungrouped has no button. Other Columns have no button. If New is not displayed, no button is rendered.
- Closed parents and closed Sprints disable creation with an explanation. Existing issue viewing remains available.
- Reuse the Card issue editor in creation mode. Render Parent and Sprint as labeled plain text in the attributes section, with no inputs or separate Open parent link. Only the parent's issue ID links to Redmine; its subject is unlinked text. Status and Priority remain labeled read-only inputs. The selected Sprint and configured New status are fixed; Priority displays Redmine default.
- Project requires an explicit choice, initially blank. Offer visible Projects in the selected Product Project hierarchy with at least one enabled non-Swimlane tracker. User may choose a different Project from the parent's; Redmine enforces cross-project parent permissions.
- Tracker choices follow the chosen Project and exclude Swimlane-capable trackers. Automatically select a sole eligible tracker; otherwise require a choice.
- Title and Description start blank, Assignee unassigned, Priority uses Redmine's default. Do not copy parent content, assignee, Target version, or all of its Sprint memberships. Assign only the selected Sprint using the configured custom field; preserve its scalar/multiple representation.
- Save creates one child, verifies retained fields, closes the editor and refreshes the board. Existing Card filters remain unchanged. Show success with an issue ID/link; explain if the new Card is hidden by filters or visibility rules.
- The editor footer places validation/server messages at the bottom-left and Save at the bottom-right, including narrow viewports and creation drafts without an issue link. Keep 16px between the New subtask heading and title field.
- Cancel creates nothing. Closing a dirty draft asks before discarding.
- Re-read parent, Sprint and Project/tracker scope before POST. Stop if the Sprint is no longer open, parent is closed, outside scope, no longer Swimlane-capable, or no longer belongs to the selected Sprint. This is preflight, not transactional locking against concurrent Redmine changes.
- Redmine controls creation permissions, initial-status permission, assignee validity, custom-field applicability and required fields. Show errors and preserve the draft. This version does not provide a dynamic required-field form.
- Do not retry POST automatically. After uncertain POST failures disable Save for that draft and direct the user to check Redmine before starting again. Once a created issue ID is known, report it and never repeat creation if read-back or refresh fails.

## Integration

- Add `RedmineClient.create(patch)` posting `{ issue: patch }` to `/issues.json`.
- Narrowly extend the production allowlist to permit `POST /redmine/issues.json`; no other new methods or paths.
- Preserve Card DOM identity, drop-target membership, scroll positions, row alignment and existing update-editor behavior when adding the cell action footer.

## Verification

Unit coverage: Project/tracker choices, stale context, payload, scalar/multiple Sprint values, read-back checks, API creation without retries, proxy restrictions, footer reconciliation/alignment.

Browser coverage: placement and empty rows, selection/defaults, creation and Card refresh, filtering, cancellation, validation errors, stale context, uncertain writes and closed-state restrictions.

## Implementation outcome

Implemented in `src/subtask-creation.js`, the shared editor lifecycle in `src/main.js`, the optional cell-action contract in `src/board-view.js`, and the API/proxy integration. README and in-app help describe creation and its limits.

Validation:
- Production build passes.
- Full browser suite after attributes/footer refinements: 267 passed, including 17 creation-flow tests. Geometry assertions cover the cell action's bottom-left spacing, title spacing, and footer error/Save alignment at desktop and narrow widths; context fields are asserted read-only in the attributes section.
- Feature-related unit suites: 81 passed.
- Full unit suite: 285 passed, 1 failed. The Backlog visible-label assertion in `tests/sprint-filter-controls.test.js:17` also fails on an isolated archived `HEAD`, confirming it predates this feature.
- Docker proxy/config/security checks passed; the initial full Docker browser run did not pass (legacy unscoped control locators, subsequently fixed, and public-URL fixture mismatches). No live Redmine creation was performed.
- Whitespace checks pass.
