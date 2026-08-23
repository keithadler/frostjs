import type { AnyNode } from "../ast.js";
import { callArgs, match, plain, stringValue, type Recognizer } from "./types.js";
import { asNamedGlobal, memberName } from "./resolve.js";

/** Properties whose assignment parses HTML. */
const HTML_SINKS: ReadonlySet<string> = new Set(["innerHTML", "outerHTML", "srcdoc"]);

/** Methods whose call parses HTML. */
const HTML_METHODS: ReadonlySet<string> = new Set(["insertAdjacentHTML", "createContextualFragment"]);

/** Intrinsic JSX elements, and createElement tag names, that run code. */
const CODE_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ["script", "dom-escape.script"],
  ["iframe", "dom-escape.iframe"],
]);

/**
 * DOM escape hatches: anything that turns a string into markup or creates
 * an element that runs code. The object is not checked - `el.innerHTML = x`
 * is injection whatever `el` is - but only writes and calls count; reading
 * innerHTML is not injection. In JSX, `dangerouslySetInnerHTML` and
 * `srcdoc` attributes and intrinsic `<script>` / `<iframe>` elements count;
 * component names do not.
 */
export const domEscape: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;

  if (n.type === "JSXAttribute") {
    const name = n["name"] as AnyNode;
    const attr = name.type === "JSXIdentifier" ? (name["name"] as string) : null;
    return attr === "dangerouslySetInnerHTML" || attr === "srcdoc" ? plain("dom-escape.html", node) : null;
  }
  if (n.type === "JSXOpeningElement") {
    const name = n["name"] as AnyNode;
    const cap = name.type === "JSXIdentifier" ? CODE_ELEMENTS.get(name["name"] as string) : undefined;
    return cap ? plain(cap, node) : null;
  }

  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null) return null;
  const parent = ancestors[0] as AnyNode | undefined;
  if (!parent) return null;

  if (HTML_SINKS.has(prop)) {
    const assigned = parent.type === "AssignmentExpression" && parent["left"] === node;
    return assigned ? plain("dom-escape.html", parent) : null;
  }

  const args = callArgs(node, parent);
  if (!args) return null;
  if (HTML_METHODS.has(prop)) return plain("dom-escape.html", node);
  if (prop === "createElement") {
    const r = asNamedGlobal(n["object"] as AnyNode, "document");
    const cap = r ? CODE_ELEMENTS.get(stringValue(args[0])?.toLowerCase() ?? "") : undefined;
    return r && cap ? match(cap, r, node) : null;
  }
  return null;
};
