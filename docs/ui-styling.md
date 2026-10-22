# Sprint Board visual styling

The interface follows YouTrack's compact visual hierarchy, not its branding or feature set.

## Web references

- [YouTrack board UI](https://www.jetbrains.com/help/youtrack/cloud/agile-board-ui.html): compact toolbar, hairline columns, card ID and summary, assignee and estimation, restrained field indicators.
- [YouTrack board settings](https://www.jetbrains.com/help/youtrack/cloud/agile-board-settings.html): priority-based card color schemes.
- [JetBrains Ring UI tokens](https://github.com/JetBrains/ring-ui/blob/master/src/global/variables.css): system font, 8px spacing unit, neutral surfaces, blue interactive accents.
- Existing [visual-language decision](adr/0001-jetbrains-ring-ui-visual-language.md) and [measured references](../.scratch/sprint-planning/youtrack-visual-reference.md).

## Application

Project and Sprint controls sit alongside commitment totals. Filters form a separate aligned row; each Column scrolls independently while its heading remains visible. Narrow screens keep horizontal scrolling inside the board.

Cards use the same priority token for their left stripe and metadata dot, plus a tinted priority label with theme-specific readable text: Low / Bassa green, Medium / Media (also Normal / Normale) yellow, High / Alta red, Urgent orange, Immediate rose. English and Italian stock names share colors; unrecognized custom names stay neutral rather than being guessed from IDs. Priority text remains visible so color is never the sole signal. A separate compact footer aligns the assignee and estimate; long names truncate with their full name in a tooltip. The full summary remains available through its tooltip and accessible label.

Search and Filter requests keep the last confirmed view visible. A keyed per-Column reconciliation updates only changed Cards, fields, counts and loading text, preserving unchanged nodes, column scroll and keyboard focus. The unmapped-status Column remains present when its Sprint issues are filtered out, so other Columns do not resize. Empty-result messaging does not consume board height. Failed searches retain the previous view with an explicit message and suspend paging until a successful search or refresh.

Appearance offers System (default), Light and Dark. A small pre-paint script restores the optional browser preference; System reacts to OS changes. Storage failures do not prevent switching themes. These are presentation preferences only: Redmine queries, permissions, drag-and-drop and planning writes are unchanged.
