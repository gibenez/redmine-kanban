# Opt-in autorefresh toggle

## Status

Confirmed by the user. Implemented; see validation coverage below.

## Agreed behavior

- Autorefresh is off on every page load and after sign-out. Do not persist the preference.
- Preserve the enabled state across Product Project and Sprint changes within the connected session.
- The toggle controls timed polling only. Keep refresh-on-tab-return and all other existing refresh triggers unchanged.
- Enabling starts the existing configured polling interval (60 seconds by default), without an immediate refresh.
- Disabling prevents future polls and lets an in-flight refresh finish.
- Allow toggling whenever connected, including during dragging or editing, except while the full-UI loading overlay blocks interaction. Preserve existing polling safeguards. The overlay requirement supersedes the earlier agreement to allow toggling during loading or saving.
- Repurpose the existing topbar refresh button as an icon-only autorefresh toggle, with a selected appearance, accessible pressed state, and tooltips “Autorefresh off — enable” and “Autorefresh on — disable”. Do not rely on color alone to distinguish states.
- Add a separate compact “Refresh now” icon button beside the toggle, with a distinct icon and tooltip. Preserve existing one-time refresh behavior, including permission retries.

## Explicit consequence

Returning to the tab can still refresh the Sprint Board while autorefresh is off: only timed polling is disabled.

## Full-UI loading overlay

Confirmed by the user together with the combined behavior above.

- Block the entire UI for Redmine data operations, whether reading or writing: connection/login, manual refresh, timed polling, refresh-on-tab-return, Product Project/Sprint changes, and saves.
- Exception: Backlog scroll-to-load remains non-blocking. Its requests alone must not show the full-UI overlay or keep it visible after blocking operations finish.
- Show the overlay immediately with a loading indicator and an accessible loading message.
- Block pointer and keyboard interaction with the underlying UI, including the autorefresh toggle and sign-out.
- Keep the overlay continuously visible throughout a logical operation's sequential or parallel requests, and until all overlapping blocking operations finish. Do not dismiss it between requests belonging to the same operation.
- On failure, remove the overlay once blocking operations finish and expose the existing error/retry UI. Errors must not leave the UI permanently blocked.
- A loading overlay does not cancel in-flight requests or change existing polling safeguards.

## Combined behavior

- Turning autorefresh off is unavailable while a blocking operation is running; it remains available between operations.
- With polling off, returning to the tab still triggers the existing refresh and therefore the blocking overlay.
- Backlog scroll-to-load remains interactive and does not block the UI.

## Validation coverage

- Browser tests cover default-off polling, interval-delayed enablement, disabling, scope preservation, sign-out/page-load reset, independent visibility refresh, and permission retry with polling explicitly enabled.
- Browser tests cover the overlay during connection, search and manual refresh, keyboard/Escape blocking, failure cleanup, desktop/mobile geometry, and non-blocking Backlog pagination.
- Unit tests cover overlapping-operation accounting, idempotent completion, Escape prevention, and waiting for sibling requests when a parallel request fails.
