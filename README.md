# permit

A policy-driven, deny-by-default static analyzer for JavaScript. It runs in CI
and refuses to let code ship if it reaches for a capability the project has not
explicitly granted: storage, network, `eval`, DOM injection, identity, and so on.

## Status

Pre-alpha. Phases A, B and C are in: it discovers `.js`/`.mjs`, recognizes
all eight capability families, reads a `permit.policy` written in frost's
policy dialect, and fails the build on anything the policy does not grant.
Phase D (noise control: scope analysis, constant folding, suppression,
baselines) is next. See [REQUIREMENTS.md](REQUIREMENTS.md) for the full plan
and the milestone log.

```
$ cat permit.policy
policy "checkout-widget"
may use session storage
may use local storage in "src/legacy/*"      -- old code, rewrite by Q4
forbid cookies                               -- consent banner owns these
may use the cache until 2026-08-30           -- service worker experiment

$ permit src
src/app.js:2:1: storage.local denied by "deny everything": localStorage.setItem("not-here", 1)
src/legacy/old.js:2:1: storage.cookie denied by "forbid cookies" (line 4): consent banner owns these: document.cookie

warning: permit.policy line 5: "may use the cache until 2026-08-30" expires in 7 days

3 files, 2 denied, 0 unknown
$ echo $?
1
```

## Policy files

A policy is a `permit.policy` file in frost's policy dialect: one rule per
line, `--` or `#` comments, case-insensitive keywords. Deny-by-default, so
the file only ever grants. A trailing comment on a rule is its *hint*, and is
printed whenever that rule refuses something.

```
policy "<name>"                                    optional, once
may use <capability> [in "<glob>", ...] [until YYYY-MM-DD]
may reach "<host>", ... [in "<glob>", ...] [until YYYY-MM-DD]
forbid [using] <capability> [in "<glob>", ...]
forbid reaching "<host>", ... [in "<glob>", ...]
forbid everything else                             optional, readability only
```

`<capability>` is a phrase or a code. A family name grants the whole family.

| phrase | code |
| --- | --- |
| `storage` | `storage` (every member below) |
| `local storage` | `storage.local` |
| `session storage` | `storage.session` |
| `cookies` | `storage.cookie` |
| `indexeddb` | `storage.indexeddb` |
| `the cache`, `caches` | `storage.cache` |
| `navigator storage` | `storage.navigator` |
| `the network` | `network` (any destination) |
| `code generation`, `eval` | `codegen` |
| `html injection` | `dom-escape` |
| `identity`, `fingerprinting` | `identity` |
| `navigation` | `navigation` |
| `globals` | `globals` |
| `workers`, `service workers` | `worker` |
| `everything` | `*` |

Rules:

- `forbid` always wins over `may`, so `may use storage` + `forbid cookies`
  grants everything in storage except cookies.
- `in` scopes a rule to path globs (`*` within a segment, `**` across
  segments, a bare name matches at any depth, a plain directory matches
  everything beneath it). Globs are relative to the policy file's directory.
- `may reach` grants the network family only to the named hosts. `*` in a
  host spans any characters (`*.internal`). `"same-origin"` names relative
  URLs. A destination that cannot be read from the code is **not** allowed by
  a host list: cannot be shown to be allowed is not allowed. Grant
  `may use the network` if you really mean any destination.
- `until` puts an expiry on a grant. Inside the last 14 days the build warns;
  after the date the grant denies with its own message. This is how drift is
  fought: an exception has to be renewed on purpose.

`permit.policy` is searched for in the directory shared by all the given
paths, then upward; the nearest one wins, so a monorepo can keep one per
tenant directory. `--policy <file>` overrides the search. With no policy at
all, every capability is denied and a note says so.

## Usage

```
permit <paths...>        discover and analyze .js/.mjs files under paths
permit csp               print the Content-Security-Policy header the policy implies
permit summary           print a plain-English reading of the policy
permit --exclude <name>  skip directories with this name (repeatable)
permit --exit-zero       report findings but always exit 0
permit --policy <file>   use this policy instead of searching for permit.policy
permit --today <date>    treat YYYY-MM-DD as today when checking expiry
permit --min-confidence <c>  lowest confidence that fails: certain, probable (default), possible
permit --baseline <file>     denials recorded in this file do not fail the build
permit --update-baseline     write every current denial into the baseline and exit 0
permit --changed-since <ref> fail only on uses in lines changed since the git ref
permit --format <f>      text (default), json, sarif, or github
permit --version         print the version and exit
permit --help            show usage
```

