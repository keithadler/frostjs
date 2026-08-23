import type { AnyNode } from "../ast.js";
import { match, type Recognizer } from "./types.js";
import { asGlobalIn, asNamedGlobal, memberName } from "./resolve.js";

/** Globals that are themselves storage handles. A Map, so prototype names never match. */
const STORAGE_GLOBALS: ReadonlyMap<string, string> = new Map([
  ["localStorage", "storage.local"],
  ["sessionStorage", "storage.session"],
  ["indexedDB", "storage.indexeddb"],
  ["caches", "storage.cache"],
]);

/**
 * Client-side persistence: the storage globals (bare or via the global
 * object), `document.cookie` read or written, and `navigator.storage`.
 * Any reference counts, including `typeof localStorage`, because a
 * feature check is still a reach for the capability.
 */
export const storage: Recognizer = ({ node, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;

  const g = asGlobalIn(n, new Set(STORAGE_GLOBALS.keys()));
  if (g) return match(STORAGE_GLOBALS.get(g.name)!, g.r, node);

  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  const obj = n["object"] as AnyNode;
  if (prop === "cookie") {
    const r = asNamedGlobal(obj, "document");
    return r ? match("storage.cookie", r, node) : null;
  }
  if (prop === "storage") {
    const r = asNamedGlobal(obj, "navigator");
    return r ? match("storage.navigator", r, node) : null;
  }
  return null;
};
