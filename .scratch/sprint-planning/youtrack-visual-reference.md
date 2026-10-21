# YouTrack / JetBrains Ring UI visual reference

Source: `@jetbrains/ring-ui` **7.0.131**, fetched via `npm pack` into a temp dir and read
directly (not installed into this repo). Ring UI is JetBrains' own open-source component
library and is what YouTrack's web UI is built from, so these token values are primary
source, not reconstruction.

Files read:

- `package/components/global/variables.css` (light)
- `package/components/global/variables_dark.css` (dark)
- `package/components/global/global.css` (type scale)

Status of each number below: **sourced** unless explicitly marked *estimated*.

## Geometry and type scale (sourced)

| Token | Value |
| --- | --- |
| `--ring-unit` | `8px` (all spacing is multiples of this) |
| `--ring-border-radius` | `4px` |
| `--ring-border-radius-small` | `2px` |
| `--ring-border-radius-large` | `8px` |
| `--ring-font-size` | `14px` |
| `--ring-font-size-smaller` | `12px` |
| `--ring-font-size-larger` | `16px` |
| `--ring-line-height` | `20px` |
| `--ring-line-height-lower` | `18px` |
| `--ring-line-height-lowest` | `16px` |
| `--ring-font-weight-medium` | `500` |
| `--ring-font-weight-bold` | `600` |
| `--ring-font-variant-numeric` | `lining-nums tabular-nums slashed-zero` |

### Font family — contradicts the assumption that YouTrack ships Inter

```css
--ring-font-family: system-ui, Arial, sans-serif;
--ring-font-family-monospace: Menlo, 'Bitstream Vera Sans Mono', 'Ubuntu Mono', Consolas,
  'Courier New', Courier, monospace;
```

Ring UI 7 uses the **plain system font stack**. There is no Inter, no JetBrains Sans, and no
bundled webfont in the package. JetBrains Sans is proprietary and not redistributable;
JetBrains Mono is OFL but is not what the UI text uses.

Notable: radii are small (`4px`), not the `8–12px` this repo currently uses, and the base
size is `14px/20px` with a `12px/16px` secondary tier. Density comes from the `8px` unit.

## Light theme colours (sourced)

| Role | Token | Hex |
| --- | --- | --- |
| Page / card surface | `--ring-content-background-color` | `#FFFFFF` |
| Recessed surface (column) | `--ring-sidebar-background-color` | `#F7F8FA` |
| Divider / hairline | `--ring-line-color` | `#DFE1E5` |
| Control border | `--ring-borders-color` | `#D3D5DB` |
| Primary text | `--ring-text-color` | `#27282E` |
| Secondary text | `--ring-secondary-color` | `#6C707E` |
| Disabled text | `--ring-disabled-color` | `#A8ADBD` |
| Icon | `--ring-icon-color` | `#6C707E` |
| Accent / primary action | `--ring-main-color` | `#3369D6` |
| Accent hover | `--ring-main-hover-color` | `#315FBD` |
| Link | `--ring-link-color` | `#315FBD` |
| Link hover | `--ring-link-hover-color` | `#2E55A3` |
| Chip / tag background | `--ring-tag-background-color` | `#EBECF0` |
| Chip hover | `--ring-tag-hover-background-color` | `#DFE1E5` |
| Row hover | `--ring-hover-background-color` | `#EDF3FF` |
| Row selected | `--ring-selected-background-color` | `#D4E2FF` |
| Success | `--ring-main-success-color` | `#1F8039` |
| Error | `--ring-main-error-color` | `#CC3645` |
| Warning | `--ring-main-warning-color` | `#FFAF0F` |
| Purple | `--ring-main-purple-color` | `#834DF0` |
| Added / removed subtle bg | `--ring-added-subtle` / `--ring-removed-subtle` | `#E6F7E9` / `#FFEBEC` |

Shadow (sourced):

```css
--ring-popup-shadow: 0 2px 8px rgba(0, 28, 54, 0.1), 0 1px 2px rgba(0, 28, 54, 0.04);
```

i.e. shadows are built from a blue-black `rgb(0 28 54)` at 10%/4%, not neutral black.

## Dark theme colours (sourced)

| Role | Hex |
| --- | --- |
| Page / card surface | `#1E1F22` |
| Recessed surface (column) | `#2B2D30` |
| Divider / hairline | `#43454A` |
| Control border | `#6F737A` |
| Primary text | `#FFFFFF` |
| Secondary text | `#9DA0A8` |
| Icon | `#9DA0A8` |
| Accent | `#366ACF` |
| Link | `#99BBFF` |
| Chip / tag background | `#43454A` |
| Chip hover | `#4E5157` |
| Row hover | `#212D45` |
| Row selected | `#2E436E` |
| Success / error / warning | `#4E8052` / `#BD5757` / `#D6AE58` |

These are the JetBrains "New UI" / Darcula greys (`#1E1F22`, `#2B2D30`, `#43454A`).

