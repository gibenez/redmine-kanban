# Redmine sprint planning board — agreed scope

Confirmed by the user after a design interview. Implementation authorized with “yes, go”.

## Product

One software development team, one selected Redmine project at a time. Start from jKanban's UI. Redmine is the only source of truth; preserve individual identities and permissions. Docker sidecar serves static frontend assets and reverse-proxies API requests, without an application backend or database.

## Authentication and deployment

Personal API keys. Optional explicit browser persistence via localStorage, with the storage/XSS risk accepted, and a Forget action. HTTPS outside local development, locally bundled dependencies, restrictive CSP, no unescaped Redmine HTML. One shared deployment status mapping, discovered/validated against Redmine's API.

Deployment clarification after the first implementation: the board must run independently, pointed at one reachable `REDMINE_URL`. Sharing Redmine's Docker network must not be required. Use that URL for API proxying and browser links; retain the same-origin proxy so Redmine needs no CORS changes.

## Sprint and backlog

- Sprint = target version.
- Backlog = configured New status plus no target version. “Open” is the team's in-progress status, not a synonym for backlog.
- Backlog beside selected sprint, with ordered status columns.
- Selected sprint includes completed issues; don't silently hide unmapped statuses.
- Removing from sprint clears version only. Do not reset status; explicitly explain when the issue is consequently no longer backlog-visible.
- Moving between sprint status columns updates status; movement between backlog and sprint updates target version.
- Open versions selectable by default. Closed sprints optionally visible and read only.

## Features

Assign existing issues to/remove them from existing sprints; edit assignee and estimated hours. Missing estimates allowed and counted separately, not treated as zero. Show whole-sprint totals separately from filtered totals. All tracker types; tracker, assignee, subject/ID filters. Cards show ID, subject, tracker, priority, assignee and estimated hours. Sort by Redmine priority then issue ID; no persisted manual ranking.

Desktop-first. Links to Redmine for issue creation, detailed editing and version management. No capacity planning, burndown charts, sprint completion automation, or issue creation in this release.

Performance follow-up requested by the user: fetch only 5 backlog issues initially, then lazily fetch 5 more near the bottom of the backlog column (plus an accessible manual load action). Search and tracker/assignee filters must be applied by Redmine before pagination, not to the locally loaded subset. Debounce subject searches; numeric/#ID queries use exact issue-ID matching. Cancel superseded searches and discard stale pages across filter/project/sprint changes. Keep full sprint effort totals independent of the server-filtered view. Reset backlog cursors after successful writes and explicit refresh; preserve a failed next-page cursor for retry.

## Refresh and writes

Refresh periodically only while active; defer during dragging/editing/saving. Confirm writes before presenting them as saved, restore failed moves, display errors. Redmine enforces permissions. Full conflict detection is not guaranteed and was accepted as out of scope.

## Implementation notes

Redmine 5.0+ required for per-issue allowed_statuses discovery. jKanban 1.3.1 unmodified browser distribution is pinned locally with notices to avoid unnecessary legacy npm build/watch dependencies. Implementation and operation details are in README.md; tests cover API behavior, planning rules, browser interactions and Docker proxy/security configuration.
