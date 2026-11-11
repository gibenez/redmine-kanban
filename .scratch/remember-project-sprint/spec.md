# Remember project and Sprint selections

Status: implemented

## Goal

Restore the user's last selected project and the last explicitly selected Sprint for each project using browser localStorage. This is browser-only view state; it does not change Redmine data.

## Agreed behavior

- Remember the last selected project and a separate last selected Sprint for each project.
- Restore the project on a fresh load after identifying the connected Redmine server and user. Restore that project's remembered Sprint once its available Sprint options have loaded.
- When switching projects, restore the destination project's remembered Sprint when available.
- Save explicit selection changes automatically, without a Save button. Preferences survive refreshes, later visits, and browser restarts within the same browser profile and site.
- Isolate preferences by Redmine server and authenticated user. Use stable server/user/project/Sprint identities rather than display names or API keys.
- Restore only projects and Sprints present in the options currently available to that user. Preserve the existing project scope, Sprint eligibility, sorting, and permission checks.
- If a remembered project is unavailable, use the normal project default. If a remembered Sprint is unavailable, use the normal Sprint default, including no selection when no Sprint is eligible.
- Automatic defaults and fallbacks do not overwrite remembered explicit selections. In particular, a closed, deleted, or inaccessible Sprint remains remembered until the user explicitly selects another Sprint for that project.
- Keep Sprint “Show closed” behavior unchanged. Do not persist it or enable it automatically to restore a closed Sprint. The independently persisted Backlog “Show closed issues” preference is unchanged.
- Do not synchronize selections into already-open tabs. Each tab retains its current view; a subsequent load uses the latest saved preferences.
- Treat persistence as best-effort. Missing, malformed, or inaccessible storage falls back safely to normal behavior without a user-facing storage error. Storage failures must not break connection or selector operation.

## Existing defaults to preserve

- Project: first project returned by Redmine, in API response order.
- Sprint: retain the current eligible selection during ordinary refresh; otherwise first open Sprint, then first eligible Sprint, then no Sprint.
- Eligible Sprints are owned by the selected project, have sharing other than `none`, and are open or optionally closed. Locked versions remain excluded.
- Sprint options sort by due date ascending (missing dates last), then name.

## Acceptance scenarios

1. Select project A and Sprint A2, reload/reconnect as the same user and server, and see A/A2 restored.
2. Select A/A2, then B/B3; switching back to A restores A2. A subsequent fresh load restores the most recently selected project and its remembered Sprint.
3. Closing and reopening the browser preserves selections when localStorage is retained.
4. A different server or authenticated user does not inherit another identity's selections.
5. An unavailable saved project uses the existing project default; an unavailable saved Sprint uses that project's normal default. Neither fallback overwrites the saved explicit preference.
6. A saved closed Sprint with “Show closed” off is not restored, the checkbox stays off, and its saved preference remains intact. An explicit alternative Sprint selection replaces that preference.
7. Empty project/Sprint options remain safe; no invalid board query or fabricated selection is introduced.
8. Missing, malformed, or blocked localStorage leaves connection, project switching, Sprint switching, and normal defaults functional.
9. Changing selection in one tab does not change another tab's current selection. Saving in one project must preserve remembered Sprints for other projects.
10. Existing refresh behavior, Backlog filter reset behavior, closed-Sprint read-only restrictions, and stale-response protections remain unchanged.

## Scope

No URL selection state, new UI controls, cross-device synchronization, changes to credential consent, or persistence of additional filters. No new domain vocabulary or ADR is needed: this is a reversible browser preference feature using existing project and Sprint concepts.

## Implementation references

- `src/main.js`: connection initialization, selector handlers, Sprint choice, refresh, and existing guarded localStorage access.
- `tests/e2e/board.spec.js`: selector, persistence, project switching, and closed-Sprint scenarios.
- `GLOSSARY.md` and `docs/adr/0004-product-sprints-and-context-only-swimlanes.md`: existing domain definitions and Sprint eligibility constraints.
