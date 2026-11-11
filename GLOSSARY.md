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
A product-wide planning container represented by one version owned by the Product Project and shared with its Module Projects. An issue may belong to several Sprints, independently of its module release.
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
A horizontal grouping headed by a Swimlane-capable issue belonging to the selected Sprint, with Cards grouped beneath their nearest such ancestor. The heading can exist without Cards; every issue's Sprint membership is independent.
_Avoid_: Column, bucket

**Swimlane-capable Issue**:
An issue of a configured tracker type, rendered as a Swimlane heading rather than a Card when it belongs to the selected Sprint. Its membership is distinct from its descendants' memberships; a planning action may explicitly add several issues to a Sprint together.

**Ungrouped**:
The section of a Sprint containing Cards that do not belong to a Swimlane.

**Unplanned**:
An issue with no Sprint.
_Avoid_: Unassigned, loose, orphan

**Backlog**:
The Column of Unplanned Swimlane-capable issues. Open issues are shown by default; closed issues are optionally visible.
_Avoid_: Inbox, icebox

**Tag**:
A named label attached to a Redmine issue, independent of its Tracker, Priority, Category and Sprint membership. An issue may have several Tags or none.
