# Related issues in the issue editor footer

## Requested behavior

Replace the issue editor's bottom-left Open in Redmine link with the related-issues accordion. Keep Save on the right, validation/server messages on the left, and the existing issue-ID link in the heading. Existing board-heading accordions remain unchanged.

## Implementation

- Reuse `createRelatedIssues` for Card, Swimlane and Backlog issue popups, with an independent editor cache and expansion state.
- Preserve the existing user requirement to hide accordions during initial discovery and for confirmed empty relation lists. Failed discovery is visible with Retry, not mistaken for empty results.
- Eagerly discover the edited issue's direct relations; load target details only after expansion. Reuse direction labels, stable ordering, closed-link styling, bounded reads, safe markup, private/deleted placeholders and explicit retry behavior.
- Show targets outside the current Project/Sprint/filter scope when Redmine permits reading them. No planning, membership or issue writes originate from the accordion.
- Keep the summary DOM/focus stable during asynchronous updates. Bound expanded content height and scroll it, retaining room for Save and the editor fields.
- Closing/reopening or changing the edited issue clears/aborts editor relation reads. Sign-out clears them too. Board and editor expansion/caches are independent.
- New-subtask drafts have no related-issues accordion because no issue exists yet.
- Allow only GET `/redmine/issues/:numeric-id/relations.json` in the production proxy; relation writes and standalone relation endpoints remain blocked.

## Verification

Browser coverage includes desktop/narrow footer layout, Cards/Swimlanes/Backlog, hidden-empty discovery, lazy target reads, independent expansion, safe direction labels and links, unavailable targets, retry, stale responses, draft preservation and creation isolation. Existing proxy and related-issue unit tests cover read-only allowlisting and relation state behavior.

- Full browser suite: 282 passed, including 15 editor-related-issues tests; the browser runner builds production assets first.
- Full unit suite: 298 passed, 1 pre-existing Backlog-label failure in `tests/sprint-filter-controls.test.js:17`.
- Docker configuration/proxy/security smoke checks passed; the browser phase was skipped for that targeted proxy validation.
- Whitespace checks passed.
