# Contributing to frostjs

Thanks for looking. frostjs is small on purpose, and the rules below are
what keep it small and keep it trusted.

## The one rule that matters

**Zero false positives is the product.** A linter that cries wolf gets
disabled, and a disabled capability gate protects nobody. Every change to
`src/extract/` is judged first by whether it adds noise on real code.

That is enforced, not hoped for:

```bash
npm run corpus
```

fetches six pinned, hash-verified npm packages (lodash, react-dom, three,
chart.js, marked, swagger-ui-dist; about 21 MB of real JavaScript), runs the
extractor over them, and diffs the findings against `corpus/expected.txt`.
The diff must be empty. If your change is *meant* to move it, run
`npm run corpus -- --update`, read every added or removed line, confirm each
added `certain` finding is a true positive by opening the file, and explain
the change in your pull request. A finding that is not obviously real is a
bug in the recognizer, not a judgment call.

## Setting up

```bash
git clone https://github.com/keithadler/frostjs
cd frostjs
npm install
npm test            # vitest, about a second
npm run lint        # prettier --check, then typecheck src, test and scripts
npm run build       # tsc to dist/
npm run corpus      # needs network the first time
```

Node 20 or later. No other runtime dependencies beyond `oxc-parser`.

## How the code is laid out

See [ARCHITECTURE.md](ARCHITECTURE.md). The short version: `discover`
finds files, `extract` turns them into `CapabilityUse` records, `policy`
decides, `report` prints. Recognizers live in `src/extract/recognizers/`,
one file per capability family.

## Adding a recognizer

1. Write the tests first, in `test/<family>.test.ts`. Two blocks: the
   positives, and a `must stay quiet` block with every look-alike you can
   think of (same name on another object, object keys, declarations,
   destructuring, strings, comments, a local shadowing the global).
2. Implement it in `src/extract/recognizers/<family>.ts`. Return a `Match`
   whose `via` is the identifier node the match rests on; the scope
   analysis drops the match if that identifier resolves to a local, so you
   do not handle shadowing yourself.
3. Register it in `src/extract/index.ts` and add its codes to
   `MEMBER_CODES` in `src/policy/vocabulary.ts`, with a phrase if one reads
   naturally.
4. `npm run corpus`. Read the diff. Every new `certain` finding must be a
   verified true positive.
5. Document the codes in the README table.

## Changing the policy language

The policy dialect is frost's, not ours to invent. Before adding a verb or
a form, check how frost's `.policy` files say it
(`frostlang/audit.py` in the frost repository is the reference parser) and
use the same words. Every new form needs: a parser test, a compiler test,
a precise error with a `try:` suggestion for the obvious mistake, and a
line in the README grammar block.

## Conventions

- **Tests first or alongside.** Never after the commit.
- **One step, one commit.** A commit message says what changed and why;
  if it moved the corpus, it says what was added and that it was verified.
- **Every new CLI flag** gets help text in `src/cli/args.ts`, a usage line
  in the README, and a test.
- **No em dashes** in prose, docs or comments. Use " - " instead.
- **American spelling.** License, behavior, color, honor.
- **Prettier** formats everything; `npm run lint` must pass.
- **No new dependencies** without a reason in the pull request. The tool
  is installed into other people's CI; every dependency is their problem
  too.

## Reporting a false positive

Open an issue with the smallest file that reproduces it and the frostjs
output. A false positive is a bug with the highest priority this project
has. If you can, add the case to the relevant `must stay quiet` test block
in the same pull request as the fix.

## Security

See [SECURITY.md](SECURITY.md). Please do not report security issues in
public issues.