`node_modules`, `dist`, `build`, `coverage` and `.git` are always skipped.
A path that names a file directly is always analyzed.

Exit codes: `0` clean, `1` policy violations, `2` usage or input error
(bad flag, missing path, syntax error).

Uses with `possible` confidence are listed under "unknown" and never fail the
build; `certain` and `probable` uses do.

## GitHub Action

```yaml
- uses: keithadler/permit@main
  with:
    paths: src
    args: --baseline .permit-baseline.json --changed-since origin/main
    fail-on-findings: "true"
```

Inputs: `paths` (default `.`), `format` (default `github`, which annotates
the pull request inline), `args` (extra flags), `fail-on-findings` (set
`"false"` for an informational run). Inputs reach the script through the
environment only, never spliced into the script body, so a hostile input is
an argument and not a command.

## pre-commit

```yaml
repos:
  - repo: https://github.com/keithadler/permit
    rev: main
    hooks:
      - id: permit
```

## One policy, three artifacts

The same `permit.policy` drives the linter ruleset, a CSP header, and a
reviewer's summary, so they cannot drift apart.

`permit csp` prints the header and nothing else, for nginx or the CDN
config. Only directives the policy determines are emitted: `connect-src`
from `may reach` hosts (`'none'` when nothing is granted, `*` for
`may use the network`), `script-src 'self'` plus `'unsafe-eval'` when code
generation is granted and the reach hosts when dynamic import is, and
`worker-src` when workers are. Expired grants do not widen it; path-scoped
grants do, because a header covers the whole page.

`permit summary` prints what the code may do, what it may not, and spells
out the implicit deny:

```
Policy "proj" (permit.policy)

This code may:
  - use session storage (line 2)
  - use local storage, only in src/legacy/* (line 3) - old code, rewrite by Q4
  - use the cache, until 2026-08-30 (line 5) - service worker experiment

It may not, even where a broader grant would allow it:
  - use cookies (line 4) - consent banner owns these

Everything else is denied. In particular this code may not use: the network, code generation, html injection, identity, navigation, globals, workers.
```

## Output formats

- `text` (default): one line per denial with the policy line that denied
  it, unknowns in their own section, warnings, then a summary.
- `json`: a versioned document (`schema: 1`) with every decision, the
  policy used, a summary by verdict, and expiry warnings.
- `sarif`: SARIF 2.1.0 for code scanning. One rule per capability code;
  denied uses are errors, unknown uses warnings, baselined uses carry
  `baselineState: "unchanged"`.
- `github`: GitHub Actions workflow commands (`::error file=...`) so each
  denial shows up inline on the pull request, followed by the text report.

## Adopting permit on an existing codebase

```bash
permit --baseline .permit-baseline.json --update-baseline src
```

That records every current denial, keyed on file, capability and expression
text (never line numbers), and exits 0. From then on
`permit --baseline .permit-baseline.json src` fails only on *new* uses;
existing ones are counted as "baselined". Commit the file; shrink it as the
debt is paid down. Paths inside it are relative to the file's directory.

For pull-request checks, `permit --changed-since origin/main src` fails only
on uses that sit in lines the branch added or modified; the rest are counted
as "unchanged". Untracked files count as entirely changed.

## Suppressing a single use

```js
// permit: ignore[storage.local]
localStorage.setItem("draft", text);

fetch(url); // permit: ignore
```

A bare `permit: ignore` suppresses every capability on that line; a
bracketed list suppresses only those codes or families. The comment applies
to its own line or, when it stands alone, to the line after it. Suppressed
uses are counted in the summary and never fail the build. Prefer a scoped
`may ... in "file"` line in the policy when the exception should be visible
to a reviewer; suppression is for the one-off.

## Capabilities recognized so far

