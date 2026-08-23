# Changelog

All notable changes to permit. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, minor versions may
change the policy grammar or the JSON schema; the changelog will say so.

## [Unreleased]

### Added

- Eight capability families: `storage`, `network` (with static destination
  resolution), `codegen`, `dom-escape`, `identity`, `navigation`, `globals`,
  `worker`.
- `permit.policy` in frost's policy dialect: `may use`, `may reach`,
  `forbid`, `forbid reaching`, `vendored`, path scoping with `in`, expiry
  with `until`, hints from trailing comments, precise errors with a
  `try:` suggestion.
- Lexical scope analysis with hoisting, so a local named like a global is
  not a use; `const` string folding into computed members and network
  destinations; `with` bodies reported as `possible`.
- `--min-confidence`, inline `permit: ignore` comments, `--baseline` and
  `--update-baseline`, `--changed-since <ref>`.
- `--format text | json | sarif | github`; `permit csp`; `permit summary`.
- GitHub Action (`action.yml`) and pre-commit hook.
- Fingerprint registry for vendored code: `vendored "<glob>"`,
  `permit vendor add`, `permit registry sync`, `permit sri`.
- TypeScript, JSX and inline `<script>` in HTML.
- ESLint plugin, `permit/eslint`, rule `permit/capability`.
- Pinned, hash-verified corpus (`npm run corpus`) guarding the
  false-positive count.
- `SHOWCASE.md`: three.js 0.160.0's bundled ECSY devtools and Rapier
  loader, reproducible with `npm run showcase`.
