import type { Node } from "../ast.js";
import type { Recognizer } from "./types.js";
import { asNamedGlobal, memberName } from "./globals.js";

type AnyNode = Node & Record<string, unknown>;

/** Properties whose assignment parses HTML. */
const HTML_SINKS: ReadonlySet<string> = new Set(["innerHTML", "outerHTML", "srcdoc"]);

/** Methods whose call parses HTML. */
const HTML_METHODS: ReadonlySet<string> = new Set(["insertAdjacentHTML", "createContextualFragment"]);

/**
 * DOM escape hatches: anything that turns a string into markup or creates
 * an element that runs code. The object is not checked - `el.innerHTML = x`
 * is injection whatever `el` is - but only writes and calls count. Reading
 * innerHTML is not injection.
 */
export const domEscape: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null) return null;
  const parent = ancestors[0] as AnyNode | undefined;
  if (!parent) return null;

  if (HTML_SINKS.has(prop)) {
    const assigned = parent.type === "AssignmentExpression" && parent["left"] === node;
    return assigned
      ? { capability: "dom-escape.html", target: null, confidence: "certain", via: null, node: parent }
      : null;
  }

  const isCallee = parent.type === "CallExpression" && parent["callee"] === node;
  if (!isCallee) return null;

  if (HTML_METHODS.has(prop)) {
    return { capability: "dom-escape.html", target: null, confidence: "certain", via: null, node };
  }

  if (prop === "createElement") {
    const d = asNamedGlobal(n["object"] as AnyNode, "document");
    if (!d) return null;
    const first = (parent["arguments"] as AnyNode[])[0];
    const tag = first?.type === "Literal" && typeof first["value"] === "string" ? first["value"].toLowerCase() : null;
    if (tag === "script")
      return { capability: "dom-escape.script", target: null, confidence: d.confidence, via: d.via, node };
    if (tag === "iframe")
      return { capability: "dom-escape.iframe", target: null, confidence: d.confidence, via: d.via, node };
  }
  return null;
};
