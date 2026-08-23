/**
 * Static resolution of a network destination from an argument expression.
 *
 * Frost's rule: a literal that closes the authority fixes the host, and
 * nothing after the slash can move it. `"https://api.example.com/items/" + id`
 * reaches api.example.com. `"https://" + host` reaches nobody we can name,
 * so it resolves to null and the policy treats it as unknown.
 *
 * Relative URLs resolve to "same-origin". `data:` and `blob:` URLs resolve to
 * their scheme.
 */
import type { AnyNode } from "./ast.js";
import { FOLDED } from "./annotations.js";
import { unwrap } from "./typescript.js";

/** The target of a relative URL: the document's own origin. */
export const SAME_ORIGIN = "same-origin";

/** The known leading text of an expression, or null if it does not start with a literal. */
export function leadingLiteral(raw: AnyNode): { text: string; complete: boolean } | null {
  const node = unwrap(raw);
  switch (node.type) {
    case "Literal":
      return typeof node["value"] === "string" ? { text: node["value"], complete: true } : null;
    case "Identifier": {
      // A const bound to a string literal, folded by the scope analysis.
      const v = node[FOLDED];
      return typeof v === "string" ? { text: v, complete: true } : null;
    }
    case "TemplateLiteral": {
      const quasis = node["quasis"] as AnyNode[];
      const exprs = node["expressions"] as AnyNode[];
      const first = (quasis[0]?.["value"] as { cooked?: string } | undefined)?.cooked ?? "";
      return { text: first, complete: exprs.length === 0 };
    }
    case "BinaryExpression": {
      if (node["operator"] !== "+") return null;
      const left = leadingLiteral(node["left"] as AnyNode);
      if (left === null) return null;
      if (!left.complete) return left;
      const right = leadingLiteral(node["right"] as AnyNode);
      if (right === null) return { text: left.text, complete: false };
      return { text: left.text + right.text, complete: right.complete };
    }
    default:
      return null;
  }
}

const ABSOLUTE = /^([a-z][a-z0-9+.-]*):/i;
const AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:)?\/\/(?:[^/?#@\s]*@)?([^/?#:\s]+)(?::\d+)?(?=[/?#]|$)/i;

/**
 * How a string is interpreted when it has no scheme. A `url` (fetch,
 * WebSocket...) is relative to the document; a `specifier` (import) is a
 * path only when it starts with `/`, `./` or `../`, and otherwise a bare
 * package name resolved by the bundler or import map.
 */
export type TargetKind = "url" | "specifier";

/**
 * Resolve a URL-ish string, or a known prefix of one, to a host.
 * Returns null when the host cannot be fixed from what is known.
 */
export function resolveTarget(text: string, complete = true, kind: TargetKind = "url"): string | null {
  const t = text.trim();
  if (t === "") return null;
  const m = AUTHORITY.exec(t);
  if (m) {
    // A prefix that ends inside the host cannot be trusted; `"https://api" + rest` might be api.evil.com.
    const host = m[1]!;
    const closed = complete || t.length > m[0].length;
    return closed ? host.toLowerCase() : null;
  }
  if (t.startsWith("//")) return null; // scheme-relative with an unfinished host
  const scheme = ABSOLUTE.exec(t);
  if (scheme) {
    const s = scheme[1]!.toLowerCase();
    if (s === "data" || s === "blob" || s === "javascript") return `${s}:`;
    if (s === "node" || s === "file") return "bare"; // local to the runtime, not a network destination
    return null; // some other scheme with no authority we understand
  }
  // No scheme and no authority.
  if (kind === "url") return SAME_ORIGIN;
  return t.startsWith("/") || t.startsWith("./") || t.startsWith("../") ? SAME_ORIGIN : "bare";
}

/** Resolve the destination of an argument expression, or null. */
export function resolveTargetOf(arg: AnyNode | undefined, kind: TargetKind = "url"): string | null {
  if (!arg) return null;
  const lit = leadingLiteral(arg);
  if (lit === null) return null;
  return resolveTarget(lit.text, lit.complete, kind);
}
