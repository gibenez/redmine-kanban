# Single-line planning header

Type: prototype
Status: resolved

## Question

How should Project, Sprint, Show closed, Sprint commitment and totals fit on
one line to give the Sprint Board more vertical space?

## Answer

The user selected **A — Inline panels**. Keep the two panels and the Sprint
name, with labels, selectors, state and totals inline. Target 42px height;
scroll the planning strip horizontally on narrow windows rather than wrapping.

The full three-variant prototype is preserved on branch
`prototype/compact-planning-header`, commit
`f609bbe7868c370131a5500ec5f19b9524b1881c`.

The implementation uses static markup and production styles; no variant
parameter, development-only imports or prototype switcher are needed.
