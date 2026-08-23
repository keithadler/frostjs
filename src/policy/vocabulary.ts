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
];

/** Every code a policy may name directly: the families and each member the extractor can emit. */
export const KNOWN_CODES: ReadonlySet<string> = new Set([...FAMILIES, ...CAPABILITY_PHRASES.values()].filter((c) => c !== "*"));

/** Resolve a phrase or code to a capability code, or null. */
export function resolveCapability(words: string): string | null {
  const key = words.trim().toLowerCase().replace(/\s+/g, " ");
  const phrase = CAPABILITY_PHRASES.get(key);
  if (phrase !== undefined) return phrase;
  if (KNOWN_CODES.has(key)) return key;
  return null;
}
