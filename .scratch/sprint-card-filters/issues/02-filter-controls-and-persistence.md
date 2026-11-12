# Filter controls, options, and persistence

Status: ready-for-agent
Type: task
Blocked by: 01

## Scope

Build the separate row below the planning header, following [the spec](../spec.md).

- Accessible search and multi-select Project, Assignee, Priority controls, including Unassigned.
- Immediate application and Clear filters for these four controls only.
- Stable options derived from complete Sprint child Cards, not filtered Cards or heading-only issues.
- Retain and expose removable selections absent from current options.
- Persist per connected server/user/Product Project, including search; restore across reloads and Sprint switches without changing Backlog lifetime.
- Follow existing Ring UI-style CSS and accommodate narrow layouts without obscuring board controls.

## Likely code locations

- `index.html`
- `src/main.js`
- `src/style.css`
- `tests/e2e/board.spec.js`

## Acceptance criteria

Cover spec criteria 1, 6, and 7 with tests, including cross-project/account/server isolation, absent saved values, stable options, and independent Backlog controls. Search and selections remain usable during rerenders.

## Comments

- Implemented independent controls in `src/sprint-filter-controls.js`, markup/CSS, and scoped preferences in `src/sprint-filters.js`. Checkbox dropdowns support keyboard dismissal and narrow viewports, with stable open lists when removing absent saved choices. Unit and browser coverage pass; see the spec for verification totals.
