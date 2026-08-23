# Report filed with mrdoob/three.js

Filed 2026-08-23 as https://github.com/mrdoob/three.js/issues/34357. It
went to the public issue tracker rather than a security contact because
the behavior is documented upstream ECSY behavior shipped in example
code, not a vulnerability in three.js itself. Verified against the `dev`
branch, byte-identical to the r160 copy in the corpus, before filing. The
text below is what was submitted.

---

**Title:** `examples/jsm/libs/ecsy.module.js` evaluates remote scripts when a page is opened with `?enable-remote-devtools`

**Description of the problem**

`examples/jsm/libs/ecsy.module.js` (vendored in May 2021, unchanged since)
is imported by the WebXR hand-input examples
(`webxr_vr_handinput_pointerclick.html`, `webxr_vr_handinput_pointerdrag.html`,
`webxr_vr_handinput_pressbutton.html`). At module load it does:

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
connection through `peerjs.ecsy.io`, and for each message that arrives:

```js
if (data.type === "init") {
  var script = document.createElement("script");
  script.innerHTML = data.script;
  (document.head || document.documentElement).appendChild(script);
} else if (data.type === "executeScript") {
  let value = eval(data.script);
```

So any page that imports this module will, when opened with that query
parameter, load a third-party script, connect to a third-party relay, and
evaluate whatever the relay sends. That includes the three examples above
as hosted on threejs.org, and any project that copied them.

This is ECSY's documented remote-devtools feature, so it is not a bug in
ECSY. But the three.js repository vendors it into `examples/jsm/libs`
without the devtools being wanted, and the `@todo` in the file says there
is no way to turn it off.

**Suggested fix**

Either of:

1. Remove the remote-devtools block from the vendored copy (everything
   from `injectScript` through the `if (hasWindow)` auto-enable, roughly
   lines 1614-1790 in the current file). The examples only use the ECS
   core.
2. Drop ECSY from `examples/jsm/libs` and rewrite the three hand-input
   examples without it, since the library has had no upstream release
   since 2021.

A related, smaller item: `examples/jsm/physics/RapierPhysics.js` loads the
physics engine at runtime with
`import("https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.17.3")`. The
version is pinned but there is no integrity check, and Skypack has had
availability problems. An import map entry in the example pages, like the
other examples use, would let the page own that decision.

**Reproduction steps**

1. Open https://threejs.org/examples/webxr_vr_handinput_pointerclick.html?enable-remote-devtools
2. Observe the network panel: `peer.min.js` loads from jsdelivr and a
   connection to `peerjs.ecsy.io` is opened. A six-character pairing code
   is shown on the page; anyone with it can send `executeScript` messages.

Found with frostjs (https://github.com/keithadler/frostjs), a
deny-by-default capability linter; the run is reproducible from that
repository's `SHOWCASE.md`.

**Version:** r160 through `dev` as of 2026-08-23.
