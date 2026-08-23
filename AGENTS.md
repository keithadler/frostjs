# Instructions for AI coding agents working in this repository

frostjs is a deny-by-default capability linter for JavaScript, and this
repository is its own code. If you are an assistant making changes here,
these are the rules that matter.

## The product rule

Zero false positives is the product. Before you finish any change under
`src/extract/`, run:

```bash
npm run corpus
```

The diff must be empty. If your change is meant to move it, run
`npm run corpus -- --update`, read every added or removed line, confirm
each added `certain` finding is a true positive by opening the file in
`corpus/.cache/`, and say what changed and why in your summary. A finding
you cannot show to be real is a bug in your recognizer, not a judgment
call.

## Before you finish

```bash
npm run lint        # prettier --check, then typecheck src, test and scripts
npm test            # vitest
npm run corpus      # the false-positive guard
```

All three must pass. Do not mark a task done with a failing test, and do
not weaken a test to make it pass.

## How the code is laid out

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. The short version:
`discover` finds files, `extract` turns them into `CapabilityUse` records,
`policy` decides, `report` prints. Recognizers live in
`src/extract/recognizers/`, one per capability family, and never reason
about shadowing themselves: they return the identifier node the match
rests on as `via`, and the scope analysis drops the match if it resolves
to a local.

## Conventions that are checked or reviewed

- Tests first or alongside, in `test/<area>.test.ts`. A recognizer change
  needs both positives and a `must stay quiet` block with the look-alikes.
- Every new CLI flag gets help text in `src/cli/args.ts`, a usage line in
  the README, and a test.
- The policy dialect is frost's. Before adding a form, look at how frost's
  `.policy` files say it and use the same words.
- No em dashes in prose, docs or comments; use " - ". American spelling.
- `oxc-parser` is pinned to patch releases. Do not widen the range.
- Commits are authored as `keithadler <keith.adler@icloud.com>`.

## What not to do

- Do not edit `corpus/expected.txt` by hand.
- Do not add dependencies without saying why in your summary.
- Do not add `// frostjs: ignore` or `may use everything` anywhere in this
  repository's own fixtures to make a test pass.
- Do not change the wording of a denial line without updating README.md
  and SHOWCASE.md, which quote real output.
