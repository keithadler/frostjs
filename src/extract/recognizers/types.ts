import type { AnyNode, Node } from "../ast.js";
import type { Visit } from "../walk.js";
import type { Confidence } from "../capability.js";

/** A resolved reference to a global: the confidence, and the identifier node the resolution rests on. */
export interface Resolved {
  confidence: Confidence;
  via: Node | null;
}

export interface Match {
  /** Stable code, e.g. "storage.local". */
  capability: string;
  /** Resolved destination for network-like uses, else null. */
  target: string | null;
  confidence: Confidence;
  /** The node the match is anchored on; the reported expression grows outward from here. */
  node: Node;
  /** The identifier the match rests on (`localStorage`, `window`...), or null if none. A local binding of it means no match. */
  via: Node | null;
}

/**
 * A recognizer sees every node with its ancestors and whether it sits in a
 * binding position, and returns a Match or null. It pattern-matches on
 * shape only; whether `via` is shadowed is decided afterwards from the
 * scope annotations.
 */
export type Recognizer = (v: Visit) => Match | null;

/** Build a Match from a resolved global reference. */
export function match(capability: string, r: Resolved, node: Node, target: string | null = null): Match {
  return { capability, target, confidence: r.confidence, via: r.via, node };
}

/** A Match that rests on no identifier (JSX syntax, dynamic import, a property write on any object). */
export function plain(capability: string, node: Node, target: string | null = null): Match {
  return { capability, target, confidence: "certain", via: null, node };
}

/**
 * If `node` is the callee of its parent call (or `new`, when allowed),
 * return the call's arguments; otherwise null.
 */
export function callArgs(node: Node, parent: AnyNode | undefined, allowNew = false): AnyNode[] | null {
  if (!parent || parent["callee"] !== node) return null;
  if (parent.type === "CallExpression" || (allowNew && parent.type === "NewExpression")) {
    return parent["arguments"] as AnyNode[];
  }
  return null;
}

/** The value of a string literal node, else null. Templates and folds are deliberately not accepted here. */
export function stringValue(n: AnyNode | undefined): string | null {
  return n?.type === "Literal" && typeof n["value"] === "string" ? n["value"] : null;
}
