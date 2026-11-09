# Separate product Sprint membership from module releases and Swimlane context

Status: accepted; implementation pending.

Supersedes [ADR 0003](0003-version-only-sprints.md). A Sprint is one product-owned version, shared with module subprojects, whose membership is stored exclusively in a required, deployment-wide, single-valued Version custom field. Keep Redmine's Target version independent for module releases; requiring explicit configuration rather than falling back to Target version prevents module releases from silently becoming Sprints. Do not migrate existing assignments automatically or restore relation-based Sprint membership.

The Product Project and all nested subprojects define the board boundary, not version sharing. Swimlane-capable issues are context-only: Cards group under their nearest qualifying ancestor regardless of the ancestor's Sprint value, and a parent leaves Backlog only while it actually heads a Swimlane in the selected Sprint. This permits product-level grouping without requiring parent and child planning to coincide.

Retain dragging a Backlog parent only as an explicit shortcut for adding eligible Unplanned descendants, excluding all Swimlane-capable issues. Preserve statuses, Target versions and existing Sprint memberships; do not offer bulk removal or draggable Sprint headings. This chooses independent issue planning over the previous parent-inclusive hierarchy operations.

The confirmed behavior and acceptance scenarios are in [the feature spec](../../.scratch/product-sprint-planning/spec.md). This decision records the intended model; it does not imply the current implementation already follows it.
