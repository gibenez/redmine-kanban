# Remember Backlog visibility and suspend collapsed loading

Status: confirmed

## Goal

Remember whether the Backlog is expanded or collapsed, and perform no
Backlog-only loading while it is collapsed. Requests needed by the visible
Sprint Board continue normally.

## Confirmed behavior

### Remembered state

- Preserve the existing browser-wide `localStorage` preference using
  `redmine-sprint-board.backlog-collapsed` (`1` collapsed, `0` expanded).
- Share the preference across Product Projects and Sprints on the same origin.
  No account-level or cross-device synchronization is required.
- Default to expanded when no saved preference exists. Preserve best-effort
  storage behavior when `localStorage` is unavailable.
- Restore the preference before deciding whether to initiate Backlog loading.
- Do not synchronize visibility changes live between already-open tabs. Each
  tab restores the saved preference on reload.

### While collapsed

- Do not start Backlog-only requests on initial connection, manual refresh,
  automatic refresh, returning to the tab, Product Project or Sprint changes,
  or refreshes following writes.
- Do not start Backlog pagination, retries, or other background Backlog loads.
- Continue requests necessary for the visible Sprint Board, including shared
  metadata and Sprint-required ancestor or hierarchy reads. An issue being
  Unplanned does not by itself make a request Backlog-only.
- Allow collapsing during Backlog loading. Cancel in-flight Backlog-only
  requests where supported without cancelling Sprint Board requests.
- Requests already sent may have reached the server. Prevent subsequent
  Backlog requests and ignore late Backlog results after collapse.

### On expansion

- Fetch a fresh first page on every expansion, using the current Product
  Project and retained Backlog filters. Do not display stale cached Cards.
- Display loading inside the Backlog only. Keep the Sprint Board and Backlog
  collapse toggle usable.
- Leave existing loading behavior for other Sprint Board operations unchanged.
- If loading fails, keep the Backlog expanded and show an error with an
  explicit Retry action, without stale Cards.
- Collapsing hides the error and prevents further Backlog requests. Expanding
  again starts a fresh attempt.

## Acceptance criteria

1. With a saved collapsed preference, connection and reload make zero
   Backlog-only requests; necessary Sprint Board requests still succeed.
2. A saved expanded preference is restored; a first visit defaults to expanded.
3. Collapsed manual refresh, automatic refresh, tab-return refresh, scope
   changes, and post-write refreshes do not query the Backlog.
4. Collapsing during Backlog loading attempts cancellation where supported,
   stops follow-up requests, and prevents late results from changing Backlog
   state without interrupting independent Sprint Board loading.
5. Every expansion requests a fresh first page for the current scope and
   filters, including after scope changes or planning writes while collapsed.
6. Expansion loading is local to the Backlog; the Sprint Board and collapse
   toggle remain usable.
7. Failed expansion shows an explicit Retry action and no stale Cards.
   Collapsing stops loading; reopening retries with a fresh first page.
8. The preference survives browser restarts and applies across Product
   Projects and Sprints. Already-open tabs do not react to another tab's toggle.
9. Existing filter retention and reset rules are unchanged.

## Implementation and documentation notes

- Persistence already exists in `src/main.js`; preserve its key and scope.
- `PlanningFeed.load()` in `src/planning-feed.js` currently always initiates
  Backlog loading alongside Sprint loading. These operations must support
  independent omission and cancellation.
- Distinguish Backlog requests by their query and purpose, not just the
  `/issues.json` endpoint, which also serves Sprint requests.
- Update the collapsed-refresh expectation in `tests/e2e/board.spec.js`, which
  currently expects a Backlog request, and cover request suppression and races
  in feed and end-to-end tests.
- Update the Backlog loading contract in `README.md` and any affected in-app
  guide text when implementing.
- This changes the expansion-loading UX to local Backlog feedback, while
  preserving shared loading behavior documented in the autorefresh spec.

## Scope

This document records the confirmed design. Implementation is a separate step.
No changes to Backlog eligibility, Sprint membership, filter semantics, account
preferences, or live cross-tab synchronization are included.
