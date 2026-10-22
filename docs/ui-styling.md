# Sprint Board visual styling

The interface follows YouTrack's compact visual hierarchy, not its branding or feature set.

## Web references

- [YouTrack board UI](https://www.jetbrains.com/help/youtrack/cloud/agile-board-ui.html): compact toolbar, hairline columns, card ID and summary, assignee and estimation, restrained field indicators.
- [YouTrack board settings](https://www.jetbrains.com/help/youtrack/cloud/agile-board-settings.html): priority-based card color schemes.
- [JetBrains Ring UI tokens](https://github.com/JetBrains/ring-ui/blob/master/src/global/variables.css): system font, 8px spacing unit, neutral surfaces, blue interactive accents.
- Existing [visual-language decision](adr/0001-jetbrains-ring-ui-visual-language.md) and [measured references](../.scratch/sprint-planning/youtrack-visual-reference.md).

## Application

Project and Sprint controls sit alongside commitment totals. An icon-only Refresh button lives in the topbar and stays disabled during loads and saves. The last successful update time lives in a 24px bottom status bar; both are hidden on the login screen. The status bar occupies its own flex row rather than overlapping Cards. Filters form a separate aligned row; each Column scrolls independently while its heading remains visible. Narrow screens keep horizontal scrolling inside the board.

Cards use the same priority token for their left stripe and metadata dot, plus a tinted priority label with theme-specific readable text: Low / Bassa green, Medium / Media (also Normal / Normale) yellow, High / Alta red, Urgent orange, Immediate rose. English and Italian stock names share colors; unrecognized custom names stay neutral rather than being guessed from IDs. Priority text remains visible so color is never the sole signal. A separate compact footer aligns the assignee and estimate; long names truncate with their full name in a tooltip. The full summary remains available through its tooltip and accessible label.

Search and Filter requests keep the last confirmed view visible. A keyed per-Column reconciliation updates only changed Cards, fields, counts and loading text, preserving unchanged nodes, column scroll and keyboard focus. The unmapped-status Column remains present when its Sprint issues are filtered out, so other Columns do not resize. Empty-result messaging does not consume board height. Failed searches retain the previous view with an explicit message and suspend paging until a successful search or refresh.

The signed-in identity is a compact initials avatar (for example GB). Clicking it opens a non-modal account popover with the full name and Sign out action. Escape or clicking outside dismisses it; keyboard activation and focus restoration are supported. Signing out still clears the saved API key and aborts outstanding requests.

An icon-only Appearance button cycles System (default, monitor icon), Light (sun) and Dark (moon). The tooltip and accessible label state the current mode and next action; Enter and Space work like a native button. A small pre-paint script restores the optional browser preference; System reacts to OS changes. Storage failures do not prevent switching themes. These are presentation preferences only: Redmine queries, permissions, drag-and-drop and planning writes are unchanged.
