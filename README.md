# frostjs

[![ci](https://github.com/keithadler/frostjs/actions/workflows/ci.yml/badge.svg)](https://github.com/keithadler/frostjs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40keithadler%2Ffrostjs)](https://www.npmjs.com/package/@keithadler/frostjs)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**The model wrote it. Did anyone decide it could do that?**

frostjs is a deny-by-default capability gate for JavaScript. You write a
policy that fits on one screen, in plain words:

```
may reach "api.example.com"
may use session storage
forbid cookies        -- consent banner owns these
```

and the build fails on anything the code reaches for that the policy does
not grant: reading storage, setting cookies, calling `eval`, injecting a
`<script>`, opening a WebSocket to a host you have never heard of. The
report names the file, the line, the expression, and the policy line that
said no.

## Why every AI-assisted JavaScript project needs this in the pipeline

Code review was built for code written by a colleague at human speed. An
assistant writes a hundred lines in the time it takes to read ten, and
none of those lines arrive with an intent attached. A prompt says "cache
the results"; the model reaches for `localStorage`. A prompt says "load the
physics engine"; the model writes `import("https://cdn.skypack.dev/...")`.
A prompt says "make the markdown render"; the model assigns `innerHTML`.
Each is a reasonable reading of the words, each is a capability your
application now has, and nobody decided it.

A test suite does not catch this: the code works. A linter does not catch
this: the code is well formed. A human reviewer skims it, because the
diff is long and the code looks fine, which it is. The only thing that
catches it is a rule that says what this project may do, written down
before the code was, and a build that enforces it. That is the whole
tool.

frostjs gives you:

- **Deny by default.** Everything is off until the policy turns it on. A
  new capability cannot arrive unnoticed, whoever or whatever wrote it.
- **A policy a non-engineer can read and sign off.** `frostjs summary`
  prints it in English. `frostjs csp` turns the same file into your
  `Content-Security-Policy` header, so the build-time gate and the runtime
  backstop cannot disagree.
- **Zero false positives as the product.** Real scope analysis, so a local
  named `fetch` is not a network call. Every engine change runs against 21
  MB of real, pinned, hash-verified JavaScript and the finding count must
  not move.
- **Adoption in one command.** `frostjs init src` writes a policy that
  grants exactly what the code does today, with a note on each line saying
  where. The first run passes. Then you delete what should not be allowed.
- **Dependencies by fingerprint.** Vendored files are admitted by hash with
  the capabilities someone reviewed; a version bump that gains a network
  destination is refused and shown as a diff.
- **Exceptions that expire.** `may use local storage in "src/legacy/*"
  until 2026-12-01` warns for two weeks, then fails. Drift has a deadline.

CLI, GitHub Action, pre-commit hook, ESLint plugin. One runtime
dependency. MIT.

## Two minutes to a gated pipeline

```bash
npm install -D @keithadler/frostjs
npx frostjs init src        # writes frostjs.policy from what the code does today
git add frostjs.policy      # commit it; it is the contract
npx frostjs src             # passes, because init granted what exists
```

The package is scoped (`@keithadler/frostjs`) because npm's typosquat
rules reserve the bare name; the command it installs is `frostjs`.

Then add the check to CI:

```yaml
# .github/workflows/frostjs.yml
on: [pull_request]
jobs:
  frostjs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: keithadler/frostjs@main
        with:
          paths: src
          args: --changed-since origin/main
```

From here on, a pull request that reaches for a capability the policy does
not grant fails with an inline annotation on the offending line. To allow
it, someone edits `frostjs.policy` in the same PR, and the reviewer sees
both changes side by side. That is the decision being made visible.

## For AI coding agents

If an assistant writes code in your project, tell it the gate exists.
Paste this into `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, or whatever your
tool reads:

```markdown
## frostjs

This project is gated by frostjs (https://github.com/keithadler/frostjs,
npm package @keithadler/frostjs, installed as a dev dependency).
`frostjs.policy` at the repository root says which browser capabilities
the code may use: storage, network destinations, code generation, HTML
injection, identity, navigation, globals, workers. Everything else is
denied.

- Before finishing any change to JavaScript or TypeScript, run
  `npx frostjs <paths you changed>` and make it pass.
- Read a denial as a question, not an obstacle. If the task genuinely needs
  the capability, add the narrowest grant that covers it to
  `frostjs.policy` (scope it with `in "<file>"`, name hosts with
  `may reach "<host>"`, add `until <date>` if it is temporary) and say in
  your summary that you widened the policy and why. If the task does not
  need it, change the code instead.
- Never add `may use everything`, never add `// frostjs: ignore` to make a
  build pass, and never delete or loosen an existing `forbid` line. Those
  are a person's decisions.
- `npx frostjs summary` prints the policy in plain English if you need to
  explain it.
```

The instructions above are also in [`AGENTS.md`](AGENTS.md) in this
repository, which applies them to frostjs's own code.

## Where it has already found something

three.js 0.160.0 ships `examples/jsm/libs/ecsy.module.js`, which, if a page
that imports it is opened with `?enable-remote-devtools` in the URL, loads a
script from a third-party CDN, connects to a third-party relay, and `eval`s
whatever the relay sends. frostjs reports it as
`codegen.eval denied by default (no rule grants it): eval(data.script)` under any policy
an application would plausibly write. The same run names a runtime
`import()` of physics engine code from `cdn.skypack.dev`. The full story, the
policy, the CSP it emits and the honest count of what else the policy
flags are in [SHOWCASE.md](SHOWCASE.md).

## Status

Published as [`@keithadler/frostjs`](https://www.npmjs.com/package/@keithadler/frostjs).
Nine capability families across JavaScript, TypeScript, JSX and HTML (inline
scripts and attribute surfaces: `on*` handlers, `javascript:` URLs, remote
`<script src>`). Frost-dialect policies with shared bases (`extends`), scope
analysis, taint analysis (source -> sink, one hop across functions),
baselines, changed-lines mode, unused-grant reporting, json/sarif/github
output, a GitHub Action, an ESLint plugin, and a fingerprint registry for
vendored code with SRI output. Run on Excalidraw (656 files, a TypeScript
and React monorepo) it finishes in under a second and `frostjs init` writes
an 18-line policy; every finding was checked by hand.

```
$ cat frostjs.policy
policy "checkout-widget"
may use session storage
may use local storage in "src/legacy/*"      -- old code, rewrite by Q4
forbid cookies                               -- consent banner owns these
may use the cache until 2026-08-30           -- service worker experiment

$ frostjs src
src/app.js:2:1: storage.local denied by default (no rule grants it): localStorage.setItem("not-here", 1)
src/legacy/old.js:2:1: storage.cookie denied by "forbid cookies" (line 4): consent banner owns these: document.cookie

warning: frostjs.policy line 5: "may use the cache until 2026-08-30" expires in 7 days

3 files, 2 denied, 0 unknown
$ echo $?
1
```

## Starting out

```bash
npm install -D @keithadler/frostjs
npx frostjs init src
```

writes a `frostjs.policy` in the current directory that grants exactly
what the code under `src` does today, one line per capability, scoped to
the files that use it when there are only a few, each with a note saying
where. The first check passes. Then read the file and delete what should
not be allowed; the build starts refusing it. A network destination the
code builds at runtime is called out in a hint rather than quietly widened
to `may use the network`. For a large codebase with debt you would rather
pay down than grant, use `--baseline` instead (below).

## Auditing a dependency before you adopt it

```bash
npx frostjs audit node_modules/some-widget
```

No policy involved. It prints, alarming things first: **untrusted input
reaching a dangerous sink** (a URL parameter, `document.cookie`, or a
`postMessage` payload flowing into `eval`, `innerHTML`, `importScripts`, a
redirect - real taint analysis, see below); files where code
generation or script injection meets a network reach (a *remote code
path*, the shape that found three.js's bundled remote eval); code
generation from non-constant input, every host reached, hosts merely
named in strings (a lead, not a finding), service workers, `postMessage`
to any origin, and the capability counts. `--format json` for tooling.
Run it on a pull request's new dependency, or on the one you already have
and never read.

See [docs/CAPABILITIES.md](docs/CAPABILITIES.md) for the full taxonomy with
the policy phrase for each code, or run `frostjs capabilities`.

## Taint: does untrusted input reach a dangerous sink?

`frostjs audit` includes a bounded taint analysis. It answers the question
capability detection cannot: not "can this code `eval`?" but "does a value
from the URL, a cookie, or a `postMessage` actually flow into `eval`?".
That is the difference between a capability and a vulnerability.

```js
const route = location.hash.slice(1);
document.getElementById("app").innerHTML = "<div>" + route + "</div>";
//  audit: t.js:2 location.hash -> innerHTML
```

The rule that keeps it honest: **taint survives only through operations
that provably preserve it** - string methods, URL decoding, `JSON.parse`,
template concatenation, member access. Any other function call breaks the
chain, so `innerHTML = DOMPurify.sanitize(x)` is not flagged while
`innerHTML = x` is.

- **Sources**: `location.search` / `.hash` / `.href` / `.pathname`,
  `document.URL` / `.cookie` / `.referrer` / `.baseURI`, `window.name`,
  `URLSearchParams` reads, a `window` `message` handler's `event.data`, and
  the `event.data` of a WebSocket/EventSource this file constructs.
- **Sinks**: `eval`, `Function`, `innerHTML` / `outerHTML` / `srcdoc`,
  `insertAdjacentHTML`, `document.write`, `importScripts`, `import()`,
  `setAttribute("on*"/"srcdoc", ...)`, React `dangerouslySetInnerHTML`, and
  `location` / `window.open` redirects.
- **One hop across functions**: a tainted argument passed to a local
  function whose parameter reaches a sink is flagged (`setHtml(x) { el.innerHTML = x }`
  called with `location.hash`), reported `... (via setHtml())`. A parameter
  only counts if it reaches the sink through provably-preserving operations,
  so a helper that sanitizes its argument is not a sink.
- **Limit, stated plainly**: flow is followed one function hop, not a whole
  call graph (a parameter that reaches a sink through a second function is
  not summarized), and DOM input values (`el.value`) are not modeled as
  sources. It finds real flows; it does not claim to find all of them.

Run over 21 MB of popular packages it reports zero (mature libraries
sanitize); on real application code it lights up the flows a reviewer
would flag by hand.

Taint is a human report in `frostjs audit` and, with `--taint`, an
enforced gate in `frostjs check`: each flow becomes a `taint.<sink>`
finding that fails the build and appears in the json, sarif and github
outputs, so it lands as a code-scanning alert on the pull request.
`--changed-since`, `--baseline` and `// frostjs: ignore[taint]` all apply
to taint findings, so it adopts on a legacy codebase the same way the
capability gate does. It is off by default because it is best-effort;
the capability gate stays deterministic. Put `forbid tainted flows` in
`frostjs.policy` to turn the gate on for everyone without the flag, so the
committed policy expresses the whole security posture in one place.

## Policy files

A policy is a `frostjs.policy` file in frost's policy dialect: one rule per
line, `--` or `#` comments, case-insensitive keywords. Deny-by-default, so
the file only ever grants. A trailing comment on a rule is its *hint*, and is
printed whenever that rule refuses something.

```
policy "<name>"                                    optional, once
extends "<base.frostjs.policy>"                    merge a base policy first
ignore "<glob>", ...                               files not analyzed at all
vendored "<glob>", ...                             third-party files, checked by fingerprint
may use <capability> [in "<glob>", ...] [until YYYY-MM-DD]
may reach "<host>", ... [in "<glob>", ...] [until YYYY-MM-DD]
forbid [using] <capability> [in "<glob>", ...]
forbid reaching "<host>", ... [in "<glob>", ...]
forbid everything else                             optional, readability only
forbid tainted flows                               gate on taint (like --taint)
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
| `device access`, `file access`, `usb`, `bluetooth`, `notifications` | `device` |
| `everything` | `*` |

Rules:

- `forbid` always wins over `may`, so `may use storage` + `forbid cookies`
  grants everything in storage except cookies.
- `in` scopes a rule to path globs (`*` within a segment, `**` across
  segments, a bare name matches at any depth, a plain directory matches
  everything beneath it). Globs are relative to the policy file's directory.
- `ignore` skips files entirely: generated bundles, test fixtures, anything
  that is not your code to police. It lives in the policy so the exception
  is visible in review, where `--exclude` on the command line is not.
- `may reach` grants the network family only to the named hosts. `*` in a
  host spans any characters (`*.internal`). `"same-origin"` names relative
  URLs. A destination that cannot be read from the code is **not** allowed by
  a host list: cannot be shown to be allowed is not allowed. Grant
  `may use the network` if you really mean any destination.
- `until` puts an expiry on a grant. Inside the last 14 days the build warns;
  after the date the grant denies with its own message. This is how drift is
  fought: an exception has to be renewed on purpose.

`frostjs.policy` is searched for in the directory shared by all the given
paths, then upward; the nearest one wins, so a monorepo can keep one per
tenant directory. `--policy <file>` overrides the search. With no policy at
all, every capability is denied and a note says so.

## Usage

```
frostjs init [paths]     write a starter frostjs.policy granting what the code does today
frostjs audit <paths>    what the code does, no policy needed: hosts, codegen, script injection, remote code paths
frostjs <paths...>        discover and analyze .js/.mjs/.cjs/.jsx/.ts/.tsx/.mts/.cts and inline <script> in .html under paths
frostjs csp               print the Content-Security-Policy header the policy implies
frostjs summary           print a plain-English reading of the policy
frostjs vendor add <files>  fingerprint third-party files and record their capabilities
frostjs registry sync     re-admit bumped dependencies whose capabilities did not change
frostjs sri [paths]       print Subresource Integrity values for registered vendored files
frostjs --exclude <name>  skip directories with this name (repeatable)
frostjs --exit-zero       report findings but always exit 0
frostjs --policy <file>   use this policy instead of searching for frostjs.policy
frostjs --today <date>    treat YYYY-MM-DD as today when checking expiry
frostjs --min-confidence <c>  lowest confidence that fails: certain, probable (default), possible
frostjs --baseline <file>     denials recorded in this file do not fail the build
frostjs --update-baseline     write every current denial into the baseline and exit 0
frostjs --changed-since <ref> fail only on uses in lines changed since the git ref
frostjs --taint          also fail on untrusted input reaching a dangerous sink
frostjs --format <f>      text (default), json, sarif, or github
frostjs --version         print the version and exit
frostjs --help            show usage
```

`node_modules`, `dist`, `build`, `coverage` and `.git` are always skipped
(unless a `vendored` glob reaches into them). `.d.ts` files are skipped:
they describe globals and contain no code. A path that names a file
directly is always analyzed.

TypeScript type positions are never references (`let f: typeof fetch` is
quiet), `declare` statements neither use nor shadow the globals they
describe, and `as` / `!` / `satisfies` are looked through. In JSX,
`dangerouslySetInnerHTML={...}` and `srcdoc={...}` are html injection and
intrinsic `<script>` / `<iframe>` elements count like `createElement`;
component names and ordinary attributes are quiet.

Inline `<script>` blocks in `.html` and `.htm` files are analyzed in place:
positions refer to the HTML file, `type="module"` blocks parse as modules,
and blocks with a `src` or a non-JavaScript `type` (JSON, import maps,
templates) are data, not code. Script elements are found with a regular
expression, which is right for markup people write and wrong only for
markup written to confuse it, which the threat model already excludes.

Exit codes: `0` clean, `1` policy violations, `2` usage or input error
(bad flag, missing path, syntax error).

Uses with `possible` confidence are listed under "unknown" and never fail the
build; `certain` and `probable` uses do.

## GitHub Action

```yaml
- uses: keithadler/frostjs@main
  with:
    paths: src
    args: --baseline .frostjs-baseline.json --changed-since origin/main
    fail-on-findings: "true"
```

Inputs: `paths` (default `.`), `format` (default `github`, which annotates
the pull request inline), `args` (extra flags), `fail-on-findings` (set
`"false"` for an informational run). Inputs reach the script through the
environment only, never spliced into the script body, so a hostile input is
an argument and not a command.

## ESLint plugin

The same engine as an ESLint rule, so denials show up in the editor and on
`eslint` runs, with the same policy discovery (nearest `frostjs.policy`
above the file) and the same `frostjs: ignore` comments. `eslint-disable`
works too.

```js
// eslint.config.js
import frostjs from "@keithadler/frostjs/eslint";
export default [frostjs.configs.recommended];
// or: [{ plugins: { frostjs }, rules: { "frostjs/capability": ["error", { reportUnknown: true }] } }]
```

Options: `policy` (explicit file), `minConfidence`, `reportUnknown`
(also report uses the CLI would list as unknown), `today`.

## pre-commit

```yaml
repos:
  - repo: https://github.com/keithadler/frostjs
    rev: main
    hooks:
      - id: frostjs
```

## Third-party code

Dependencies are not analyzed line by line; that is a year-long project
that ends in noise. Instead the policy names which files are vendored:

```
vendored "vendor/**", "static/lib/*.min.js"
```

A vendored file is hashed (SHA-384, the same value SRI uses) and looked up
in `.frostjs/registry.json` beside the policy. A known hash contributes the
capability set somebody recorded for it, checked against the policy like
any first-party use. An unknown hash fails the build:

```
vendor/widget.min.js:1:1: vendored file is not in the registry; review it with: frostjs vendor add vendor/widget.min.js
```

`frostjs vendor add` analyzes the file once, prints what it found so a
person can look at it, and records the entry. A patch release changes the
hash, so the review happens again; that is the point. To keep that from
being a chore, `frostjs registry sync` walks the vendored paths after a
dependency bump: a new version that uses exactly the capabilities the old
one did is re-admitted automatically and noted; one that gained a
capability or a new destination is refused with the difference printed,
which is the "dependency bump silently introduces a new network
destination" case from the threat model. Entries whose file is gone are
pruned, and the lockfile's hash is recorded so the next run can say
whether anything moved. A vendored glob may reach into `node_modules`;
the walk follows it there.

`frostjs sri` prints the same SHA-384 values as `integrity` attributes
(`--format html` for ready-made script tags, `--format json` for a build
step), so the browser refuses at load time exactly what the registry never
reviewed. A vendored file that is not in the registry is refused here too.

## One policy, three artifacts

The same `frostjs.policy` drives the linter ruleset, a CSP header, and a
reviewer's summary, so they cannot drift apart.

`frostjs csp` prints the header and nothing else, for nginx or the CDN
config. Only directives the policy determines are emitted: `connect-src`
from `may reach` hosts (`'none'` when nothing is granted, `*` for
`may use the network`), `script-src 'self'` plus `'unsafe-eval'` when code
generation is granted and the reach hosts when dynamic import is, and
`worker-src` when workers are. Expired grants do not widen it; path-scoped
grants do, because a header covers the whole page.

`frostjs summary` prints what the code may do, what it may not, and spells
out the implicit deny:

```
Policy "proj" (frostjs.policy)

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

## Adopting frostjs on an existing codebase

```bash
frostjs --baseline .frostjs-baseline.json --update-baseline src
```

That records every current denial, keyed on file, capability and expression
text (never line numbers), and exits 0. From then on
`frostjs --baseline .frostjs-baseline.json src` fails only on *new* uses;
existing ones are counted as "baselined". Commit the file; shrink it as the
debt is paid down. Paths inside it are relative to the file's directory.

For pull-request checks, `frostjs --changed-since origin/main src` fails only
on uses that sit in lines the branch added or modified; the rest are counted
as "unchanged". Untracked files count as entirely changed.

## Tightening a policy

`frostjs check --unused src` lists grants that matched nothing on the scan,
so an over-broad or redundant line can be removed:

```
2 grants matched nothing (remove, or scan more):
  frostjs.policy line 3: may use session storage
  frostjs.policy line 5: may use cookies
```

It prints to stderr and does not change the exit code. Run it on a full
scan, not a changed-lines subset, or a grant will look unused only because
the file that needs it was not scanned.

## Shared base policies

An organization or monorepo can keep one base policy and extend it:

```
# packages/widget/frostjs.policy
extends "../../frostjs.base.policy"
may use local storage
```

The base is merged in first, so its grants apply and its `forbid` lines
(and `forbid tainted flows`) cannot be loosened by a child. Path globs in
the base are interpreted relative to the base file and rebased when merged,
so `may use cookies in "legacy/*"` keeps meaning the base's `legacy/`. A
cycle or a missing base is a precise error naming the line.

## Suppressing a single use

```js
// frostjs: ignore[storage.local]
localStorage.setItem("draft", text);

fetch(url); // frostjs: ignore
```

A bare `frostjs: ignore` suppresses every capability on that line; a
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
| `network.importscripts` | `importScripts(url)` in a worker (loads and runs a script) |
| `network.resource` | `el.src = "https://..."` or `setAttribute("src", ...)` naming another host (literal or folded const only) |
| `codegen.eval` | `eval` |
| `codegen.function` | `Function(...)`, `new Function(...)` |
| `codegen.timer` | `setTimeout` / `setInterval` with string code |
| `codegen.write` | `document.write`, `document.writeln` |
| `dom-escape.html` | assignment to `innerHTML` / `outerHTML` / `srcdoc`, `insertAdjacentHTML`, `createContextualFragment`, JSX `dangerouslySetInnerHTML` / `srcdoc` |
| `dom-escape.script` | `document.createElement("script")`, JSX `<script>` |
| `dom-escape.iframe` | `document.createElement("iframe")`, JSX `<iframe>` |
| `dom-escape.handler` | `setAttribute("onclick" / "onerror" / ..., code)` (installs a handler from a string) |
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
| `navigation.message-receive` | `window.addEventListener("message", ...)` whose handler reads `event.data` but never checks `event.origin` |
| `globals.window` | assignment to `window.*` / `globalThis.*`, `Object.defineProperty(window, ...)` |
| `globals.prototype` | assignment to a built-in or its prototype (`Array.prototype.x = `, `Error.prepareStackTrace = `), or `Object.defineProperty` / `assign` on one |
| `worker.dedicated` | `new Worker(url)` |
| `worker.shared` | `new SharedWorker(url)` |
| `worker.service` | `navigator.serviceWorker.register(url)` |
| `worker.worklet` | `CSS.paintWorklet.addModule(url)`, `audioWorklet.addModule(url)`... |
| `device.filesystem` | `showOpenFilePicker` / `showSaveFilePicker` / `showDirectoryPicker` (read/write the user's files) |
| `device.usb` / `device.bluetooth` / `device.serial` / `device.hid` / `device.midi` | `navigator.usb` etc. (hardware access) |
| `device.wakelock` | `navigator.wakeLock` |
| `device.notification` | `Notification` |

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

`frostjs` catches careless or accidental use of forbidden APIs in first-party,
tenant, or model-generated code, and it catches drift over time. It does **not**
catch deliberately obfuscated code, runtime-constructed access beyond a shallow
constant fold, or anything injected after the build. The value is a high floor,
not a ceiling.

## Development

```
npm install
npm test              vitest (npm run test:watch to keep it running)
npm run lint          prettier --check, then typecheck src, test and scripts
npm run format        prettier --write
npm run build         tsc to dist/
npm run corpus        scan the pinned corpus; fails if findings changed
npm run showcase      reproduce SHOWCASE.md
```

Zero false positives is the product. `npm run corpus` runs the extractor over
six pinned, hash-verified npm packages (about 21 MB of real JavaScript) and
diffs the findings against `corpus/expected.txt`. Any change to `src/extract/`
must leave that diff empty, or update the file deliberately with
`npm run corpus -- --update` and explain why in the commit.

- [ARCHITECTURE.md](ARCHITECTURE.md): how the code is laid out and the
  contract a recognizer signs.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to add a recognizer or a policy
  form, and the conventions.
- [SECURITY.md](SECURITY.md): what a green run does and does not promise,
  and how to report a bypass.
- [CHANGELOG.md](CHANGELOG.md).
- [REQUIREMENTS.md](REQUIREMENTS.md): the original plan, with every step
  marked done and every decision recorded.

## License

[MIT](LICENSE), the same license as [frost](https://github.com/keithadler/frost)
and [exact](https://github.com/keithadler/magic-float-linter). A build-time
linter wants the widest possible adoption and gives nobody a reason to
hesitate: no copyleft, no patent clause to have reviewed, nothing to
attribute beyond the notice. Contributions are accepted under the same
license.
