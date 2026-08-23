# Showcase: three.js ships a remote eval behind a URL parameter

This is the finding that explains what frostjs is for. Everything below is
reproducible with `npm run showcase` (the corpus fetch verifies three.js
0.160.0 against its npm integrity hash first).

## The finding

three.js 0.160.0 ships `examples/jsm/libs/ecsy.module.js`, a copy of the
ECSY entity-component framework used by its physics examples. At module
load, that file does this (lines 1783-1789, lightly trimmed):

```js
if (hasWindow) {
  const urlParams = new URLSearchParams(window.location.search);
  // @todo Provide a way to disable it if needed
  if (urlParams.has("enable-remote-devtools")) {
    enableRemoteDevtools();
  }
}
```

`enableRemoteDevtools` injects PeerJS from `cdn.jsdelivr.net`, opens a peer
connection through `peerjs.ecsy.io`, and then, for every message that
arrives on that connection:

```js
if (data.type === "init") {
  var script = document.createElement("script");
  script.innerHTML = data.script;
  (document.head || document.documentElement).appendChild(script);
} else if (data.type === "executeScript") {
  let value = eval(data.script);
```

So any page that imports this module will, if someone adds
`?enable-remote-devtools` to its URL, load a script from a third-party CDN,
connect to a third-party relay, and evaluate whatever that relay sends. It
is documented ECSY behavior, it is meant for development, and none of that
changes what the capability is: a URL-parameter-gated remote code execution
path, bundled into one of the most widely used JavaScript libraries there
is, in a file whose name gives no hint of it.

Nobody chose this. Somebody needed an ECS for a physics demo, vendored a
library, and the library's devtools came along. That is the threat model in
section 3 of the requirements, word for word: a dependency that reaches for
something nobody asked it to.

## What frostjs says

A plausible policy for an application built on three.js:

```
policy "three-app"
may reach "same-origin"             -- models, textures and workers from our own origin
may use workers                     -- DRACO, KTX2 and meshopt decoders
may use identity.device             -- renderer feature detection reads navigator.userAgent
may use html injection in "examples/jsm/libs/lil-gui.module.min.js"
may use html injection in "examples/jsm/webxr/*"   -- "WEBXR NEEDS HTTPS" messages
```

Against the two files in question:

```
$ frostjs examples/jsm/libs/ecsy.module.js examples/jsm/physics/RapierPhysics.js
examples/jsm/libs/ecsy.module.js:1615:16: dom-escape.script denied by default (no rule grants it): document.createElement("script")
examples/jsm/libs/ecsy.module.js:1670:3: dom-escape.html denied by default (no rule grants it): infoDiv.innerHTML = `Open ECSY devtools to connect to this page using the code:&nbsp;<b style="color: #fff">${remoteId}</b>&nbsp;<button onClick="generateNewCode()">Generate new code</button>`
examples/jsm/libs/ecsy.module.js:1682:3: globals.window denied by default (no rule grants it): window.generateNewCode = () => { ... }
examples/jsm/libs/ecsy.module.js:1683:5: storage.local denied by default (no rule grants it): window.localStorage.clear()
examples/jsm/libs/ecsy.module.js:1685:5: storage.local denied by default (no rule grants it): window.localStorage.setItem("ecsyRemoteId", remoteId)
examples/jsm/libs/ecsy.module.js:1686:5: navigation.location denied by default (no rule grants it): window.location.reload(false)
examples/jsm/libs/ecsy.module.js:1689:26: storage.local denied by default (no rule grants it): window.localStorage.getItem("ecsyRemoteId")
examples/jsm/libs/ecsy.module.js:1692:5: storage.local denied by default (no rule grants it): window.localStorage.setItem("ecsyRemoteId", remoteId)
examples/jsm/libs/ecsy.module.js:1697:3: globals.window denied by default (no rule grants it): window.__ECSY_REMOTE_DEVTOOLS_INJECTED = true
examples/jsm/libs/ecsy.module.js:1698:3: globals.window denied by default (no rule grants it): window.__ECSY_REMOTE_DEVTOOLS = {}
examples/jsm/libs/ecsy.module.js:1734:11: dom-escape.html denied by default (no rule grants it): infoDiv.innerHTML = "Connected"
examples/jsm/libs/ecsy.module.js:1739:28: dom-escape.script denied by default (no rule grants it): document.createElement("script")
examples/jsm/libs/ecsy.module.js:1756:15: dom-escape.html denied by default (no rule grants it): script.innerHTML = data.script
examples/jsm/libs/ecsy.module.js:1762:27: codegen.eval denied by default (no rule grants it): eval(data.script)
examples/jsm/physics/RapierPhysics.js:41:18: network.import to cdn.skypack.dev denied by default (no rule grants it): import( RAPIER_PATH )

2 files, 15 denied, 0 unknown
```

Two things to read off that.

The `eval` at line 1762 and the `<script>` creation at 1739 are the remote
code execution path. No policy a sane application would write grants
`codegen.eval` to a physics demo's ECS, so the build fails the day the file
is added, and the person adding it has to look.

The second finding is quieter and at least as interesting. `RapierPhysics.js`
does `import(RAPIER_PATH)` where `RAPIER_PATH` is a `const` naming
`https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.11.2`. That is a
runtime load of physics engine code from a third-party CDN, at a pinned
version but with no integrity check, from a library most people assume is
self-contained. The scope analysis folds the constant, so the report names
the host rather than saying the destination is unknown.

The CSP the same policy emits is the runtime backstop for both:

```
$ frostjs csp
connect-src 'self'; script-src 'self'; worker-src 'self'
```

`script-src 'self'` without `'unsafe-eval'` blocks the `eval` and the
jsdelivr injection; `connect-src 'self'` blocks the relay. Build-time gate
and runtime header come from one file, so they cannot disagree.

## The honest part

Run over all of `src` and `examples/jsm` (921 files), the same policy
produces 121 denials, and most of them are not interesting: 82 are
`network` denials in Emscripten glue (`draco_decoder.js`, `basis_transcoder.js`,
`rhino3dm.js`, `ammo.wasm.js`) of the form `fetch(wasmBinaryFile, ...)`
where the destination is a variable. Frost's rule applies and frostjs applies
it: a destination that cannot be shown to be allowed is not allowed. An
application adopting frostjs on top of three.js would do one of two things
on the first afternoon: grant `may use the network in "examples/jsm/libs/**"`
with a hint explaining why, or run `--update-baseline` and pay the debt
down file by file. Either is a visible, reviewable decision, which is the
whole point. What it would not do is miss line 1762.

Reproduce it:

```bash
npm run showcase          # the two files above
npm run showcase -- --all # all 921 files
```

Both files are still on three.js's `dev` branch as of 2026-08-23: the ECSY
copy is unchanged since it was vendored in May 2021 and is imported by the
three WebXR hand-input examples; `RapierPhysics.js` now pins Rapier 0.17.3
on the same CDN. Reported upstream as
[mrdoob/three.js#34357](https://github.com/mrdoob/three.js/issues/34357);
the text is in [`showcase/three/UPSTREAM-ISSUE.md`](showcase/three/UPSTREAM-ISSUE.md).

The threat model's limits apply here as everywhere. frostjs did not find
this by understanding what ECSY does; it found it because `eval` is `eval`
and a policy said no. Obfuscated code would not have been caught. The file
was not obfuscated, because nobody was hiding anything, and that is the
common case.
