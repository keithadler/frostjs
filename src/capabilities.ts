/**
 * The canonical capability taxonomy with human descriptions. This is the
 * single source of truth: the README table, the `frostjs capabilities`
 * command and docs/CAPABILITIES.md are all generated from it, and a test
 * fails if it drifts from the codes the extractor actually emits
 * (MEMBER_CODES) or from the families (FAMILIES).
 */
import { FAMILIES, MEMBER_CODES, CAPABILITY_PHRASES } from "./policy/vocabulary.js";

/** One line per family: what the family is about. */
export const FAMILY_SUMMARY: Readonly<Record<string, string>> = {
  storage: "Persisting data in the browser.",
  network: "Reaching another host, or loading code from one.",
  codegen: "Turning a string into running code.",
  "dom-escape": "Turning a string into live markup, or creating an element that runs code.",
  identity: "Reading who or where the user is.",
  navigation: "Moving the page, or talking to another window.",
  globals: "Mutating shared global state that every script sees.",
  worker: "Running code off the main thread, or intercepting requests.",
  device: "Reaching the machine: hardware, files, notifications.",
};

/** What triggers each member code. Keep terse; no trailing period needed. */
export const CODE_TRIGGER: Readonly<Record<string, string>> = {
  "storage.local": "localStorage",
  "storage.session": "sessionStorage",
  "storage.indexeddb": "indexedDB",
  "storage.cache": "caches (the Cache API)",
  "storage.cookie": "document.cookie",
  "storage.navigator": "navigator.storage",
  "network.fetch": "fetch(url)",
  "network.xhr": "new XMLHttpRequest()",
  "network.websocket": "new WebSocket(url)",
  "network.eventsource": "new EventSource(url)",
  "network.beacon": "navigator.sendBeacon(url)",
  "network.import": "dynamic import() of an absolute URL or an unresolvable expression",
  "network.importscripts": "importScripts(url) in a worker (loads and runs a script)",
  "network.resource": 'el.src = "https://..." to another host',
  "codegen.eval": "eval(...)",
  "codegen.function": "Function(...) or new Function(...)",
  "codegen.timer": "setTimeout / setInterval with a string first argument",
  "codegen.write": "document.write / document.writeln",
  "dom-escape.html": "assignment to innerHTML / outerHTML / srcdoc, insertAdjacentHTML, createContextualFragment",
  "dom-escape.script": 'document.createElement("script"), JSX <script>',
  "dom-escape.iframe": 'document.createElement("iframe"), JSX <iframe>',
  "dom-escape.handler": 'setAttribute("onclick" / "onerror" / ..., code) (a handler from a string)',
  "identity.device": "navigator.userAgent, platform, plugins, hardwareConcurrency, deviceMemory...",
  "identity.geolocation": "navigator.geolocation",
  "identity.media": "navigator.mediaDevices, getUserMedia",
  "identity.clipboard": 'navigator.clipboard, document.execCommand("copy" / "paste")',
  "identity.credentials": "navigator.credentials",
  "identity.permissions": "navigator.permissions",
  "navigation.location": "assignment to location / location.href, location.assign / replace / reload",
  "navigation.open": "window.open",
  "navigation.history": "history.pushState / replaceState / back / forward / go",
  "navigation.postmessage": "postMessage to parent / top / opener / contentWindow, or with a string origin",
  "navigation.message-receive":
    'window.addEventListener("message", ...) whose handler reads event.data but never checks event.origin',
  "globals.window": "assignment to window.* / globalThis.*, Object.defineProperty(window, ...)",
  "globals.prototype": "assignment to a built-in or its prototype, or Object.defineProperty / assign on one",
  "worker.dedicated": "new Worker(url)",
  "worker.shared": "new SharedWorker(url)",
  "worker.service": "navigator.serviceWorker.register(url)",
  "worker.worklet": "CSS.paintWorklet.addModule(url), audioWorklet.addModule(url)...",
  "device.filesystem": "showOpenFilePicker / showSaveFilePicker / showDirectoryPicker (read or write the user's files)",
  "device.usb": "navigator.usb (WebUSB)",
  "device.bluetooth": "navigator.bluetooth (Web Bluetooth)",
  "device.serial": "navigator.serial (Web Serial)",
  "device.hid": "navigator.hid (WebHID)",
  "device.midi": "navigator.requestMIDIAccess (Web MIDI)",
  "device.wakelock": "navigator.wakeLock",
  "device.notification": "Notification",
};

export interface CapabilityDoc {
  family: string;
  familySummary: string;
  members: { code: string; trigger: string; phrases: string[] }[];
}

/** The phrases a policy author may write for a code (from the vocabulary), sorted shortest first. */
function phrasesFor(code: string): string[] {
  return [...CAPABILITY_PHRASES.entries()]
    .filter(([, c]) => c === code)
    .map(([phrase]) => phrase)
    .sort((a, b) => a.length - b.length);
}

/** The taxonomy grouped by family, in family order. */
export function capabilityDocs(): CapabilityDoc[] {
  return FAMILIES.map((family) => ({
    family,
    familySummary: FAMILY_SUMMARY[family] ?? "",
    members: MEMBER_CODES.filter((c) => c === family || c.startsWith(`${family}.`)).map((code) => ({
      code,
      trigger: CODE_TRIGGER[code] ?? "",
      phrases: phrasesFor(code),
    })),
  }));
}

/** `frostjs capabilities` as a plain-text listing. */
export function capabilitiesText(): string {
  const lines: string[] = [];
  for (const fam of capabilityDocs()) {
    const famPhrases = phrasesFor(fam.family);
    lines.push(`${fam.family}${famPhrases.length ? ` (${famPhrases.join(", ")})` : ""} - ${fam.familySummary}`);
    for (const m of fam.members) lines.push(`  ${m.code.padEnd(26)} ${m.trigger}`);
    lines.push("");
  }
  lines.push("A policy grants a family or a code:");
  lines.push("  may use storage            grants every storage.* member");
  lines.push("  may use local storage      grants storage.local");
  lines.push('  may reach "api.example.com"  grants the network family to that host');
  return lines.join("\n") + "\n";
}

/** `frostjs capabilities --format json`. */
export function capabilitiesJson(): string {
  return JSON.stringify({ families: capabilityDocs() }, null, 2) + "\n";
}

/** docs/CAPABILITIES.md, generated so it never drifts from the code. */
export function capabilitiesMarkdown(): string {
  const lines: string[] = [
    "# Capabilities",
    "",
    "The full taxonomy frostjs recognizes. This file is generated from",
    "`src/capabilities.ts` by `frostjs capabilities --format md`; a test fails",
    "if it drifts. A policy grants a whole family (`may use storage`) or a",
    'single code (`may use local storage`); `may reach "<host>"` grants the',
    "network family to named hosts.",
    "",
  ];
  for (const fam of capabilityDocs()) {
    const famPhrases = phrasesFor(fam.family);
    lines.push(`## ${fam.family}`);
    lines.push("");
    lines.push(fam.familySummary);
    if (famPhrases.length) lines.push(`\nPolicy phrase: ${famPhrases.map((p) => `\`${p}\``).join(", ")}.`);
    lines.push("");
    lines.push("| code | triggered by | policy phrase |");
    lines.push("| --- | --- | --- |");
    for (const m of fam.members) {
      const phrase = m.phrases.length ? m.phrases.map((p) => `\`${p}\``).join(", ") : `\`${m.code}\``;
      lines.push(`| \`${m.code}\` | ${m.trigger} | ${phrase} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
