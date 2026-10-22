# Category-scoped Build issue sprints

Confirmed with the user before implementation.

## Behavior

- Keep version-based planning as the default; add deployment-configured Build-issue mode.
- In Build mode show Project → Category → Sprint. Categories include Uncategorized; no All categories sprint selection. Load category IDs/names via project metadata (`/projects/:id.json?include=issue_categories`), not the standalone category-management endpoint, so contributors do not need Manage categories permission.
- Find the enabled Build tracker by configured ID, falling back to the exact name Build when no ID is configured. Report a clear error when unavailable.
- Sprint candidates are Build issues of the selected project/category. Display subject plus issue ID, newest ID first. The issue status's closed flag controls the existing closed-sprints toggle. Closed sprints are read-only.
- Remember the last category per project and sprint per category. Fall back to the alphabetically first category and newest open Build. An empty category keeps backlog usable but disables planning; do not create Builds automatically.
- Membership is a symmetric Redmine relates relationship. Multiple Build memberships are valid. Removing membership deletes only the selected Build's relates link and preserves all other relationships.
- Build issues are containers, never cards. Board scope excludes other projects/subprojects, but selected-sprint cards may have any category in the selected project.
- Backlog contains open issues without any open Build membership, narrowed by the existing New/all-open preference. Closed Build relations are history and do not block backlog.
- Category filtering applies to backlog only, starts enabled, is remembered per project and has a separate toggle/tooltip. Turning it off permits cross-category planning without changing the issue Category.
- Dragging retains status-column semantics; removing membership does not reset status. The keyboard planner follows the same rules.
- Target versions are entirely ignored and must never be written, cleared, or migrated in Build mode.
- Relation and field updates are not transactional. Verify actual state, report observed partial success/failure, reload the board, and never blindly roll back concurrent edits.

## Regression notes

- Redmine's relation REST payload uses `issue_id` for the source and `issue_to_id` for the destination, not the internal model attribute `issue_from_id`. Using the internal name made successful writes falsely report membership absent and hid existing sprint members. Corrected parser and all relation fixtures to the wire contract; a browser regression covers dragging to New, read-back success, refresh, editor membership and removal without touching unrelated links or target versions. Source: [Redmine 5.1 relation serialization](https://github.com/redmine/redmine/blob/5.1-stable/app/views/issue_relations/index.api.rsb).

## Validation

Unit tests cover mode validation, symmetric membership, history, pagination/cancellation, closed/workflow guards, partial writes, no-ops and preservation of target versions. Browser tests cover selectors, category scope, dragging, cross-category planning, read-only closed Builds and partial-save recovery. Docker smoke tests exercise runtime configuration and the restricted category/relation proxy endpoints.
