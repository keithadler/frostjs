import type { AnyNode } from "../ast.js";
import { callArgs, plain, type Recognizer } from "./types.js";
import { isIdentifier, memberName } from "./resolve.js";
import { FREE } from "../annotations.js";

type Node = AnyNode;

/**
 * A main-thread `message` listener that reads the message but never checks
 * its origin. `window.addEventListener("message", handler)` receives
 * messages from any frame or window; a handler that uses `event.data`
 * without comparing `event.origin` is the classic postMessage-XSS shape.
 * This is a heuristic: it fires when the handler references the event's
 * `data` and nowhere references its `origin`. `window.onmessage = handler`
 * is covered too.
 *
 * Only `window` counts, not `self`/`globalThis`: `self.onmessage` is the
 * worker idiom, and a worker's messages come from its own creator, so an
 * origin check does not apply there.
 */
export const message: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as Node;
  const parent = ancestors[0] as Node | undefined;

  if (n.type !== "MemberExpression" || !isWindow(n["object"] as Node)) return null;
  let handler: Node | undefined;
  // window.addEventListener("message", handler)
  if (memberName(n) === "addEventListener") {
    const args = callArgs(node, parent);
    if (args && stringLit(args[0]) === "message") handler = args[1];
  }
  // window.onmessage = handler
  if (memberName(n) === "onmessage" && parent?.type === "AssignmentExpression" && parent["left"] === node) {
    handler = parent["right"] as Node;
  }
  if (handler === undefined) return null;

  const param = firstParamName(handler);
  if (param === null) return null; // no named event parameter to reason about
  const body = handler["body"] as Node | undefined;
  if (!body) return null;
  const readsData = referencesMember(body, param, "data");
  const checksOrigin = referencesMember(body, param, "origin");
  if (readsData && !checksOrigin) return plain("navigation.message-receive", n);
  return null;
};

/** True for a free reference to the `window` global. */
function isWindow(nd: Node): boolean {
  return isIdentifier(nd, "window") && nd[FREE] === true;
}

function stringLit(nd: Node | undefined): string | null {
  return nd?.type === "Literal" && typeof nd["value"] === "string" ? nd["value"] : null;
}

/** The first parameter's identifier name of a function/arrow, or null if it is not a plain name. */
function firstParamName(fn: Node): string | null {
  const params = fn["params"] as Node[] | undefined;
  const p = params?.[0];
  return p?.type === "Identifier" ? (p["name"] as string) : null;
}

/** Does the subtree contain `<param>.<prop>` (or `<param>["<prop>"]`)? A shallow, allocation-free walk. */
function referencesMember(root: Node, param: string, prop: string): boolean {
  let found = false;
  const visit = (nd: Node): void => {
    if (found) return;
    if (nd.type === "MemberExpression") {
      const obj = nd["object"] as Node;
      if (isIdentifier(obj, param) && memberName(nd) === prop) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(nd)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = nd[key];
      if (Array.isArray(v)) {
        for (const item of v)
          if (item && typeof item === "object" && typeof (item as Node).type === "string") visit(item as Node);
      } else if (v && typeof v === "object" && typeof (v as Node).type === "string") {
        visit(v as Node);
      }
    }
  };
  visit(root);
  return found;
}
