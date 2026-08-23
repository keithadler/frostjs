# permit - requirements

**Working title:** `permit` (alternatives: `warden`, `least`, `frostguard`).

**One line:** A policy-driven, deny-by-default static analyzer for JavaScript that
runs in CI and refuses to let code ship if it reaches for a capability the project
has not explicitly granted.

**Relationship to existing projects:**

- Same pipeline shape as [exact](https://github.com/keithadler/magic-float-linter):
  extract -> triage -> recognize -> report -> gate. The architecture transfers; the
  recognizer is replaced.
- [frost](https://github.com/keithadler/frost) supplies the policy grammar. Policies
  are written in frost's HyperTalk-descended syntax, not YAML or JSON.

---

## 1. Problem

A team ships JavaScript to end users' browsers. Some of that code is written by
people who are not the platform owner - tenants, contractors, marketing, or a
language model. The platform owner is liable for what that code does in a
visitor's browser: reading local storage, setting cookies, calling `eval`, beaconing
to an unknown host.

There is no cheap, boring way to state "this project may not touch storage, and may
only talk to these three hosts" and have a build fail when someone violates it.

## 2. What this is not

Stating these up front, because each one is a project that eats a year.

1. **Not a runtime sandbox.** No membrane, no proxied globals, no realms, no
   `with`-scope tricks. A determined attacker with code execution defeats a
   wrapper; that fight is not worth having.
2. **Not a replacement for CSP.** It *emits* CSP, and CSP remains the runtime
   backstop. This tool is the build-time gate.
3. **Not a universal npm scanner.** Third-party dependency source is checked by
   fingerprint against a registry, not analyzed line by line. See section 8.
4. **Not a supply-chain security product.** Overlaps in places, but the goal is
   capability policy, not malware detection.

## 3. Threat model

**In scope (catches these):**

- First-party or tenant code that accidentally or carelessly uses a forbidden API.
- Code that a model generated which reached for something the prompt did not intend.
- A dependency bump that silently introduces a new network destination.
- Drift: a policy was set, and six months later nobody noticed it eroding.

**Out of scope (does not catch these):**

- Deliberately obfuscated code designed to evade static analysis.
- Runtime-constructed access (`window["local" + "Storage"]`) beyond a shallow
  constant-folding pass.
- Anything injected after the build, at serve time or via a compromised CDN.

State this honestly in the README. The value is a high floor, not a ceiling.

## 4. Success criteria

1. Near-zero false positives on a corpus of real, popular JavaScript. This is the
   product, exactly as it was for `exact`. A linter that cries wolf gets disabled.
2. A policy file for a simple project fits on one screen and is readable by someone
   who does not write JavaScript.
3. Adoptable on a legacy codebase in one afternoon via a baseline snapshot, with no
   cleanup sprint required first.
4. Runs on a mid-size repo in under ten seconds.

**Corpus (for 4.1 and ground rule 14.1).** Pinned by npm integrity hash in
`corpus/manifest.json` so "the count must not move" is reproducible: lodash
4.17.21, react-dom 18.3.1, three 0.160.0, chart.js 4.4.1, marked 12.0.0, and
swagger-ui-dist 5.11.0 as the application bundle (it genuinely persists auth
in localStorage and cookies, so it supplies true positives as well as noise).

---

## 5. Core decision: implementation language

**DECIDED 2026-08-23: Option A, Node/TypeScript, parsing with `oxc-parser`.**

Rationale: the reusable asset from `exact` is the architecture and the
false-positive discipline, not the Python. `oxc-parser` parses JS/TS/JSX natively
and is fast enough to keep the ten-second criterion (4.4) safe. Its AST shape is
less stable than ESTree, so it is wrapped behind an adapter in `src/extract/ast.ts`
from day one.

Rejected: Option B, Python with `tree-sitter-javascript`. JS users will not
`pip install` a JS linter, and TS/JSX support is a fight.

---

## 6. Architecture

Five stages. Each maps to a module.

| Stage | Module | Job |
| --- | --- | --- |
| Discover | `discover` | Walk the repo. Find `.js`, `.mjs`, `.ts`, `.jsx`, `.tsx`, plus `<script>` blocks inside `.html`. Honour excludes. |
| Extract | `extract` | Parse to AST. Emit a flat list of `CapabilityUse` records: what was touched, where, in what expression. |
| Triage | `triage` | Discard uses that cannot matter (local shadowed identifiers, type-only positions, dead branches after constant folding). |
| Decide | `policy` | Compare each surviving use against the compiled policy. Allowed, denied, or unknown. |
| Report | `report` | Text, JSON, GitHub annotations, SARIF. Exit non-zero on any denial. |

Type-only positions are skipped entirely: `declare` blocks, `import type`,
`.d.ts` files. Without this, `lib.dom.d.ts` shapes leak into the corpus count.

### 6.1 The `CapabilityUse` record

```
CapabilityUse {
  capability: string     // "storage.local", "network.fetch", "eval"
  target: string | null  // resolved URL/host if statically knowable
  file: string
  line: int
  column: int
  expression: string     // source text of the enclosing expression
  confidence: enum       // certain | probable | possible
  origin: enum           // first-party | vendored | inline-html
}
```

`confidence` mirrors `exact`'s surplus scoring. A direct
`localStorage.setItem(...)` is `certain`. A `window[k]` where `k` folds to a
constant is `probable`. A dynamic member access that cannot be resolved is
`possible` and is reported separately, never as a hard failure by default.

`--min-confidence` defaults to `probable`. `possible` findings print in a
separate section and never fail the build unless opted in.

## 7. Capability taxonomy

The denylist vocabulary. Deny-by-default means every one of these is off unless
the policy grants it.

1. **storage** - `localStorage`, `sessionStorage`, `indexedDB`, `caches`,
   `document.cookie`, `navigator.storage`.
2. **network** - `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
   `navigator.sendBeacon`, dynamic `import()`, `Worker`/`SharedWorker` URLs.
3. **codegen** - `eval`, `new Function`, `setTimeout`/`setInterval` with a string
   argument, `document.write`.
4. **dom-escape** - `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
   `document.createElement("script")`, `<iframe>` creation, `srcdoc`.
5. **identity** - `navigator.userAgent`, `geolocation`, `mediaDevices`,
   `clipboard`, `credentials`, `permissions`, canvas/audio fingerprinting
   signatures.
6. **navigation** - `location` assignment, `window.open`, `history` manipulation,
   `postMessage` to a non-`self` target.
7. **globals** - assignment to `window.*`, `globalThis.*`, prototype mutation on
   built-ins.
8. **worker** - `navigator.serviceWorker.register`, `Worker`, `SharedWorker`.
   A service worker intercepts every future request; its blast radius is large
   enough to deserve its own family rather than hiding inside `network`.

Each capability has a stable code for `--select` / `--ignore` and for inline
suppression, following `exact`'s convention: `// permit: ignore[storage.local]`.

## 8. Third-party dependencies

The hard part, handled by not solving the general case.

1. **Fingerprint registry.** A signed manifest mapping SHA-384 hashes to
   `(package, version, capability set)`. A dependency whose hash is in the
   registry is admitted with its recorded capabilities checked against policy.
2. **Unknown hash = build failure**, with a report naming the file and offering
   `permit vendor add <path>` to review and admit it deliberately.
3. **Registry population.** Bootstrap by analyzing a package once, recording the
   capability set, and committing the entry. Optionally a shared community
   registry later; do not depend on one existing.
4. **SRI output.** Emit `integrity` attributes from the same hashes, so the
   browser enforces the registry at load time.

Version churn is the known pain point: every patch release is a new hash. Mitigate
with a `permit registry sync` command that re-fingerprints on lockfile change.
A repo with no lockfile gets a warning from `registry sync`; the gate itself
does not care, since a vendored file is checked by its own hash.

## 9. Policy language

Policy is frost's `.policy` dialect. **Revised 2026-08-23** after reading
frost's actual policy grammar (`frostlang/audit.py`): it is line-oriented with
no block header, comments are `--` or `#`, keywords are case-insensitive, the
grant verb is `may` and the refusal verb is `forbid`, and a trailing comment on
a rule is its *hint*, printed when the rule refuses something. The original
`allow ... / end policy` sketch was not frost; this is.

```
policy "checkout-widget"
may reach "api.example.com", "cdn.example.com"
may use session storage
may use html injection in "src/legacy/banner.js"   -- old banner, rewrite due Q4
may use local storage in "src/legacy/*" until 2026-12-01
forbid cookies                                      -- consent banner owns these
```

Grammar, one rule per line:

```
policy "<name>"                                   (optional, once)
may use <capability> [in "<glob>", ...] [until YYYY-MM-DD]
forbid [using] <capability> [in "<glob>", ...]
forbid everything else                            (optional, readability only)
```

`<capability>` is a phrase (`local storage`, `cookies`, `the network`,
`html injection`...) or a code (`storage.local`, `dom-escape`). A family name
grants the whole family. `may reach "<host>"` arrives with the network family
in Phase C. Deny-by-default, so the file only ever grants; `forbid` exists to
carve an exception out of a broader grant (`may use storage` + `forbid cookies`)
and always wins over `may`. The config file is `permit.policy`, matching
frost's `.policy` extension for policies (`.frost` is for scripts).

Requirements:

1. Grants may be scoped to a path glob (`in "src/legacy/*"`) so exceptions are
   local and visible, not global.
2. A grant may carry a hint (its trailing comment) and an expiry date; expired
   grants fail the build with a distinct message. This is how you fight drift.
3. The compiler emits three artifacts from one policy: the linter ruleset, a
   `Content-Security-Policy` header string, and a human-readable summary.
4. Policy compilation errors are fatal and precise - file, line, and what was
   expected.
5. `deny everything else` is optional, since deny is the default. `permit summary`
   always prints the implicit deny so a non-engineer reviewer sees it.

## 10. Outputs

1. `text` - default. File, line, column, capability, the offending expression, the
   policy line that denied it.
2. `json` - stable schema, versioned.
3. `github` - inline PR annotations.
4. `sarif` - SARIF 2.1.0 for code scanning, one rule per capability.
5. `csp` - print the derived CSP header and nothing else, for the deploy step.
6. `summary` - a plain-English capability report for a non-engineer reviewer.

## 11. Adoption and noise control

Ported directly from `exact`, because it is already proven.

1. **Baseline snapshots.** `permit --baseline .permit-baseline.json` freezes
   existing violations. Only new ones fail. Key on
   `(file, capability, expression text)`, not line number. A file rename
   invalidates its entries; this is accepted and documented.
2. **Inline suppression.** `// permit: ignore[storage.local]` with an optional
   bracketed capability list. A bare `// permit: ignore` suppresses all.
3. **Changed-lines-only mode** for PR checks, using the git diff.
4. **`--exit-zero`** for informational runs.
5. **Config discovery** walking up to the nearest `permit.policy`, mirroring
   `exact`'s `[tool.exact]` discovery.

## 12. Integrations

1. **CLI** - `permit <paths>`, the primary interface.
2. **GitHub Action** - composite action, inputs mirroring `exact`'s `action.yml`
   (`paths`, `format`, `args`, `fail-on-findings`). Pass inputs via `env`, never
   spliced into the script body - splicing is a shell injection vector.
3. **Pre-commit hook** - `.pre-commit-hooks.yaml`.
4. **ESLint plugin** - runs the same engine as an ESLint rule, sharing config and
   suppression semantics with the CLI. Same relationship `flake8_plugin.py` has to
   `exact`'s CLI.
5. **Deploy step** - `permit csp` emits the header for nginx or the CDN config.

---

## 13. Milestones

**Phase A - walking skeleton**

1. Repo, packaging, CI, licence, `--version`. **DONE 2026-08-23.**
2. Discovery and parsing of `.js`/`.mjs` only. **DONE 2026-08-23.**
3. Extract one capability family end to end: `storage`. **DONE 2026-08-23.**
   Interim shadowing rule until step 14: if a file declares the name a match
   rests on (`caches`, `window`, `document`...), the use is `possible`, not
   `certain`. Smoke run over 347 files / 24.5 MB of node_modules: 1 certain
   (true positive in `debug`), 8 possible, 2.2s.
4. Hardcoded deny-all policy, text output, non-zero exit. **DONE 2026-08-23.**
   *Acceptance:* running it on a file containing `localStorage.setItem("a", 1)`
   fails the build and names the line. Verified on the built binary.
   `--exit-zero` (11.4) landed here too since the gate needed it for tests.

**Phase B - the policy language**

5. Frost grammar for `policy`, `may use`, `forbid`, path scoping, `until`.
   **DONE 2026-08-23.** `src/policy/parse.ts`, `src/policy/vocabulary.ts`.
6. Policy compiler to internal ruleset. **DONE 2026-08-23.** `forbid` always
   wins over `may`; a family grants its members; expired grants deny with a
   distinct reason; grants within 14 days of expiry warn.
7. Config discovery and `permit.policy` resolution. **DONE 2026-08-23.**
   Searched from the common ancestor of the inputs upward, nearest wins;
   `--policy` overrides; globs resolve relative to the policy file; `--today`
   pins the date for expiry checks.
8. Precise policy syntax errors. **DONE 2026-08-23.** File, line, column,
   the line as written with a caret, a `try:` suggestion, "did you mean" for
   near-miss capability phrases, and rejection of rules that parse but cannot
   mean anything (`until` on a `forbid`, absolute paths, unknown member codes).

**Phase C - full taxonomy**

9. Corpus harness. **DONE 2026-08-23.** `corpus/manifest.json` pins six
   packages by npm integrity hash; `npm run corpus` fetches once, verifies,
   scans, and diffs against `corpus/expected.txt`. Baseline: 2013 files,
   21.1 MB, 3.3s, 32 findings, every `certain` one a verified true positive.
10. `network`. **DONE 2026-08-23.** fetch, XMLHttpRequest, WebSocket,
    EventSource, sendBeacon, dynamic import of an absolute URL; static target
    resolution under frost's closed-authority rule; `may reach` / `forbid
    reaching` with host globs; unknown destination is never allowed by a host
    list. Corpus: 32 -> 126 findings, all certain ones verified true.
11. `codegen`. **DONE 2026-08-23.** eval (direct and indirect), Function as a
    callee only, timers with string code, document.write. Corpus 126 -> 159,
    all verified.
12. `dom-escape`. **DONE 2026-08-23.** Writes to innerHTML/outerHTML/srcdoc
    on any object (reads are not injection), insertAdjacentHTML,
    createContextualFragment, createElement("script"|"iframe"). Corpus
    159 -> 220, all verified.
13. `identity`. **DONE 2026-08-23.** navigator members for device,
    geolocation, media, clipboard, credentials, permissions; execCommand
    copy/paste; destructuring from navigator. Canvas/audio fingerprinting
    signatures deliberately omitted as unseparable from charting and 3D
    rendering. Corpus 220 -> 246, all verified.
14. `navigation`. **DONE 2026-08-23.** location writes and calls (reads and
    `hash` excluded), window.open, history, postMessage to another window.
    Targets resolved from the assigned URL or origin. Corpus 246 -> 258.
15. `globals`. **DONE 2026-08-23.** Assignment through window/globalThis
    (event-handler properties and location excluded), mutation of built-ins
    and their prototypes directly or via Object.defineProperty/assign.
    Implicit globals wait for Phase D scope analysis. Corpus 258 -> 506, of
    which 180 are `possible` (minified locals named like built-ins).
16. `worker`. **DONE 2026-08-23.** Worker, SharedWorker,
    navigator.serviceWorker.register, worklet addModule, with targets from
    the script URL. Corpus 506 -> 514. **Phase C complete.**

**Phase D - noise control** (renumbered after the corpus harness was inserted as step 9)

17. Triage: scope analysis, shadowed identifiers, constant folding.
    **DONE 2026-08-23.** `src/extract/scope.ts` builds lexical scopes with
    hoisting; a recognizer's anchor identifier must be a free reference or
    the match is dropped (a local named `caches` is not the global at all).
    `with` bodies are ambiguous and stay `possible`. `const k = "..."` folds
    into `window[k]` at `probable`. Corpus 514 -> 324: 200 hedged findings
    were locals, 10 were promoted to certain. The interim file-level
    declared-name check from step 3 is gone.
18. Confidence tiers, `--min-confidence`. **DONE 2026-08-23.**
19. Inline suppression. **DONE 2026-08-23.** `// permit: ignore[...]` on the
    line or the line above; counted in the summary as suppressed.
20. Baseline snapshots. **DONE 2026-08-23.** `--baseline <file>` and
    `--update-baseline`; keyed on (file, capability, expression), paths
    relative to the baseline file.
21. Changed-lines-only mode. **DONE 2026-08-23.** `--changed-since <ref>`
    from `git diff -U0` hunks; untracked files count whole. **Phase D
    complete.**

**Phase E - outputs and CI**

22. JSON and SARIF. **DONE 2026-08-23.** `--format json` (schema 1) and
    `--format sarif` (2.1.0).
23. GitHub annotations. **DONE 2026-08-23.** `--format github`.
24. GitHub Action, pre-commit hook. **DONE 2026-08-23.** Composite action
    with inputs via `env` into `scripts/action.sh`; injection test included.
25. CSP emission. **DONE 2026-08-23.** `permit csp` and `permit summary`
    (sections 9.3, 10.5, 10.6). **Phase E complete.**

**Phase F - dependencies**

26. Fingerprint registry format and `vendor add`. **DONE 2026-08-23.**
    `vendored "<glob>"` policy line; `.permit/registry.json` beside the
    policy keyed on `sha384-` integrity; `permit vendor add`.
27. `registry sync` against the lockfile. **DONE 2026-08-23.** Same
    capability set re-admits; a gained capability refuses with a diff; gone
    files prune; lockfile hash recorded; no lockfile warns. The earlier note
    that the gate hard-fails without a lockfile is withdrawn: a project that
    vendors one minified file into `static/` has no lockfile and no reason
    to fail.
28. SRI attribute emission. **DONE 2026-08-23.** `permit sri` in text, json
    and html forms. **Phase F complete.**

**Phase G - reach**

29. TypeScript and JSX. **DONE 2026-08-23.** Type positions, `declare`,
    `import type` skipped; `as`/`!`/`satisfies` unwrapped; parameter
    properties, enums and namespaces bind; JSX `dangerouslySetInnerHTML`,
    `srcdoc`, `<script>`, `<iframe>` recognized; `.d.ts` skipped.
30. Inline `<script>` in HTML. **DONE 2026-08-23.** Blocks parsed with the
    rest of the file masked to whitespace so positions are exact; origin
    `inline-html`.
31. ESLint plugin.

**Phase H - the showpiece**

32. Run against a well-known open-source web app, publish the findings and the
    policy file that would have prevented them. This is the README hook, the same
    role the sympy finding plays for `exact`.

---

## 14. Ground rules

1. Zero false positives is the product. Any engine change re-runs the corpus scan;
   the finding count must not move unless the step intends it.
2. Never use em dashes in prose, docs, or comments - use " - " instead.
3. New behaviour gets a test first or alongside, never after the commit.
4. Every new CLI flag gets: help text, a README usage line, and a test.
5. One step, one commit. Mark steps DONE with a date in this file.
6. The README states the threat model's limits plainly. No security theatre.

## 15. Open questions

All resolved 2026-08-23.

1. **Node or Python** - Node/TypeScript with `oxc-parser`. See section 5.
2. **Where the policy compiler lives** - this repo. Frost supplies the grammar and
   parser as a dependency; `permit` owns the semantics (what `allow network to`
   means, CSP emission) in `src/policy/`. Putting capability semantics in frost
   would couple frost's release cadence to permit's taxonomy.
3. **Fingerprint registry** - both, with per-project first. A committed
   `.permit/registry.json` is mandatory. A shared registry is an optional
   upstream that per-project entries can be pinned from. Not built until Phase F
   has users.
4. **Expired grants** - warning window, then hard failure. A grant with
   `until <date>` warns for a configurable period (default 14 days) before the
   date and fails after it. A surprise hard failure on a Monday for a reason
   nobody remembers is the "linter gets disabled" failure mode from 4.1.
5. **Per-tenant mode** - later. `permit.frost` discovery walks up, so a monorepo
   with one policy per tenant directory already gets most of the way there.
