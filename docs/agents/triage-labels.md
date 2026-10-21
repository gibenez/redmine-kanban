# Triage Labels

Canonical roles map directly to the local tracker's `Status:` values.

| Canonical role | Tracker value | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate |
| `needs-info` | `needs-info` | Waiting on reporter information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill applies a triage role, set the issue's `Status:` line
to the corresponding tracker value.
