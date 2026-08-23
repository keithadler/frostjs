# Sweep: fifty popular browser packages, 2026-08-23

`npm run sweep` runs `frostjs audit` over fifty widely used browser
libraries fetched from npm (integrity hashes are printed with each entry)
and ranks them. The ranking key is the shape that found three.js's
bundled remote eval ([SHOWCASE.md](SHOWCASE.md)): in one file, code
generation from non-constant input or script injection, plus a network
reach. Every finding below was read in the source before being written
here. Versions are what npm served on the date above.

## What it is not

A ranking of how dangerous a package is. Most of what ranks high is by
design: htmx evaluates attribute values because that is what htmx is;
Vue's full build compiles templates with `new Function`; Firebase Auth
loads Google's sign-in and reCAPTCHA scripts; analytics SDKs load their
recorders from their own CDNs. The sweep's job is to make those facts
visible in one place so a team can decide whether they want them, which
is the same job the policy does for first-party code.

## Findings worth a decision

### video.js loads a script from a third-party CDN at runtime

`video.core.js`, `video.novtt.js` and the other builds without bundled
VTT support do this when a text track needs parsing:

```js
const script = document.createElement('script');
script.src = this.options_['vtt.js'] || 'https://vjs.zencdn.net/vttjs/0.14.1/vtt.min.js';
```

No integrity attribute; the host is chosen by the library, not the
application. It is overridable through the `vtt.js` option, which most
deployments never set. A policy that does not grant `may reach
"vjs.zencdn.net"` fails the build on it, which is the point: someone then
decides, rather than finding out from a CSP report.

### pixi.js fetches its Basis transcoder from jsdelivr by default

```js
jsUrl: "https://cdn.jsdelivr.net/npm/pixi.js/transcoders/basis/basis_transcoder.js",
wasmUrl: "https://cdn.jsdelivr.net/npm/pixi.js/transcoders/basis/basis_transcoder.wasm"
```

Any application that decodes Basis textures pulls code and a wasm binary
from a CDN at runtime, unpinned (`npm/pixi.js` with no version). Same
shape as three.js's Rapier import in the showcase, with the version pin
missing too.

### three.js inspector evaluates generated code from a loaded graph

`examples/jsm/inspector/extensions/tsl-graph/TSLGraphLoader.js` loads a
JSON material graph and runs `new Function(code)()` on JavaScript
generated from it. If the JSON is not trusted, that is code execution.
It is a development-tool extension, so the exposure is small, but the
path exists and nothing in the file name says so.

### Already reported

three.js's `ecsy.module.js` (remote eval behind a URL parameter) and
`RapierPhysics.js` (runtime import from Skypack): filed as
[mrdoob/three.js#34357](https://github.com/mrdoob/three.js/issues/34357).

## Findings that are the package's design, listed so nobody is surprised

- **htmx**: evaluates `hx-on`, `hx-vals` and `js:` attribute values with
  `new Function`, and reads the page URL. That is the library's model.
- **Vue** full builds: `new Function` for runtime template compilation.
  The runtime-only build does not.
- **Alpine.js**: `new Function` with `with (scope)` for expressions.
- **d3**: `new Function` to build row parsers from CSV column names, in
  the same bundle as `d3-fetch`.
- **Firebase**: Auth injects Google sign-in and reCAPTCHA scripts;
  Analytics injects `googletagmanager.com`; Messaging registers a service
  worker. Hosts named: `apis.google.com`, `www.gstatic.com`,
  `www.googletagmanager.com`, `*.googleapis.com`.
- **Mixpanel**: loads its session recorder from `cdn.mxpnl.com`; twelve
  `postMessage` calls with a `*` origin.
- **PostHog**: ten `postMessage` calls with a `*` origin; names
  `sentry.io` and `yandex.com` in strings.
- **axios**: one `postMessage` with `*` origin (its `setImmediate`
  polyfill).
- **pixi.js** and **three.js** Emscripten transcoders (Basis, KTX, Draco,
  Ammo): `new Function` is embind, the fetch is their own `.wasm`. Tagged
  and ranked last.

## Nothing notable

react-dom, preact, lit, solid-js, svelte, jquery, dayjs, moment, gsap,
leaflet, swiper, bootstrap, highlight.js, prismjs, codemirror, quill,
hls.js, plyr, sweetalert2, dompurify, mermaid, katex, pdfjs-dist, fabric,
konva, tone, howler, chart.js, marked, lodash (one `Function` in
`template.js`, by design), socket.io-client, animejs, workbox-window
(registers service workers, which is what it is for).

## Reproduce

```bash
npm run sweep                 # the fifty above, cached after the first run
npm run sweep -- <pkg>@<ver>  # any package
npx frostjs audit node_modules/<pkg>   # the same, on what you have installed
```
