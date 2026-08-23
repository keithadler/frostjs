/**
 * Shared helpers for recognizing references to well-known browser globals.
 * Scope analysis (is `window` shadowed here?) is Phase D; until then a
 * reference-position identifier with a global's name is taken at face value.
 */
import type { Node } from "../ast.js";
import type { Confidence } from "../capability.js";
import { leadingLiteral } from "../target.js";
import { unwrap } from "../typescript.js";

type AnyNode = Node & Record<string, unknown>;

/** A resolved reference to a global: the confidence, and the identifier node the resolution rests on. */
export interface Resolved {
  confidence: Confidence;
  via: Node | null;
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

/**
 * The static property name of a member expression, or null if it is dynamic.
 * A computed name is resolved from a string literal, an expression-free
 * template, a concatenation of literals, or an identifier the scope
 * analysis folded from `const k = "..."` (see FOLDED).
 */
export function memberName(n: AnyNode): string | null {
  if (n.type !== "MemberExpression") return null;
  const prop = n["property"] as AnyNode;
  if (n["computed"] !== true) return isIdentifier(prop) ? prop.name : null;
  if (prop.type === "Literal") return typeof prop["value"] === "string" ? prop["value"] : null;
  if (isIdentifier(prop)) return (prop[FOLDED] as string | undefined) ?? null;
  const lit = leadingLiteral(prop);
  return lit !== null && lit.complete ? lit.text : null;
}

/** Annotation keys written onto identifier nodes by the scope analysis. */
export const FOLDED = "$permitFolded";
export const FREE = "$permitFree";
export const AMBIGUOUS = "$permitAmbiguous";

/** True when the member name came from anything other than a plain literal or identifier. */
export function isFoldedMember(n: AnyNode): boolean {
  const m = (n.type === "AssignmentExpression" ? n["left"] : n) as AnyNode;
  if (m.type !== "MemberExpression" || m["computed"] !== true) return false;
  return (m["property"] as AnyNode).type !== "Literal";
}

/**
 * If `n` denotes the global object (`window`, `globalThis`, `self`), return
 * the confidence; otherwise null.
 */
export function asGlobalObject(raw: AnyNode): Resolved | null {
  const n = unwrap(raw);
  if (isIdentifier(n) && GLOBAL_OBJECTS.has(n.name)) {
    return { confidence: globalConfidence(n.name), via: n };
  }
  return null;
}

/**
 * If `n` denotes the named global (e.g. `document`, `navigator`), either as a
 * bare identifier or as `window.<name>`, return the confidence; else null.
 */
export function asNamedGlobal(raw: AnyNode, name: string): Resolved | null {
  const n = unwrap(raw);
  if (isIdentifier(n, name)) return { confidence: "certain", via: n };
  if (n.type === "MemberExpression" && memberName(n) === name) {
    return asGlobalObject(n["object"] as AnyNode);
  }
  return null;
}
