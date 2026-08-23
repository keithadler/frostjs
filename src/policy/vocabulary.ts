/**
 * The words a policy author may use for a capability, mapped to the stable
 * code the extractor emits. Phrases are matched after lowercasing and
 * whitespace collapsing. A capability code is always accepted as-is.
 */
export const CAPABILITY_PHRASES: ReadonlyMap<string, string> = new Map([
  ["everything", "*"],
  // storage
  ["storage", "storage"],
  ["local storage", "storage.local"],
  ["session storage", "storage.session"],
  ["cookies", "storage.cookie"],
  ["the cookie", "storage.cookie"],
  ["indexeddb", "storage.indexeddb"],
  ["the cache", "storage.cache"],
  ["caches", "storage.cache"],
  ["cache storage", "storage.cache"],
  ["navigator storage", "storage.navigator"],
  // network
  ["the network", "network"],
  ["network", "network"],
  // codegen
  ["code generation", "codegen"],
  ["eval", "codegen"],
  // dom-escape
  ["html injection", "dom-escape"],
  // identity
  ["identity", "identity"],
  ["fingerprinting", "identity"],
  // navigation
  ["navigation", "navigation"],
  // globals
  ["globals", "globals"],
  // worker
  ["workers", "worker"],
  ["service workers", "worker"],
  // device
  ["device access", "device"],
  ["file access", "device.filesystem"],
  ["the file system", "device.filesystem"],
  ["usb", "device.usb"],
  ["bluetooth", "device.bluetooth"],
  ["notifications", "device.notification"],
]);

/** Every capability family code, for validating a bare code and for hints. */
export const FAMILIES: readonly string[] = [
  "storage",
  "network",
  "codegen",
  "dom-escape",
  "identity",
  "navigation",
  "globals",
  "worker",
  "device",
];

/** Every member code the extractor can emit. Keep in step with src/extract/recognizers. */
export const MEMBER_CODES: readonly string[] = [
  "storage.local",
  "storage.session",
  "storage.indexeddb",
  "storage.cache",
  "storage.cookie",
  "storage.navigator",
  "network.fetch",
  "network.xhr",
  "network.websocket",
  "network.eventsource",
  "network.beacon",
  "network.import",
  "network.importscripts",
  "network.resource",
  "codegen.eval",
  "codegen.function",
  "codegen.timer",
  "codegen.write",
  "dom-escape.html",
  "dom-escape.script",
  "dom-escape.iframe",
  "identity.device",
  "identity.geolocation",
  "identity.media",
  "identity.clipboard",
  "identity.credentials",
  "identity.permissions",
  "navigation.location",
  "navigation.open",
  "navigation.history",
  "navigation.postmessage",
  "globals.window",
  "globals.prototype",
  "worker.dedicated",
  "worker.shared",
  "worker.service",
  "worker.worklet",
  "device.filesystem",
  "device.usb",
  "device.bluetooth",
  "device.serial",
  "device.hid",
  "device.midi",
  "device.wakelock",
  "device.notification",
];

/** Every code a policy may name directly: the families and each member the extractor can emit. */
export const KNOWN_CODES: ReadonlySet<string> = new Set([...FAMILIES, ...MEMBER_CODES]);

/** Resolve a phrase or code to a capability code, or null. */
export function resolveCapability(words: string): string | null {
  const key = words.trim().toLowerCase().replace(/\s+/g, " ");
  const phrase = CAPABILITY_PHRASES.get(key);
  if (phrase !== undefined) return phrase;
  if (KNOWN_CODES.has(key)) return key;
  return null;
}
