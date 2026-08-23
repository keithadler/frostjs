import type { Node } from "../ast.js";
import type { Recognizer } from "./types.js";
import { asGlobalObject, asNamedGlobal, isIdentifier, memberName, type Resolved } from "./globals.js";
import { leadingLiteral } from "../target.js";

type AnyNode = Node & Record<string, unknown>;

const TIMERS: ReadonlySet<string> = new Set(["setTimeout", "setInterval"]);

export const codegen: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const parent = ancestors[0] as AnyNode | undefined;
  const isCallee =
    parent !== undefined &&
    (parent.type === "CallExpression" || parent.type === "NewExpression") &&
    parent["callee"] === node;

  // Name and how it resolves, for a bare identifier or window.<name>.
  let name: string | null = null;
  let r: Resolved | null = null;
  if (isIdentifier(n)) {
    name = n.name;
    r = { confidence: "certain", via: n.name };
  } else if (n.type === "MemberExpression") {
    const prop = memberName(n);
    const obj = n["object"] as AnyNode;
    if (prop === "write" || prop === "writeln") {
      const d = asNamedGlobal(obj, "document");
      return d && isCallee
        ? { capability: "codegen.write", target: null, confidence: d.confidence, via: d.via, node }
        : null;
    }
    if (prop !== null) {
      name = prop;
      r = asGlobalObject(obj);
    }
  }
  if (name === null || r === null) return null;

  if (name === "eval") {
    return { capability: "codegen.eval", target: null, confidence: r.confidence, via: r.via, node };
  }
  if (name === "Function" && isCallee) {
    return { capability: "codegen.function", target: null, confidence: r.confidence, via: r.via, node };
  }
  if (TIMERS.has(name) && isCallee) {
    const first = (parent!["arguments"] as AnyNode[])[0];
    if (first && leadingLiteral(first) !== null) {
      return { capability: "codegen.timer", target: null, confidence: r.confidence, via: r.via, node };
    }
  }
  return null;
};
