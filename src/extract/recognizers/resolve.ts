/**
 * Shared helpers for recognizing references to well-known browser globals.
 * These only decide what a node looks like; whether the identifier is
 * shadowed by a local is decided later from the scope annotations
 * (see annotations.ts), which is why every result carries `via`.
 */
import type { AnyNode } from "../ast.js";
import type { Confidence } from "../capability.js";
import { leadingLiteral } from "../target.js";
import { unwrap } from "../typescript.js";
import type { Resolved } from "./types.js";

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["window", "globalThis", "self"]);

/** `self` is routinely a local alias for `this` in older code, so it is only probable. */
function globalConfidence(name: string): Confidence {
  return name === "self" ? "probable" : "certain";
}

/** True for an Identifier node, optionally with the given name. */
export function isIdentifier(n: unknown, name?: string): n is AnyNode & { name: string } {
  if (!n || (n as AnyNode).type !== "Identifier") return false;
  return name === undefined || (n as AnyNode)["name"] === name;
}

/**
 * The static property name of a member expression, or null if it is dynamic.
 * A computed name is resolved from a string literal, an expression-free
 * template, a concatenation of literals, or an identifier the scope
 * analysis folded from `const k = "..."`.
 */
export function memberName(n: AnyNode): string | null {
  if (n.type !== "MemberExpression") return null;
  const prop = n["property"] as AnyNode;
  if (n["computed"] !== true) return isIdentifier(prop) ? prop.name : null;
  const lit = leadingLiteral(prop);
  return lit !== null && lit.complete ? lit.text : null;
}

/** True when a computed member name came from anything other than a plain string literal. */
export function isFoldedMember(n: AnyNode): boolean {
  const m = (n.type === "AssignmentExpression" ? n["left"] : n) as AnyNode;
  if (m.type !== "MemberExpression" || m["computed"] !== true) return false;
  return (m["property"] as AnyNode).type !== "Literal";
}

/** If `raw` denotes the global object (`window`, `globalThis`, `self`), how it resolves; else null. */
export function asGlobalObject(raw: AnyNode): Resolved | null {
  const n = unwrap(raw);
  if (isIdentifier(n) && GLOBAL_OBJECTS.has(n.name)) {
    return { confidence: globalConfidence(n.name), via: n };
  }
  return null;
}

/**
 * If `raw` denotes the named global (`document`, `navigator`, `history`...),
 * bare or as `window.<name>`, how it resolves; else null.
 */
export function asNamedGlobal(raw: AnyNode, name: string): Resolved | null {
  const n = unwrap(raw);
  if (isIdentifier(n, name)) return { confidence: "certain", via: n };
  if (n.type === "MemberExpression" && memberName(n) === name) {
    return asGlobalObject(n["object"] as AnyNode);
  }
  return null;
}

/**
 * If `n` is one of `names`, bare (`fetch`) or through the global object
 * (`window.fetch`, `globalThis["fetch"]`), return which and how it resolves.
 */
export function asGlobalIn(n: AnyNode, names: ReadonlySet<string>): { name: string; r: Resolved } | null {
  if (isIdentifier(n)) return names.has(n.name) ? { name: n.name, r: { confidence: "certain", via: n } } : null;
  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null || !names.has(prop)) return null;
  const r = asGlobalObject(n["object"] as AnyNode);
  return r ? { name: prop, r } : null;
}
