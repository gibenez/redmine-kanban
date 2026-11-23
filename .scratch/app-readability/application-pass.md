# Application usability pass

## Scope

Apply the design skill's hierarchy, consistency, contrast and interaction principles to the real Sprint Board. Do not apply its landing-page section heights, hero, decorative moments, photographs or marketing gate. The user explicitly clarified that compactness and clarity are joint requirements.

## Implemented

- Sprint dropdowns show the actual name for a single selection, a count for multiple selections, and all selected names in their tooltip. Long names are bounded without shrinking the text.
- Each dropdown has a Clear action scoped to that filter. Clearing it closes the dropdown and returns focus to its summary; other filters and search remain unchanged. Clear filters still resets the whole Sprint filter row.
- Sprint controls stay on one row and scroll within their available width. Results and the global reset stay separate and visible at desktop/tablet sizes. Phones retain a single scrolling strip and touch-sized controls. No-result feedback replaces the count rather than consuming an extra row.
- Dropdown panels position synchronously on activation, fit above or below their anchor within the viewport, track the scrolling strip and dismiss when the anchor leaves it. Escape and keyboard activation remain supported. Checkbox nodes and focus are preserved across updates.
- Backlog's Filters button reports active hidden options, lists their values in its tooltip, and remains highlighted with its panel closed. The visible search is not counted twice. Show closed is counted and remains independent of Clear filters, as before.
- Corrected the earlier pass's off-center collapsed Backlog rail and one-pixel priority-bar offset.
- Preserved 14px issue subjects, 8px Card padding/gaps, one Card metadata row, and stripe-only priority presentation. No badges or Card rows were added.

## Validation

- `npm test`: **163 passed across 18 files**.
- `PLAYWRIGHT_HTML_OPEN=never npm run test:e2e -- --workers=1`: **145 passed**. Includes filter persistence and scope, keyboard interaction, responsive geometry at 320–1440px, priority bars, planning writes/confirmation, scrolling, closed Sprints, permission errors, themes and reduced motion.
- Production build: **passed**, including the build used by the full E2E suite.
- `git diff --check`: **passed**.
- Built authenticated fixture screenshots inspected at 1440×900, 1024×768, 820×1180, 768×1024 and 390×844, plus dark mode. Active selections and the dropdown Clear action were also inspected from an E2E screenshot. Local files: `.taste-skill/shots/app-*.png` and `.taste-skill/shots/active-filters.png`.
- Tests use local Redmine mocks. No live Redmine account or deployment was accessed. No production credentials, fake production data, API permissions or membership rules were changed.

The earlier marketing-gate report in `validation.md` is historical, not the acceptance criterion for this application pass. Application-specific behavior and geometry tests are the criterion here.
