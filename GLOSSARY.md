# Redmine Sprint Board

Vocabulary for a single team's frontend-only sprint planner over Redmine. Redmine owns issues, sprints, workflow and permissions; this context owns only how they are presented and planned.

## Language

**Sprint Board**:
The planning surface showing one project's Backlog alongside that project's Columns for a single selected Sprint.
_Avoid_: Kanban board, agile board, task board

**Sprint**:
A planning container represented by a Redmine target version.
_Avoid_: Iteration, milestone, version

**Column**:
A vertical list on the Sprint Board, either the Backlog or one configured Redmine status.
_Avoid_: Lane, swimlane, bucket

**Card**:
A single issue as it appears inside a Column.
_Avoid_: Ticket, task, tile

**Swimlane**:
A horizontal grouping across a Sprint's status Columns, representing an issue of a configured tracker type and its planned descendants. The parent issue identifies the Swimlane; its planned descendants appear as Cards in their respective status Columns.
_Avoid_: Column, bucket

**Ungrouped**:
The section of a Sprint containing Cards that do not belong to a Swimlane.

**Unplanned**:
An issue with no Sprint.
_Avoid_: Unassigned, loose, orphan

**Backlog**:
The Column of open Unplanned issues.
_Avoid_: Inbox, icebox

**Backlog Scope**:
Whether the Backlog shows only Unplanned issues in the configured New status, or every open Unplanned issue.

**Tag**:
A named label attached to a Redmine issue, independent of its Tracker, Priority, Category and Sprint membership. An issue may have several Tags or none.
