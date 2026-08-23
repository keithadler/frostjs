import type { Node } from "../ast.js";
import type { Recognizer, Match } from "./types.js";
import { asGlobalObject, asNamedGlobal, isIdentifier, memberName, type Resolved } from "./globals.js";

type AnyNode = Node & Record<string, unknown>;

/** Globals that are themselves storage handles. A Map, so prototype names never match. */
const STORAGE_GLOBALS: ReadonlyMap<string, string> = new Map([
  ["localStorage", "storage.local"],
  ["sessionStorage", "storage.session"],
  ["indexedDB", "storage.indexeddb"],
  ["caches", "storage.cache"],
]);

export const storage: Recognizer = ({ node, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;

  // Bare reference: localStorage, sessionStorage, indexedDB, caches.
  if (isIdentifier(n)) {
    const cap = STORAGE_GLOBALS.get(n.name);
    return cap ? match(cap, { confidence: "certain", via: n }, node) : null;
  }

  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null) return null;
  const obj = n["object"] as AnyNode;

  // window.localStorage, globalThis["sessionStorage"], ...
  const viaGlobal = STORAGE_GLOBALS.get(prop);
  if (viaGlobal) {
    const r = asGlobalObject(obj);
    return r ? match(viaGlobal, r, node) : null;
  }

  // document.cookie, window.document.cookie
  if (prop === "cookie") {
    const r = asNamedGlobal(obj, "document");
    return r ? match("storage.cookie", r, node) : null;
  }

  // navigator.storage, window.navigator.storage
  if (prop === "storage") {
    const r = asNamedGlobal(obj, "navigator");
    return r ? match("storage.navigator", r, node) : null;
  }

  return null;
};

function match(capability: string, r: Resolved, node: Node): Match {
  return { capability, target: null, confidence: r.confidence, via: r.via, node };
}
