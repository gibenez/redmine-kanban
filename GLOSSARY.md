# Redmine Sprint Board

Vocabulary for a single team's frontend-only sprint planner over Redmine. Redmine owns issues, sprints, workflow and permissions; this context owns only how they are presented and planned.

## Language

**Sprint Board**:
The planning surface showing a Product Project's Backlog alongside its Columns for a single selected Sprint, including work from its Module Projects.
_Avoid_: Kanban board, agile board, task board

**Product Project**:
The project defining a Sprint Board's scope, together with all of its nested subprojects, and owning its product-wide planning versions.

**Module Project**:
A subproject within a Product Project's hierarchy, representing a part of the product with its own release versions.

**Sprint**:
A product-wide planning container represented by one version owned by the Product Project and shared with its Module Projects. An issue belongs to at most one Sprint, independently of its module release.
_Avoid_: Iteration, milestone

**Target Version**:
The module release targeted by an issue, independent of its Sprint.

**Column**:
A vertical list on the Sprint Board, either the Backlog or one configured Redmine status.
_Avoid_: Lane, swimlane, bucket

**Card**:
A single issue as it appears inside a Column.
_Avoid_: Ticket, task, tile

**Swimlane**:
A horizontal grouping of Sprint Cards under their nearest Swimlane-capable ancestor. The ancestor supplies context, not Sprint membership; a Swimlane exists only while at least one Card groups beneath it.
_Avoid_: Column, bucket

**Swimlane-capable Issue**:
An issue of a configured tracker type that supplies grouping context rather than a Sprint Card. When it does not head a Swimlane in the selected Sprint, it can appear in Backlog as a shortcut for planning eligible descendants without planning itself.

**Ungrouped**:
The section of a Sprint containing Cards that do not belong to a Swimlane.

**Unplanned**:
An issue with no Sprint.
_Avoid_: Unassigned, loose, orphan

**Backlog**:
The Column of eligible open Unplanned issues and Swimlane-capable issue shortcuts that do not head a Swimlane in the selected Sprint. Closed shortcuts are optionally visible.
_Avoid_: Inbox, icebox

**Backlog Scope**:
Whether the Backlog shows only Unplanned issues in the configured New status, or every open Unplanned issue.

**Tag**:
A named label attached to a Redmine issue, independent of its Tracker, Priority, Category and Sprint membership. An issue may have several Tags or none.
