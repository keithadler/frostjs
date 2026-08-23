# Capabilities

The full taxonomy frostjs recognizes. This file is generated from
`src/capabilities.ts` by `frostjs capabilities --format md`; a test fails
if it drifts. A policy grants a whole family (`may use storage`) or a
single code (`may use local storage`); `may reach "<host>"` grants the
network family to named hosts.

## storage

Persisting data in the browser.

Policy phrase: `storage`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `storage.local` | localStorage | `local storage` |
| `storage.session` | sessionStorage | `session storage` |
| `storage.indexeddb` | indexedDB | `indexeddb` |
| `storage.cache` | caches (the Cache API) | `caches`, `the cache`, `cache storage` |
| `storage.cookie` | document.cookie | `cookies`, `the cookie` |
| `storage.navigator` | navigator.storage | `navigator storage` |

## network

Reaching another host, or loading code from one.

Policy phrase: `network`, `the network`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `network.fetch` | fetch(url) | `network.fetch` |
| `network.xhr` | new XMLHttpRequest() | `network.xhr` |
| `network.websocket` | new WebSocket(url) | `network.websocket` |
| `network.eventsource` | new EventSource(url) | `network.eventsource` |
| `network.beacon` | navigator.sendBeacon(url) | `network.beacon` |
| `network.import` | dynamic import() of an absolute URL or an unresolvable expression | `network.import` |
| `network.importscripts` | importScripts(url) in a worker (loads and runs a script) | `network.importscripts` |
| `network.resource` | el.src = "https://..." to another host | `network.resource` |
| `network.webtransport` | new WebTransport(url) | `network.webtransport` |
| `network.webrtc` | new RTCPeerConnection() (peer-to-peer connection) | `webrtc` |

## codegen

Turning a string into running code.

Policy phrase: `eval`, `code generation`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `codegen.eval` | eval(...) | `codegen.eval` |
| `codegen.function` | Function(...) or new Function(...) | `codegen.function` |
| `codegen.timer` | setTimeout / setInterval with a string first argument | `codegen.timer` |
| `codegen.write` | document.write / document.writeln | `codegen.write` |

## dom-escape

Turning a string into live markup, or creating an element that runs code.

Policy phrase: `html injection`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `dom-escape.html` | assignment to innerHTML / outerHTML / srcdoc, insertAdjacentHTML, createContextualFragment | `dom-escape.html` |
| `dom-escape.script` | document.createElement("script"), JSX <script> | `dom-escape.script` |
| `dom-escape.iframe` | document.createElement("iframe"), JSX <iframe> | `dom-escape.iframe` |
| `dom-escape.handler` | setAttribute("onclick" / "onerror" / ..., code) (a handler from a string) | `dom-escape.handler` |

## identity

Reading who or where the user is.

Policy phrase: `identity`, `fingerprinting`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `identity.device` | navigator.userAgent, platform, plugins, hardwareConcurrency, deviceMemory... | `identity.device` |
| `identity.geolocation` | navigator.geolocation | `identity.geolocation` |
| `identity.media` | navigator.mediaDevices, getUserMedia | `identity.media` |
| `identity.clipboard` | navigator.clipboard, document.execCommand("copy" / "paste") | `identity.clipboard` |
| `identity.credentials` | navigator.credentials | `identity.credentials` |
| `identity.permissions` | navigator.permissions | `identity.permissions` |

## navigation

Moving the page, or talking to another window.

Policy phrase: `navigation`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `navigation.location` | assignment to location / location.href, location.assign / replace / reload | `navigation.location` |
| `navigation.open` | window.open | `navigation.open` |
| `navigation.history` | history.pushState / replaceState / back / forward / go | `navigation.history` |
| `navigation.postmessage` | postMessage to parent / top / opener / contentWindow, or with a string origin | `navigation.postmessage` |
| `navigation.message-receive` | window.addEventListener("message", ...) whose handler reads event.data but never checks event.origin | `navigation.message-receive` |

## globals

Mutating shared global state that every script sees.

Policy phrase: `globals`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `globals.window` | assignment to window.* / globalThis.*, Object.defineProperty(window, ...) | `globals.window` |
| `globals.prototype` | assignment to a built-in or its prototype, or Object.defineProperty / assign on one | `globals.prototype` |

## worker

Running code off the main thread, or intercepting requests.

Policy phrase: `workers`, `service workers`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `worker.dedicated` | new Worker(url) | `worker.dedicated` |
| `worker.shared` | new SharedWorker(url) | `worker.shared` |
| `worker.service` | navigator.serviceWorker.register(url) | `worker.service` |
| `worker.worklet` | CSS.paintWorklet.addModule(url), audioWorklet.addModule(url)... | `worker.worklet` |

## device

Reaching the machine: hardware, files, notifications, payment.

Policy phrase: `device access`.

| code | triggered by | policy phrase |
| --- | --- | --- |
| `device.filesystem` | showOpenFilePicker / showSaveFilePicker / showDirectoryPicker (read or write the user's files) | `file access`, `the file system` |
| `device.usb` | navigator.usb (WebUSB) | `usb` |
| `device.bluetooth` | navigator.bluetooth (Web Bluetooth) | `bluetooth` |
| `device.serial` | navigator.serial (Web Serial) | `device.serial` |
| `device.hid` | navigator.hid (WebHID) | `device.hid` |
| `device.midi` | navigator.requestMIDIAccess (Web MIDI) | `device.midi` |
| `device.wakelock` | navigator.wakeLock | `device.wakelock` |
| `device.notification` | Notification | `notifications` |
| `device.payment` | PaymentRequest (the browser payment sheet) | `payments` |
