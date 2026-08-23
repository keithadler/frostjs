# Architecture

frostjs is a pipeline of five stages. Each is a directory or a file under
`src/`, each has one job, and data flows one way.

```
discover  ->  extract  ->  (triage)  ->  policy  ->  report
 files        CapabilityUse           Decision      text/json/sarif/github
```

Triage is not a separate stage in the code: the scope analysis, constant
folding and confidence rules live inside `extract`, because a use that
resolves to a local is best never emitted at all.

## discover (`src/discover/index.ts`)

Walks the input paths and returns absolute file paths, sorted and
deduplicated. Knows the source extensions (`.js .mjs .cjs .jsx .ts .tsx
.mts .cts .html .htm`), skips declaration files, and skips `node_modules`,
`dist`, `build`, `coverage` and `.git` unless a vendored glob reaches into
one of them (`include`). A path that names a file directly is always
included.

## extract (`src/extract/`)

| File | Job |
| --- | --- |
| `ast.ts` | The only file that imports `oxc-parser`. Parses, builds the line index, normalizes syntax errors. Everything downstream imports AST types from here so a change in oxc's tree shape is absorbed in one place. |
| `html.ts` | Finds inline `<script>` blocks and parses each with the rest of the file masked to whitespace, so positions are already HTML positions. |
| `walk.ts` | Generic AST walk that knows which child keys are binding positions (declarations, params, patterns, imports) and which are names rather than references (non-computed member properties, object keys). Recognizers see every node with that context. |
| `scope.ts` | Lexical scope analysis with hoisting. For every reference-position identifier decides: free (a global), bound (a local), or ambiguous (inside `with`). Also folds `const k = "literal"`. Results are written onto the identifier nodes as annotations (`annotations.ts`). |
| `typescript.ts` | What counts as type-only (never a reference) and which TypeScript expression wrappers to look through. |
| `target.ts` | Static resolution of a network destination from an argument expression, under frost's rule: a literal that closes the authority fixes the host and nothing after the slash can move it. |
| `suppress.ts` | `// frostjs: ignore[...]` comments. |
| `capability.ts` | The `CapabilityUse` record. |
| `index.ts` | Runs the scope analysis, walks the tree, asks each recognizer, applies the free/bound/ambiguous rule, grows the reported expression outward through the member/call chain, and emits records. |
| `recognizers/` | One file per capability family. |

### The contract a recognizer signs

A recognizer is a function from a `Visit` (node, ancestors, binding flag)
to a `Match` or null. A `Match` names the capability code, an optional
target, a confidence, the node to anchor the report on, and `via`: the
identifier node the match rests on (`localStorage`, `window`, `document`,
`Function`...). `extract` then:

- drops the match if `via` resolves to a local binding (a local named
  `caches` is not the global, full stop);
- downgrades to `possible` if `via` is inside a `with` block;
- downgrades `certain` to `probable` if the member name came from a fold
  rather than a literal.

So recognizers never reason about shadowing. They pattern-match on shape
and report what they rest on. Two modules hold what they share:
`recognizers/types.ts` (the `Match` and `Resolved` records, `match()`,
`callArgs()` for "is this node the callee, and what are the arguments",
`stringValue()`) and `recognizers/resolve.ts` (`isIdentifier`,
`memberName` for a literal, folded const or literal concatenation,
`asGlobalObject` for `window` / `globalThis` / `self` at `probable`,
`asNamedGlobal` for `document` / `navigator` / `history` bare or via the
global object, and `asGlobalIn` for "one of these names, bare or via the
global object"). The `globals` family recognizer lives in
`recognizers/globals.ts`.

### Confidence

`certain`: a direct, unambiguous use. `probable`: the same use via `self`
(often a local alias for `this` in old code) or through a folded constant.
`possible`: cannot be resolved (`with`). The default floor for failing the
build is `probable`; `possible` is listed as unknown.

## policy (`src/policy/`)

| File | Job |
| --- | --- |
| `parse.ts` | frost's policy dialect: line-oriented, `--` or `#` comments (quote-aware), case-insensitive keywords, double-quoted strings. Produces `Rule` records and a `vendored` list. Errors carry file, line, column, the line as written, and a `try:` suggestion. |
| `vocabulary.ts` | Phrases a policy author may write (`local storage`, `cookies`, `the network`) mapped to codes; the list of families and member codes. |
| `compile.ts` | Turns a parsed policy into a `Policy` whose `evaluate(use)` applies: forbids first, then live grants, then expired grants (their own reason), then "not granted". Host lists match known destinations by pattern; an unknown destination is never allowed by a host list. Computes expiry warnings. |
| `glob.ts` | Path globs for `in`: `*` within a segment, `**` across, a bare name at any depth, a plain directory covering everything beneath it. |
| `config.ts` | Finds `frostjs.policy` from the inputs' common ancestor upward. |
| `csp.ts` | Derives the `Content-Security-Policy` header from the same policy. |
| `index.ts` | `decide()`: applies the confidence floor, suppression and the vendored-unregistered case on top of `Policy.evaluate`, producing `Decision` records with a verdict (`allowed`, `denied`, `unknown`, `suppressed`, `baselined`, `unchanged`). |

## report (`src/report/`)

`text.ts` is the default and owns the wording of a denial
(`denialText`), which the other formats reuse. `json.ts` is the versioned
machine format, `sarif.ts` is SARIF 2.1.0, `github.ts` emits workflow
commands followed by the text report, `summary.ts` is the plain-English
reading of a policy.

## Around the pipeline

- `src/cli/args.ts` parses argv into `ParsedArgs` and owns the help text.
  `src/cli/run.ts` is the orchestrator: one function per command, a shared
  `loadPolicy`, exit codes 0 (clean), 1 (denied), 2 (usage or input
  error). `src/cli/main.ts` is the bin shim.
- `src/init.ts`: the starter policy `frostjs init` writes.
- `src/audit.ts`: `frostjs audit`, which `scripts/sweep.ts` runs over
  popular packages.
- `src/baseline.ts`, `src/changed.ts`: adoption helpers (baseline
  snapshots keyed on file, capability and expression text; changed lines
  from `git diff -U0`).
- `src/registry.ts`, `src/sync.ts`: the fingerprint registry for vendored
  code and the sync that reconciles it after a dependency bump.
- `src/eslint.ts`: the ESLint plugin, which runs the same `extract` and
  `decide` on each file ESLint hands it.
- `scripts/corpus.ts`: the false-positive guard. `scripts/showcase.ts`:
  reproduces `SHOWCASE.md`. `scripts/action.sh`: the GitHub Action entry
  point; inputs arrive only through the environment.

## Invariants worth knowing before changing anything

1. **Reported paths are relative to the working directory; policy globs
   are relative to the policy file's directory.** `run.ts` maps between the
   two with `scopePath`.
2. **Positions are 1-based line and column, computed from byte offsets via
   the line index.** For HTML, offsets are into the original file because
   the masking preserves them.
3. **Recognizers must not fire on reads where the capability is a write**
   (`innerHTML`, `location`), must not fire on a bare `Function` reference,
   and must not fire on `import()` of a relative path or bare specifier.
   The tests' `must stay quiet` blocks are the specification.
4. **`npm run corpus` must not move** unless the commit says why.
