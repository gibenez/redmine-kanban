# Swimlane related issues

Confirmed by the user; implemented.

## Behavior

- Each planned Swimlane issue heading with direct relations has a separate, initially collapsed Related issues disclosure. Hide it when there are no relations, including while the initial relation check is pending. Not shown on Cards, Backlog items, or Ungrouped. The existing outside-displayed-statuses notice is unchanged.
- Include all direct Redmine relations in both directions, labeled from the heading issue's perspective. No recursive relation traversal or implicit subtask inclusion.
- Include targets regardless of project, Sprint, status (including closed), board filters, or presence elsewhere on the board, subject to Redmine permissions.
- Rows show relationship type, linked issue ID and subject, and status. Links open Redmine in a new tab. Sort by relationship label then issue ID; retain separate distinct relationships to the same issue.
- Read-only reference information: no membership, planning, grouping, or totals changes.
- Check direct relations when headings load so empty disclosures can be omitted. Show N related issues once the relation count is known; fetch target issue details only on first expansion. User amendment: never show an accordion for an empty relation list. This supersedes the earlier agreement to discover relations lazily and keep empty disclosures.
- Show loading and retry states. Inaccessible/deleted targets display Issue unavailable without guessed metadata. Other request failures remain distinguishable from empty results. Preserve successful entries during retries.
- Preserve expansion and cached results through ordinary board updates and filters. Explicit Refresh clears cached results while preserving expansion and reloads visible open disclosures. Switching Product Project or Sprint resets disclosures; sign-out aborts requests and clears data.

## Implementation

- `src/related-issues.js`: disclosure state, bounded target loading, direction labels, cache, cancellation, escaped read-only markup.
- `src/api.js`: direct relations endpoint and cancellable target reads.
- `src/main.js`: heading rendering, delegated toggle/retry handlers, explicit refresh and selection lifecycle.
- Unit coverage: laziness, empty state, directions and ordering, repeated targets, escaping, partial failures and retries, cache reset and stale responses.
- Browser coverage: hidden empty disclosures (initially and after Refresh), lazy target loading, incoming relations, links, targets outside the selected Sprint, preserved expansion on Refresh, and reset on Sprint changes.
