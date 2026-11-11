# Separate product Sprint membership from module releases and Swimlane context

Status: accepted; implemented.

Backlog amendment: show only Swimlane-capable issues whose own Sprint field is empty. Issues assigned to any Sprint and ordinary issues are excluded from Backlog. Retain all open statuses and the optional Show closed control for eligible issues. This supersedes the other-Sprint shortcut rules below; Sprint headings and independent issue membership are unchanged.

Latest amendment: every issue's own Sprint field is the sole inclusion rule, including Swimlane parents. A planned qualifying parent renders a heading even without planned children; an unplanned parent never creates a heading from its children. Group Cards under the nearest planned qualifying ancestor, otherwise Ungrouped. Dragging/planning a parent changes only that issue; retire all descendant-planning operations. This supersedes context-only membership and descendant shortcut behavior described historically below.

Amendment: membership now supports a multiple-value Version custom field. Adding appends the selected version and removing deletes only that version, preserving all other memberships. The descendant shortcut also appends for issues already in other Sprints. This supersedes the single-value and Unplanned-only restrictions below; module release separation and context-only parents remain unchanged.

Supersedes [ADR 0003](0003-version-only-sprints.md). A Sprint is one product-owned version, shared with module subprojects, whose membership is stored exclusively in a required, deployment-wide, single-valued Version custom field. Keep Redmine's Target version independent for module releases; requiring explicit configuration rather than falling back to Target version prevents module releases from silently becoming Sprints. Do not migrate existing assignments automatically or restore relation-based Sprint membership.

The Product Project and all nested subprojects define the board boundary, not version sharing. Swimlane-capable issues are context-only: Cards group under their nearest qualifying ancestor regardless of the ancestor's Sprint value, and a parent leaves Backlog only while it actually heads a Swimlane in the selected Sprint. This permits product-level grouping without requiring parent and child planning to coincide.

Retain dragging a Backlog parent only as an explicit shortcut for adding eligible Unplanned descendants, excluding all Swimlane-capable issues. Preserve statuses, Target versions and existing Sprint memberships; do not offer bulk removal or draggable Sprint headings. This chooses independent issue planning over the previous parent-inclusive hierarchy operations.

The confirmed behavior, acceptance scenarios and implementation outcome are in [the feature spec](../../.scratch/product-sprint-planning/spec.md).
