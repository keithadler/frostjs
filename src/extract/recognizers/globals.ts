/**
 * Shared helpers for recognizing references to well-known browser globals.
 * Scope analysis (is `window` shadowed here?) is Phase D; until then a
 * reference-position identifier with a global's name is taken at face value.
 */
import type { Node } from "../ast.js";
import type { Confidence } from "../capability.js";

type AnyNode = Node & Record<string, unknown>;

/** A resolved reference to a global, and the name it depends on. */
export interface Resolved {
  confidence: Confidence;
  via: string;
}

export const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["window", "globalThis", "self"]);

/** `self` is routinely a local alias for `this` in older code, so it is only probable. */
export function globalConfidence(name: string): Confidence {
  return name === "self" ? "probable" : "certain";
}

export function isIdentifier(n: unknown, name?: string): n is AnyNode & { name: string } {
  if (!n || (n as AnyNode).type !== "Identifier") return false;
  return name === undefined || (n as AnyNode)["name"] === name;
}

/** The static property name of a member expression, or null if it is dynamic. */
export function memberName(n: AnyNode): string | null {
  if (n.type !== "MemberExpression") return null;
  const prop = n["property"] as AnyNode;
  if (n["computed"] !== true) return isIdentifier(prop) ? prop.name : null;
  if (prop.type === "Literal" && typeof prop["value"] === "string") return prop["value"];
  return null;
}

/**
 * If `n` denotes the global object (`window`, `globalThis`, `self`), return
 * the confidence; otherwise null.
 */
export function asGlobalObject(n: AnyNode): Resolved | null {
  if (isIdentifier(n) && GLOBAL_OBJECTS.has(n.name)) {
    return { confidence: globalConfidence(n.name), via: n.name };
  }
  return null;
}

/**
 * If `n` denotes the named global (e.g. `document`, `navigator`), either as a
 * bare identifier or as `window.<name>`, return the confidence; else null.
 */
export function asNamedGlobal(n: AnyNode, name: string): Resolved | null {
  if (isIdentifier(n, name)) return { confidence: "certain", via: name };
  if (n.type === "MemberExpression" && memberName(n) === name) {
    return asGlobalObject(n["object"] as AnyNode);
  }
  return null;
}
