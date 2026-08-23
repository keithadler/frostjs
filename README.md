# permit

A policy-driven, deny-by-default static analyzer for JavaScript. It runs in CI
and refuses to let code ship if it reaches for a capability the project has not
explicitly granted: storage, network, `eval`, DOM injection, identity, and so on.

## Status

Pre-alpha. Phases A and B are in: it discovers `.js`/`.mjs`, recognizes the
`storage` capability family, reads a `permit.policy` written in frost's policy
dialect, and fails the build on anything the policy does not grant. Phase C
(the rest of the capability taxonomy) is next. See
[REQUIREMENTS.md](REQUIREMENTS.md) for the full plan and the milestone log.

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
| `html injection` | `dom-escape` (Phase C) |
| `identity`, `fingerprinting` | `identity` (Phase C) |
| `navigation` | `navigation` (Phase C) |
| `globals` | `globals` (Phase C) |
| `workers` | `worker` (Phase C) |
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
permit --exclude <name>  skip directories with this name (repeatable)
permit --exit-zero       report findings but always exit 0
permit --policy <file>   use this policy instead of searching for permit.policy
permit --today <date>    treat YYYY-MM-DD as today when checking expiry
permit --version         print the version and exit
permit --help            show usage
```

`node_modules`, `dist`, `build`, `coverage` and `.git` are always skipped.
A path that names a file directly is always analyzed.

Exit codes: `0` clean, `1` policy violations, `2` usage or input error
(bad flag, missing path, syntax error).

Uses with `possible` confidence are listed under "unknown" and never fail the
build; `certain` and `probable` uses do.

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

Each is recognized bare, via `window` / `globalThis` / `self`, and via a
string-literal computed member (`window["localStorage"]`). Uses via `self`
are `probable` rather than `certain`, since `self` is often a local alias for
`this`. If a file declares a variable with the same name as the global, the
use is downgraded to `possible` until proper scope analysis lands.

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
