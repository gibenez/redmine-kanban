# Redmine Sprint Board

Vocabulary for a single team's frontend-only sprint planner over Redmine. Redmine owns issues, sprints, workflow and permissions; this context owns only how they are presented and planned.

## Language

**Sprint Board**:
The planning surface showing one project's Backlog alongside that project's Columns for a single Sprint.
_Avoid_: Kanban board, agile board, task board

**Sprint**:
A Redmine target version used as the time box that issues are planned into.
_Avoid_: Iteration, milestone, version

**Column**:
A vertical list on the Sprint Board, either the Backlog or one configured Redmine status.
_Avoid_: Lane, swimlane, bucket

**Card**:
A single issue as it appears inside a Column.
_Avoid_: Ticket, task, tile

**Unplanned**:
An issue that has no Sprint.
_Avoid_: Unassigned, loose, orphan

**Backlog**:
The Column of open Unplanned issues.
_Avoid_: Inbox, icebox

**Backlog Scope**:
Whether the Backlog shows only Unplanned issues in the configured New status, or every open Unplanned issue.
