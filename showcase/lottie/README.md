# Showcase: lottie-web evaluates the animation you load

The three.js finding in [`SHOWCASE.md`](../../SHOWCASE.md) is a remote eval
behind a URL parameter, reported upstream, in a file most people never open.
This one is the opposite in every way that matters: it is public, it has been
exploited in the wild, it is documented behaviour the maintainers know about,
and it is on by default in the current release. It is here because it is the
clearest possible answer to "why would I run a capability linter over a
dependency I trust" — the dependency is trusted, has ~5M weekly downloads, and
runs the JSON you hand it.

## The finding

`lottie-web` renders After Effects animations exported as JSON. The format has
an *expressions* feature: a property can carry an `x` field holding a snippet
of JavaScript that is evaluated every frame to compute the property's value.
The engine runs that snippet with `eval`. In 5.13.0 (current), the sink is
`build/player/lottie.js:14422`:

```js
// val = val.replace(/(\\?"|')((http)(s)?(:\/))?\/.*?(\\?"|')/g, "\"\""); // deter potential network calls
var expression_function = eval('[function _expression_function(){' + val + ';scoped_bm_rt=$bm_rt}]')[0]; // eslint-disable-line no-eval
```

`val` is `data.x`, lifted straight out of the animation JSON. Three things
make this reachable without the consuming application doing anything unusual:

- **The default npm build has it.** `lottie-web`'s `main` is
  `build/player/lottie.js`, the full build, which includes the expression
  engine. `lottie_light.js` is the only shipped build with no `eval` — and it
  is not the default.
- **Expressions are on by default.** The engine gates the eval on a
  `runExpressions` flag whose default is *true*:
  ```js
  runExpressions: !config || config.runExpressions === undefined || config.runExpressions
  ```
  No config, or a config that doesn't mention the flag, both resolve to `true`.
- **No API call is needed to arm it.** While the player builds properties from
  the JSON, any property with an `x` field wires the expression up on the spot
  (`lottie.js:15968`): `if (data.x) { ... prop.initiateExpression(elem, data, prop) ... }`.

So an application that uses `lottie-web` the ordinary way —
`lottie.loadAnimation({ container, animationData })` — and sources
`animationData` from anywhere it does not fully control (a user upload, a
marketplace like LottieFiles, a third-party CDN, a design handoff) is running
whatever JavaScript the author of that file put in an expression, in its own
origin. That is XSS with the animation file as the payload: cookie theft,
token exfiltration, anything the page can do.

## This is not a discovery

It is worth being plain about that. The maintainers know: the line above is
`eslint-disable`-d, it sits under a commented-out attempt to strip network
calls out of `val`, and the `runExpressions` opt-out exists precisely so
security-conscious consumers can turn it off. It has been raised many times
([airbnb/lottie-web#2828](https://github.com/airbnb/lottie-web/issues/2828),
[#3048](https://github.com/airbnb/lottie-web/issues/3048),
[#3122](https://github.com/airbnb/lottie-web/issues/3122), and downstream in
lottie-react and dotlottie-web). And it has been used: CertiK's
[write-up](https://www.certik.com/blog/lottie-file-incidents-case-studies-of-third-party-supply-chain-risks)
of the CoinMarketCap "CoinmarketCLAP" incident describes a malicious Lottie
doodle whose expression ran via this exact `eval`.

frostjs did not find a new bug. The value is that it finds *this* bug — a real,
exploited, still-default-on eval sink — in your dependency graph, before it
ships, without you having read `lottie.js`.

## What frostjs says

A plausible policy for an application that uses `lottie-web` grants the
ordinary capabilities the player reaches for — it loads animations over XHR,
sniffs `navigator.userAgent`, exposes `window.lottie`, and optionally renders
in a worker ([`frostjs.policy`](frostjs.policy)):

```
policy "lottie-app"
may reach "same-origin"     -- animation JSON and assets from our own origin
may use network.xhr         -- XHR-loads animations referenced by URL
may use workers             -- optional web-worker rendering
may use identity.device     -- navigator.userAgent feature detection
may use globals.window      -- exposes window.lottie / window.bodymovin
```

Against the default build, one thing is left denied:

```
$ frostjs build/player/lottie.js
build/player/lottie.js:14422:33: codegen.eval denied by default (no rule grants it): eval('[function _expression_function(){' + val + ';scoped_bm_rt=$bm_rt}]')[0]

1 file, 1 denied, 0 unknown
```

Those five grants are everything an ordinary Lottie integration legitimately
does; the eval is the one capability that survives. No application policy that
wasn't written by someone who already knew about
Lottie expressions grants `codegen.eval` to an animation player. So adding
`lottie-web` fails the build, and the person adding it has to make a decision
in the open:

- switch the import to `lottie-web/build/player/lottie_light` (no expression
  engine, no eval), or
- pass `rendererSettings: { runExpressions: false }` to every `loadAnimation`
  call, or
- if expressions really are needed, only ever feed the player animation JSON
  from a source as trusted as first-party code — and grant the capability with
  a policy line that says so, in one place, where a reviewer sees it:

  ```
  may use eval in "**/lottie*.js"   -- Lottie expression engine; animations are first-party only
  ```

The CSP the same policy emits is the runtime backstop: `script-src 'self'`
without `'unsafe-eval'` stops the `eval` even if a tainted animation reaches a
build that never turned expressions off.

## The threat-model caveat, same as always

frostjs flags this because `eval` is `eval` and the default policy says no. It
does not understand Lottie, expressions, or that `val` is attacker-reachable —
it does not need to. The corollary is the usual one: it catches the sink, not
the reachability. Whether *your* animations are untrusted is the question the
denial forces you to answer, which is the whole point.

## Reproduce

The detection is pinned by [`test/showcase-lottie.test.ts`](../../test/showcase-lottie.test.ts),
which runs the extractor over the reduced ExpressionManager construct and
asserts the single `codegen.eval` finding. Against the real package:

```bash
npm pack lottie-web            # 5.13.0 at time of writing
tar -xzf lottie-web-*.tgz
frostjs package/build/player/lottie.js
```