Note the inversion that matters for this board: in light theme the **card is white and the
column is grey**; in dark theme the **card is darker (`#1E1F22`) than the column
(`#2B2D30`)**. A naive dark mode that keeps cards lighter than columns will not read as
JetBrains.

## Card anatomy (sourced: YouTrack Cloud 2026.2 docs)

Source: <https://www.jetbrains.com/help/youtrack/cloud/agile-board-ui.html> (Markdown
variant `agile-board-ui.html.md`). Docs are versioned **2026.2**, i.e. newer than the
"2024+" target.

Cards have a user-chosen **Card size** (S, M, L, XL, TV) that controls how much is shown:

| Element | Shown at sizes |
| --- | --- |
| Issue ID | S, M, L, XL, TV |
| Issue summary | S, M, L, XL, TV |
| Assignee avatar (or *Set assignee* button when unassigned) | S, M, L, XL, TV |
| Estimation | S, M, L, XL, TV |
| First three custom fields (excluding board/column/swimlane fields and Assignee) | M, L, XL, TV |
| Attachment count | M, L, XL, TV |
| Tags (as many as fit on one line) | L, XL, TV |
| Issue description (first three lines) | XL |

**Summary truncation is explicit and official**: "On small and medium cards, the summary is
truncated to the first two lines. Large and extra large cards show the first three lines."
YouTrack clamps; it does not wrap indefinitely.

Selection states: the *current* card has a blue border; *selected* cards have a blue
background.

### Measured from the official screenshots

The images are JetBrains' own documentation screenshots and are **deliberately not committed**
(`.gitignore` excludes `youtrack-shots/`): they are third-party copyrighted material, and the
measurements below are what we actually needed. Re-fetch them with:

```sh
mkdir -p .scratch/sprint-planning/youtrack-shots && cd $_
for i in agile-card agile-board-columns agile-swimlane agile-toolbar; do
  curl -sSLO "https://resources.jetbrains.com/help/img/youtrack/2026.2/$i.png"
done
```

They appear to be 2× retina captures, so CSS values are device pixels ÷ 2.

- Column header strip background sampled `#F7F8FA` — exactly `--ring-sidebar-background-color`.
- Vertical divider between columns sampled `#DFE1E5` — exactly `--ring-line-color`. Columns
  are separated by **hairlines**, not drawn as rounded panels.
- Card: 2 device px `#DFE1E5` border, then **10 device px (≈5 CSS px)** of solid colour
  stripe down the left edge, then `#FFFFFF` card surface.
- A "Major" priority stripe sampled `#FED277` — exactly `--ring-warning-border-color`. So
  YouTrack's field-colour swatches reuse Ring UI's *border* colour tier, not the saturated
  `--ring-main-*` tier.
- Cards appear flat: 1px border, no visible drop shadow.
- Resolved issues render the **issue ID with a strikethrough**.
- Observed card layout, top to bottom: `ID` and `summary` on the **same first line** (ID
  first, in secondary grey, summary in primary text); optional description/subtask block in
  secondary grey; then a single bottom row of `avatar · ‹dot›Priority · Type · Subsystem`
  pushed left with `estimation` right-aligned. Unestimated cards show `?`.
- Custom field values on the bottom row are **plain text preceded by a small coloured dot**,
  not pill-shaped chips.

## Colour coding (sourced)

From Agile Board Settings → Cards
(<https://www.jetbrains.com/help/youtrack/cloud/agile-board-settings.html>):

- **Color scheme**: "Differentiates cards on the board by project or based on the value of a
  selected custom field. The default setting applies the color scheme used by the Priority
  field." One field drives the card's colour.
- **Show colors for other custom fields**: toggles colour-coded indicators for the other
  fields shown on the card — i.e. the small dots observed above.

Per-value colours come from enumerated-field *value-specific settings*
(<https://www.jetbrains.com/help/youtrack/cloud/value-specific-properties.html>), so the
palette is user-configurable rather than a fixed documented swatch list.

## Column header (sourced)

- Clicking the column label collapses/expands the column; collapsed columns stay visible.
- An **Open in Issues list** control appears on hover.
- **Total estimation** sits at the right of the header; when no estimation field is
  configured it shows the **card count** instead. Observed as a plain right-aligned grey
  number, not a pill badge.
- A toolbar **progress indicator** shows per-column card counts as a bar chart and flags
  work-in-progress limit violations
  (<https://www.jetbrains.com/help/youtrack/cloud/progress-indicator.html>).

## Still unsourced

- Exact column width and card gap in CSS pixels (*estimated*: `8px` multiples, given
  `--ring-unit: 8px`).
- Trademark caveats about imitating JetBrains' look: not researched. JetBrains' name and
  logo are trademarks; this work copies neither. Ring UI is Apache-2.0, but **no Ring UI
  code or font file is being vendored here** — only measurements inform hand-written CSS.
