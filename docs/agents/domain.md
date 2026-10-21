# Domain Docs

## Before exploring

This repo uses a single-context layout:

- Read root `GLOSSARY.md` for domain vocabulary.
- Read relevant ADRs under `docs/adr/` for decisions affecting the work.

If these files do not exist, proceed silently. The `/domain-modeling`
skill creates them lazily as terms or decisions are resolved.

## Use the glossary's vocabulary

Use glossary terms when naming domain concepts in issues, proposals,
hypotheses, code, and tests. Respect explicitly avoided synonyms.

If a needed concept is missing, reconsider whether it belongs to the
domain; note genuine vocabulary gaps for `/domain-modeling`.

## Flag ADR conflicts

Explicitly surface proposals that contradict an existing ADR, identifying
the ADR and explaining why the decision merits reopening.
