# permit

A policy-driven, deny-by-default static analyzer for JavaScript. It runs in CI
and refuses to let code ship if it reaches for a capability the project has not
explicitly granted: storage, network, `eval`, DOM injection, identity, and so on.

## Status

Pre-alpha. Phase A (walking skeleton) in progress. See
[REQUIREMENTS.md](REQUIREMENTS.md) for the full plan and the milestone log.

## Usage

```
permit <paths...>        discover and analyze .js/.mjs files under paths
permit --exclude <name>  skip directories with this name (repeatable)
permit --version         print the version and exit
permit --help            show usage
```

`node_modules`, `dist`, `build`, `coverage` and `.git` are always skipped.
A path that names a file directly is always analyzed.

Exit codes: `0` clean, `1` policy violations, `2` usage or input error
(bad flag, missing path, syntax error).

## Capabilities recognized so far

| code | what |
| --- | --- |
| `storage.local` | `localStorage` |
| `storage.session` | `sessionStorage` |
| `storage.indexeddb` | `indexedDB` |
| `storage.cache` | `caches` |
| `storage.cookie` | `document.cookie` |
| `storage.navigator` | `navigator.storage` |

Each is recognized bare, via `window` / `globalThis` / `self`, and via a
string-literal computed member (`window["localStorage"]`). Uses via `self`
are `probable` rather than `certain`, since `self` is often a local alias for
`this`. If a file declares a variable with the same name as the global, the
use is downgraded to `possible` until proper scope analysis lands.

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
```

## Licence

MIT.
