# Version-only Sprints

Status: ready-for-agent

## Goal

Retire Build-based Sprints and use Redmine target versions as the only Sprint representation.

The user confirmed the complete scope and authorized implementation.

## Confirmed decisions

- Fully remove Build-based Sprint support, including the source selector, Build-tracker configuration, relation-based membership logic, and associated active tests/documentation. Do not retain a hidden compatibility mode.
- Leave existing Redmine issues, relations, and target-version assignments untouched. No automatic migration or remote data deletion. Document that existing Build memberships do not become target-version assignments.
- Preserve existing version-based planning behavior. Do not redesign it or recreate relation-based or multiple-Sprint membership using target versions.
- Tracker-related features serving other purposes are not implicitly in scope for removal.
- Keep Swimlanes, `SWIMLANE_TRACKERS`, and ordinary tracker filters unchanged; remove only the tracker configuration identifying Sprint containers and Build-specific Swimlane branches.
- Remove Build-only Category selection, Backlog Category Scope, and Sprint creation/closing/reopening controls. Continue managing target versions in Redmine.
- Treat former Build-container issues as ordinary issues according to their status and target version; do not retain a special tracker exclusion.
- Preserve existing version selection persistence and write-error recovery behavior; improvements are outside this removal.
- Remove obsolete source/Build-tracker settings from supported configuration. If an explicitly supplied legacy source setting selects Build mode, stop with a clear configuration error rather than silently switching planning semantics. This guard is configuration validation, not a retained planning mode.
- Updating the local ignored `.env`, which currently selects Build mode, is in implementation scope. Preserve unrelated local settings.
- Do not reinterpret stored Build/category issue IDs as version selections. Leave unused legacy browser preferences inert rather than introducing a data migration.

## Verification scope

- Remove Build-only tests and API/proxy capabilities with no retained consumers; preserve coverage for version planning, Swimlanes, tracker/tag filters, permissions, pagination, and shared board behavior.
- Cover explicit legacy Build configuration rejection in development and production configuration paths.
- Run the applicable automated tests and production build; report any checks that cannot be run.

## Confirmation

The user confirmed the shared understanding with “yes, go”.

## Implementation outcome

Implemented version-only planning, removed Build-only controls/modules/API methods and proxy permissions, retained independent Swimlanes and filters, and added legacy configuration rejection in browser, Vite and Docker startup paths. Updated the local ignored `.env` without changing unrelated settings. No real Redmine requests or data migrations were performed.

Validation:

- `npm test`: 68 tests passed across 7 files.
- `npm run test:e2e`: 85 retained browser tests passed, including production asset build.
- `bash tests/docker-smoke.sh`: passed runtime configuration, legacy rejection, restricted proxy/security checks and all 85 browser tests against production nginx.
- Added a further legacy browser-configuration regression test afterward; its targeted Playwright run passed (86 browser tests total).
- `git diff --check`: passed.

## Documentation implications

- ADR 0002 introduced Build-based Sprints; the new decision supersedes it. Preserve that historical context rather than silently rewriting it.
- Update the glossary and current user/configuration documentation to describe the version-only model once the design is confirmed.

## Comments

- The user agreed to full retirement without compatibility code and to leaving existing Redmine data untouched.
- The user agreed to preserve existing version-based behavior without bringing over Build-based planning semantics.
- The user accepted the recommendations to retain independent Swimlanes/tracker filters and to reject explicit legacy Build-mode configuration, including updating the local `.env` during implementation.
