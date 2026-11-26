# Issue editor dropdown presentation

## Requested behavior

- Every editable dropdown in the issue editor uses the same popup visual language as Sprint filters: bordered surface, padded choices, hover/selection treatment, bounded scrolling and light/dark tokens. Do not repeat the field label or show a heading/divider inside the popup; retain the external field label and the listbox's accessible name.
- Keep editor fields single-select. This is a presentation change, not multi-selection or a change to field semantics.
- Applies to creation Project/Tracker and the shared Assignee, Swimlane Status and Priority controls. Existing read-only creation Status/Priority inputs and Parent/Sprint plain text stay unchanged.
- Preserve native field IDs, labels, values, form validation, dirty tracking, workflow restrictions, loading locks and disabled/read-only Sprint behavior.
- Allow keyboard navigation and selection, typeahead, dismissal with Escape without closing the editor, and normal Tab navigation. Close the menu when choosing a value, clicking outside or closing the editor. Only one editor menu is open at a time.
- Panels remain usable inside the modal, fit narrow viewports and open above the field when space below is insufficient.

## Add Subtask Project menu

- Reuse `compareProjectPresentation` and `projectColor`, exactly as Sprint Project filters do: Projects with a valid configured color first, then natural case-insensitive alphabetical names, with natural ID tie-breaking. Do not sort by hue or group by parent.
- Display the same Project swatches alongside Project choices, using transparent swatches for missing/invalid colors.
- Retain the initial Choose a Project placeholder and explicit Project choice. Project eligibility and tracker selection behavior remain unchanged.

## Integration

Enhance the existing select controls using `src/editor-select-menus.js`, retaining the native select as the form/value source. Share popup CSS classes with Sprint filter menus. Keep Project presentation ordering in the editor UI rather than changing domain eligibility rules.

## Verification

- Full browser suite: 294 passed, including 12 editor-menu tests covering selection, Project order/swatches, dependency updates, keyboard/dismissal, disabled workflow/Sprint states, top-layer rendering, viewport fitting, scrolling and light/dark themes.
- Editor-menu unit tests: 32 passed; the targeted menu, Project presentation and subtask suites pass 52 tests together.
- Full unit suite: 330 passed, with the same pre-existing Backlog-label failure at `tests/sprint-filter-controls.test.js:17`.
- Browser runs build production assets before serving them. Whitespace checks pass.
