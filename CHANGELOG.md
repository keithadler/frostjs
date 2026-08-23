# Changelog

All notable changes to frostjs. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, minor versions may
change the policy grammar or the JSON schema; the changelog will say so.

## [Unreleased]

### Added

- `frostjs init`: a starter policy granting what the code does today.
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
- ESLint plugin, `frostjs/eslint`, rule `frostjs/capability`.
- Pinned, hash-verified corpus (`npm run corpus`) guarding the
  false-positive count.
- `SHOWCASE.md`: three.js 0.160.0's bundled ECSY devtools and Rapier
  loader, reproducible with `npm run showcase`.
