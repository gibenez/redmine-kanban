# 1. Adopt the JetBrains Ring UI visual language for the Sprint Board

Date: 2026-10-21

## Status

Accepted

## Context

The Sprint Board shipped with a bespoke olive/green theme: colour spent on chrome,
8–12px radii, a 650–750 font-weight range and an amber focus ring. We want it to look and
feel like JetBrains YouTrack's agile board.

YouTrack's web UI is built on **Ring UI**, JetBrains' own component library, which is
Apache-2.0 and published to npm. Its `components/global/variables.css` and
`variables_dark.css` are therefore a primary source for YouTrack's exact colours, radii and
type scale, and JetBrains' versioned help site publishes both Markdown variants of its pages
and the board screenshots we could pixel-sample.

Findings are recorded in `.scratch/sprint-planning/youtrack-visual-reference.md`, with the
sampled screenshots in `.scratch/sprint-planning/youtrack-shots/`. Three of them contradicted
what "looks like YouTrack" is commonly assumed to mean, and those contradictions are the
reason this record exists.

## Decision

Reproduce Ring UI's visual language in hand-written CSS custom properties. Do not take a
dependency on Ring UI, and do not vendor any of its code.

Specifically:

1. **Tokens, not a library.** Light and dark palettes are transcribed from Ring UI 7.0.131
   into `:root` custom properties in `src/style.css`. Geometry follows Ring UI's `8px` unit
   and `4px` radius; type follows `14px/20px` body, `12px/16px` secondary, weights 500/600.
2. **`system-ui`, not a bundled webfont.** Ring UI sets
   `--ring-font-family: system-ui, Arial, sans-serif`.
3. **Quiet secondary metadata, explicit priority labels.** Tracker and status stay plain
   text. Priority uses a coloured dot, tinted background and readable coloured text. This
   revises the original dot-and-text-only treatment after user feedback that priority
   colours were not visible enough.
4. **Hairline columns.** Columns are separated by 1px `#DFE1E5` rules under a `#F7F8FA`
   header strip, rather than drawn as rounded panels. The Backlog keeps a faint recessed
   tint because it is the only column that is not a Redmine status and the only
   drop-to-unplan target.
5. **Priority drives a left stripe and label,** using the requested green for Low,
   yellow for Medium/Normal, and red for High, with orange for Urgent and rose for
   Immediate, and theme-specific label contrast. This deliberately replaces the original
   muted border tier for legibility. English and Italian stock names map to the same
   semantic colours; unknown names retain a neutral fallback, never an ID-based guess.
6. **Summaries clamp to three lines,** with the full subject exposed via `title` and
   `aria-label`.

## Consequences

- **Why no Inter.** The obvious assumption is that JetBrains ships Inter or JetBrains Sans
  for UI text. It does not: Ring UI uses the platform font. Choosing `system-ui` is the more
  faithful option *and* avoids a redistributable-font obligation. JetBrains Sans is
  proprietary and must not be vendored.
- **Why a hardcoded colour map.** Every other setting in this repo comes from the
  environment, so a hardcoded map looks anomalous. It is necessary: the Redmine REST API
  returns priority names and IDs but never colours, and priorities are admin-configurable.
  Matching is by name, because matching by position silently miscolours a customised
  Redmine, and the fallback is a neutral grey so an unrecognised priority reads as
  deliberately uncoloured rather than wrong.
- **Why cards get darker in dark mode.** Ring UI's dark surfaces invert the light
  relationship: cards sit at `#1E1F22` *inside* columns at `#2B2D30`. A dark mode that keeps
  cards lighter than their column will not read as JetBrains.
- **A documented promise changed.** The README previously guaranteed that cards "wrap rather
  than truncate". Clamping contradicts it, so the README is updated in the same change.
- **Accessibility is not traded away.** YouTrack's secondary greys are low contrast. WCAG AA
  for text remains a target we do not knowingly break, even where that means departing from
  a sampled value.
- **Trademarks.** This reproduces a visual language, not JetBrains' branding. No JetBrains
  name, logo or font file is used.
- **Density changed backlog pagination.** Cards shrank from ~150px to ~82px, so a fixed page
  of five no longer overflowed a tall column and scroll-triggered paging could never fire.
  The page is now measured from the column instead: visible height divided by the rendered
  card height, plus two spare rows, clamped to Redmine's maximum of 100. A 1440×1000 screen
  therefore loads eleven issues in **one** request where the old behaviour needed three, and
  the startup request count is unchanged at one. Pages are re-measured, so successive pages
  can differ in size.
- **The "Load 5 more" button became "Scroll to load more" text.** With the column always
  overflowing, scrolling is the normal path and columns are focusable for keyboard
  scrolling. One case still needs a control: a page that failed while the column sits at its
  bottom raises no further scroll event, so a **Retry loading issues** button appears only
  after a failure. Automatic fetches are silent so they cannot clear an unread notice.
- **Reversal cost.** Undoing this means rewriting every surface again; the tokens are
  centralised in `:root` specifically to keep that cost to one block.
