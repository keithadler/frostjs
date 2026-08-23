# Security

## What frostjs promises, and what it does not

frostjs is a build-time gate, not a sandbox. It catches first-party, tenant
or model-generated code that reaches for a capability the policy did not
grant, and it catches dependency bumps that quietly add one. It does not
catch deliberately obfuscated code, runtime-constructed access beyond a
shallow constant fold, or anything injected after the build. The README
states this plainly and so should anyone deploying it: a green frostjs run
means "nothing we could see asked for more than it was granted," not
"this code is safe."

The runtime backstop is the `Content-Security-Policy` header that
`frostjs csp` derives from the same policy file. Deploy both.

## Reporting a vulnerability

If you find a way to make frostjs pass code it should refuse (a bypass in a
recognizer, a scope-analysis hole that lets a shadowed global slip through,
a policy parser quirk that grants more than the author wrote, a path
traversal in policy discovery, an injection in the GitHub Action), please
email **keith.adler@icloud.com** rather than opening a public issue.
Include the smallest reproduction you can. You will get an acknowledgement
within a few days and a fix or an explanation as soon as one exists; credit
in the changelog is yours if you want it.

Bypasses that rely on obfuscation the threat model already excludes (for
example `window["local" + k]` where `k` is computed at runtime) are not
vulnerabilities; they are the documented floor. A recognizer missing an
ordinary, unobfuscated spelling of a capability is a bug and is welcome as
a normal issue.

## Supply chain

frostjs has one runtime dependency, `oxc-parser`, and installs into other
people's CI. Releases are built from a clean checkout by `npm run build`
and published with `npm publish`; the `files` list in `package.json` is the
whole of what ships. The corpus packages used for testing are pinned by
their npm integrity hashes in `corpus/manifest.json` and verified before
use.
