# Readability and compactness validation

Historical first-pass report. For the current application-specific changes and the fully executed E2E suite, see [Application usability pass](application-pass.md).

`GATE: OPEN 13 (rounds used up)`

## Scope and design

This is a working software application, not a marketing page. Retained the accepted Ring UI neutral palette, blue accent, system-ui font and 4px radii. No random palette/hero deal, external design kit, shaders, photographs or scroll moments were introduced. These would conflict with the existing application and the user's explicit preference for compactness. Voice: technical-dry, direct, consistent domain nouns.

The user's follow-up corrected the first pass: priority badges and the extra metadata rows were removed; issue ID and subject share the first line again; Cards keep 8px padding/gaps; the context strip stays 42–44px tall. Color bars remain the only priority indicator. Text remains 14px with stronger contrast and medium-weight subjects. At narrow widths, explicit Column widths prevent intrinsic text widths from unnecessarily expanding the horizontally scrolling board.

No invented production data, new brand, photographs, contact domain, form stand-in or client asset slots. The isolated preview uses clearly fixture-only Redmine responses; production configuration, API key handling and writes are not replaced.

## Tests and inspection

- `npm test`: **159 passed across 18 files**.
- `npm run build`: **passed**.
- `git diff --check`: **passed**.
- `copy-lint.mjs index.html --kind software`: **0 FAIL, 0 WARN**.
- Authenticated screenshots generated and inspected at 1440×900, 1024×768, 820×1180, 768×1024 and 390×844. Dark mode also inspected at 1440×900. Local artifacts: `.taste-skill/shots/`.
- The authenticated consistency check's final quick pass: **25 findings, 8 warnings**. Field labels, names, focus rings, skip link, contrast, text contrast, collision, tap size and page overflow checks passed. Its 320×640 overflow walk reported **0 FAIL**. This is not a general checker pass: see the limitations below.
- `perf.mjs`: **0 FAIL, 1 WARN**. Initial fixture auto-login causes layout shift **0.202** at desktop; the smaller-width pass reports **0.000**. Transfer totals 111.2 KiB and 80.2 KiB; no broken requests, long tasks or WebGL contexts. This uses deterministic local API fixtures, not live network timing.
- Standalone `assets/layout/check.mjs` on the authenticated fixture crashed (`Cannot read properties of undefined (reading 'map')`, then `r.sections is not iterable`). The kit was not modified. The gate's layout run on the production login did run and reported the findings below.
- Existing Playwright E2E expectations were updated for the visible Refresh now label and absence of priority badges, but the E2E suite was **not run**. Browser inspection used the requested skill scripts only. No live Redmine account, workflow mutation or server permission check was performed.

## Gate: all 13 remaining findings

No formal waivers were added. These remain open rather than changing a compact application into a screen-sized marketing page to satisfy the checker:

1. `heading-scale`, `section#login > h2`: the form heading is 24px while the masthead app title is 20px. Deliberate application-title/form-heading hierarchy.
2. `moment-none`, page: no decorative scroll moment. Deliberately omitted from a working planner.
3. `hero-screen`, `section#login`: the centered login form does not fill an entire viewport. Deliberate form layout.
4. `section-height`, `section#login`: the form does not start on a full-screen section grid. Deliberate form layout.
5. `one-section`, `p#api-key-hint`: the bordered API-key instructions are an inset help block, not a separate full-screen section.
6. `one-heading`, login h2: there is no marketing hero; the app's h1 stays in the masthead and the login form has an h2.
7. `container-edges`, masthead: compact full-width app navigation rather than the login card's content edges or 64–120px marketing margins.
8. `container-edges`, login: centered bounded form rather than page-wide marketing content.
9. `container-edges`, skip link: the first-in-order keyboard skip link is a direct body child rather than inside a kit navigation wrapper.
10. `container-edges`, Help button: aligned to the app masthead's right edge, not the centered login form.
11. `container-edges`, API-key hint: help text is inset inside its bordered instruction block.
12. `text-only`, login at 390px: a real connection form does not require a photograph, effect or fake product illustration.
13. `container`, page: existing app components are used instead of the kit's `.wrap` marketing structure.

The gate also keeps warnings about body text size, absent social-share metadata, and the login form using application-side submission. The existing form performs a real Redmine authentication flow; no mailto stand-in was introduced. A share image and canonical marketing domain are not part of this app restyle.

The authenticated checker additionally treats existing overlaid Swimlane headings and clipped scrollport content as text overlap, counts filter controls as excessive hero actions, demands pictures inside issue Cards, applies marketing heading ratios to compact context headings, and expects full-screen section heights/margins instead of the app's status bar and board. Its eight warnings concern the fixture's `.example` issue links, app action wording, small off-grid measurements, mixed masthead type sizes, word count, missing moment and share metadata. Full local detail: `.taste-skill/consistency-final.log`; gate detail: `.taste-skill/gate-final.log`.

## Reproduce the preview

```sh
npm run build
node tests/fixtures/board-preview.mjs
```

Use the skill's screenshot script on `.taste-skill/preview/index.html` with `--root .taste-skill/preview`. Generated previews, profiles and screenshots are gitignored. The preview blocks writes; it is not an interactive substitute for the application or an E2E test.
