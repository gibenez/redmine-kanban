# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- Spec: `.scratch/<feature-slug>/spec.md`
- Implementation issues: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`,
  numbered from `01`, one file per ticket.
- Triage state: a `Status:` line near the top of each issue.
  Use the role strings in `triage-labels.md`.
- Append conversation under a `## Comments` heading.

## Publishing and fetching

When a skill says "publish to the issue tracker", create the appropriate
file under `.scratch/<feature-slug>/`, creating directories as needed.

When a skill says "fetch the relevant ticket", read the referenced file.

## Wayfinding operations

Used by `/wayfinder`. The map has one child file per ticket.

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far,
  and Fog.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from
  `01`, with the question in the body.
- Type: a `Type:` line records `research`, `prototype`, `grilling`, or `task`.
- Lifecycle: wayfinding tickets use `Status: open`, `Status: claimed`,
  or `Status: resolved`, separately from implementation triage roles.
- Blocking: `Blocked by: NN, NN` lists dependencies. A ticket is
  unblocked when every listed ticket is resolved.
- Frontier: select the lowest-numbered open, unblocked, unclaimed ticket.
- Claim: save `Status: claimed` before starting work.
- Resolve: append the answer under `## Answer`, save `Status: resolved`,
  and append a gist plus link to Decisions-so-far in the map.