| code | what |
| --- | --- |
| `storage.local` | `localStorage` |
| `storage.session` | `sessionStorage` |
| `storage.indexeddb` | `indexedDB` |
| `storage.cache` | `caches` |
| `storage.cookie` | `document.cookie` |
| `storage.navigator` | `navigator.storage` |
| `network.fetch` | `fetch` |
| `network.xhr` | `XMLHttpRequest` |
| `network.websocket` | `WebSocket` |
| `network.eventsource` | `EventSource` |
| `network.beacon` | `navigator.sendBeacon` |
| `network.import` | dynamic `import()` of an absolute URL or an expression |
| `codegen.eval` | `eval` |
| `codegen.function` | `Function(...)`, `new Function(...)` |
| `codegen.timer` | `setTimeout` / `setInterval` with string code |
| `codegen.write` | `document.write`, `document.writeln` |
| `dom-escape.html` | assignment to `innerHTML` / `outerHTML` / `srcdoc`, `insertAdjacentHTML`, `createContextualFragment` |
| `dom-escape.script` | `document.createElement("script")` |
| `dom-escape.iframe` | `document.createElement("iframe")` |
| `identity.device` | `navigator.userAgent`, `platform`, `vendor`, `plugins`, `hardwareConcurrency`, `deviceMemory`... |
| `identity.geolocation` | `navigator.geolocation` |
| `identity.media` | `navigator.mediaDevices`, `getUserMedia` |
| `identity.clipboard` | `navigator.clipboard`, `document.execCommand("copy" / "paste")` |
| `identity.credentials` | `navigator.credentials` |
| `identity.permissions` | `navigator.permissions` |
| `navigation.location` | assignment to `location` / `location.href` etc., `location.assign` / `replace` / `reload` |
| `navigation.open` | `window.open` |
| `navigation.history` | `history.pushState` / `replaceState` / `back` / `forward` / `go` |
| `navigation.postmessage` | `postMessage` to `parent` / `top` / `opener` / `contentWindow`, or with a string origin |
| `globals.window` | assignment to `window.*` / `globalThis.*`, `Object.defineProperty(window, ...)` |
| `globals.prototype` | assignment to a built-in or its prototype (`Array.prototype.x = `, `Error.prepareStackTrace = `), or `Object.defineProperty` / `assign` on one |
| `worker.dedicated` | `new Worker(url)` |
| `worker.shared` | `new SharedWorker(url)` |
| `worker.service` | `navigator.serviceWorker.register(url)` |
| `worker.worklet` | `CSS.paintWorklet.addModule(url)`, `audioWorklet.addModule(url)`... |

Each is recognized bare, via `window` / `globalThis` / `self`, and via a
computed member whose name is a string literal (`window["localStorage"]`),
a concatenation of literals, or a `const` the scope analysis can fold
(`const k = "localStorage"; window[k]`, reported as `probable`).

Scope analysis is real, with hoisting: a local named `fetch` or `window` is
not the global, so a use through it is not reported at all, while the same
name declared in a sibling function does not hide anything. Only inside a
`with` block, where nothing can be resolved, is a use reported as `possible`.
Uses via `self` are `probable` rather than `certain`, since `self` is often
a local alias for `this` in older code.

Canvas and audio fingerprinting are deliberately **not** recognized: every
charting and 3D library draws to canvases, and no static signature separates
that from fingerprinting without false positives. CSP and the network family
are the backstop for where such a fingerprint would be sent.

Network uses carry a **target** when it can be fixed statically. Frost's
rule applies: a literal that closes the authority fixes the host, and nothing
after the slash can move it. `fetch("https://api.example.com/items/" + id)`
reaches `api.example.com`; `fetch("https://" + host)` reaches nobody we can
name. Relative URLs are `same-origin`. Dynamic `import()` of a relative path
or a bare package name goes through the bundler, not the network, and is not
reported.

## What this is not

- **Not a runtime sandbox.** No membrane, no proxied globals. A determined
  attacker with code execution defeats any wrapper; that fight is not worth having.
- **Not a replacement for CSP.** It emits CSP, and CSP remains the runtime
  backstop. This tool is the build-time gate.
- **Not a universal npm scanner.** Dependencies are admitted by fingerprint
  against a registry, not analyzed line by line.

## Threat model, honestly

`permit` catches careless or accidental use of forbidden APIs in first-party,
tenant, or model-generated code, and it catches drift over time. It does **not**
catch deliberately obfuscated code, runtime-constructed access beyond a shallow
constant fold, or anything injected after the build. The value is a high floor,
not a ceiling.

## Development

```
npm install
npm test
npm run build
npm run corpus        scan the pinned corpus; fails if findings changed
```

Zero false positives is the product. `npm run corpus` runs the extractor over
six pinned, hash-verified npm packages (about 21 MB of real JavaScript) and
diffs the findings against `corpus/expected.txt`. Any change to `src/extract/`
must leave that diff empty, or update the file deliberately with
`npm run corpus -- --update` and explain why in the commit.

## Licence

MIT.
