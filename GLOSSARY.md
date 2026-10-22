# Redmine Sprint Board

Vocabulary for a single team's frontend-only sprint planner over Redmine. Redmine owns issues, sprints, workflow and permissions; this context owns only how they are presented and planned.

## Language

**Sprint Board**:
The planning surface showing one project's Backlog alongside that project's Columns for a single selected Sprint.
_Avoid_: Kanban board, agile board, task board

**Sprint**:
A planning container represented either by a Redmine target version or by a Build issue. A Build Sprint belongs to a Category and is closed when its issue is closed.
_Avoid_: Iteration, milestone, version

**Column**:
A vertical list on the Sprint Board, either the Backlog or one configured Redmine status.
_Avoid_: Lane, swimlane, bucket

**Card**:
A single issue as it appears inside a Column.
_Avoid_: Ticket, task, tile

**Unplanned**:
An issue with no Sprint in version-based planning, or no open Build Sprint membership in Build-based planning.
_Avoid_: Unassigned, loose, orphan

**Backlog**:
The Column of open Unplanned issues.
_Avoid_: Inbox, icebox

**Backlog Scope**:
Whether the Backlog shows only Unplanned issues in the configured New status, or every open Unplanned issue.

**Category**:
A module within a project, such as Web or Mobile, with its own Build Sprints. Uncategorized denotes issues with no Category.
_Avoid_: Subproject, component

**Build Sprint Membership**:
An issue's “relates to” relationship with a Build Sprint. An issue may belong to several Build Sprints; removing one membership preserves the others.

**Backlog Category Scope**:
Whether the Backlog is restricted to the selected Category. This is independent of Backlog Scope and does not restrict members shown in the selected Sprint.
