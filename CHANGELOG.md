# Changelog

All notable changes to frostjs. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, minor versions may
change the policy grammar or the JSON schema; the changelog will say so.

## [Unreleased]

## [0.5.0] - 2026-08-23

Additive: new command (`frostjs explain`) and broader taint coverage; no
breaking changes to policies or the JSON/SARIF schema.

### Added

- `frostjs explain <capability>` explains one code, family or phrase: what
  triggers it and the policy line to allow it.
- Taint sink: React `dangerouslySetInnerHTML={{ __html: tainted }}`. The
  `__html` key is React-specific, so a tainted value there is unambiguous.
- Taint source: the `event.data` of a message handler on a WebSocket or
  EventSource the file constructs (`new WebSocket(...).onmessage`), so
  eval-of-server-message is caught.
- Taint sinks: `new Worker` / `new SharedWorker` / `serviceWorker.register`
  with an untrusted URL (remote code off-thread).

## [0.4.0] - 2026-08-23

Additive: new policy grammar (`extends`) and a new flag (`--unused`); no
breaking changes to existing policies or the JSON/SARIF schema.

### Added

- `frostjs check --unused` lists policy grants that matched nothing on a
  full scan (over-broad or redundant lines to remove), on stderr, without
  changing the exit code.
- Policies can `extends "<base.frostjs.policy>"`: a shared org or monorepo
  base is merged in first, its path globs rebased to the extending policy's
  directory, `forbid` and `forbid tainted flows` inherited. Cycles and
  missing targets are precise errors.
- SARIF results carry a stable `partialFingerprints["frostjs/v1"]` keyed on
  (file, capability, expression), so GitHub code scanning tracks a finding
  across commits instead of re-alerting when it moves lines.

## [0.3.0] - 2026-08-23

Minor bump: new grammar is additive (`frostjs capabilities`; taint now
also gates via HTML). No breaking changes to policies or the JSON schema.

### Added

- `frostjs capabilities`: the full taxonomy with the policy phrase for each
  code, as text, json or md. `docs/CAPABILITIES.md` is generated from it and
  a test fails if it drifts.
- Taint sink: a tainted string into `setTimeout` / `setInterval`.
- HTML attributes are analyzed, not just `<script>` blocks: inline `on*`
  event handlers, `javascript:` URLs, `<iframe srcdoc>`, and `src`/`href`
  to another host (a remote `<script src>` most of all).
- Taint follows one hop across functions: a tainted argument to a local
  helper whose parameter reaches a sink is flagged, reported `(via fn())`.

## [0.2.0] - 2026-08-23

Everything below shipped after 0.1.0. Minor bump: new capability family and
policy grammar (`forbid tainted flows`), no breaking changes to existing
policies or the JSON schema.

### Added

- `frostjs init`: a starter policy granting what the code does today.
- `frostjs audit`: what code does with no policy; taint flows and remote
  code paths first. `npm run sweep` audits popular packages.
- Bounded taint analysis: untrusted input (URL, cookie, postMessage)
  reaching a dangerous sink (eval, innerHTML, importScripts, redirect),
  in `frostjs audit`. Taint survives only provably-preserving operations,
  so sanitizers break the chain. `frostjs check --taint` makes it a gate:
  each flow is a `taint.<sink>` finding across text/json/sarif/github,
  failing the build, and honoring --baseline, --changed-since and inline
  suppression. `forbid tainted flows` in the policy turns the gate on
  without the flag.
- `network.resource`: `el.src = "https://..."` naming another host.
- `network.importscripts`: `importScripts(url)` in a worker.
- `device` family: File System Access pickers, WebUSB/Bluetooth/Serial/HID/MIDI,
  wake lock, Notification.
- `dom-escape.handler`: `setAttribute("onclick"/..., code)`.
- `navigation.message-receive`: a `window` message listener with no origin check.
- `new URL(path, base)` resolves to the base host.
- JSX inside `.js` files parses (React and Docusaurus convention).
- `ignore "<glob>"` policy line; the ESLint plugin honors it too.
- Eight capability families: `storage`, `network` (with static destination
  resolution), `codegen`, `dom-escape`, `identity`, `navigation`, `globals`,
  `worker`.
- `frostjs.policy` in frost's policy dialect: `may use`, `may reach`,
  `forbid`, `forbid reaching`, `vendored`, path scoping with `in`, expiry
  with `until`, hints from trailing comments, precise errors with a
  `try:` suggestion.
- Lexical scope analysis with hoisting, so a local named like a global is
  not a use; `const` string folding into computed members and network
  destinations; `with` bodies reported as `possible`.
- `--min-confidence`, inline `frostjs: ignore` comments, `--baseline` and
  `--update-baseline`, `--changed-since <ref>`.
- `--format text | json | sarif | github`; `frostjs csp`; `frostjs summary`.
- GitHub Action (`action.yml`) and pre-commit hook.
- Fingerprint registry for vendored code: `vendored "<glob>"`,
  `frostjs vendor add`, `frostjs registry sync`, `frostjs sri`.
- TypeScript, JSX and inline `<script>` in HTML.
- ESLint plugin, `@keithadler/frostjs/eslint`, rule `frostjs/capability`.
- Pinned, hash-verified corpus (`npm run corpus`) guarding the
  false-positive count.
- `SHOWCASE.md`: three.js 0.160.0's bundled ECSY devtools and Rapier
  loader, reproducible with `npm run showcase`.
