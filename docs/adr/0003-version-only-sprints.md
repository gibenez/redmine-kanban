# Use target versions as the only Sprint representation

Status: superseded by [ADR 0004](0004-product-sprints-and-context-only-swimlanes.md).

Supersedes [ADR 0002](0002-build-issue-sprint-membership.md). Retire Build-issue Sprints and their relation-based membership to simplify the product to its existing target-version planning model, rather than maintaining two incompatible membership models. Keep independent tracker-based Swimlanes and ordinary issue filters; manage Sprint lifecycle in Redmine.

Existing Redmine issues, relations, Categories and target-version assignments remain untouched: nonexclusive Build memberships cannot be safely converted to a single target version automatically. Explicit legacy Build-mode deployment configuration fails clearly instead of silently changing planning semantics; former Build-container issues are ordinary work items under version-based rules.
