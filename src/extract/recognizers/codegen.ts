import type { AnyNode } from "../ast.js";
import { callArgs, match, type Recognizer } from "./types.js";
import { asGlobalIn, asNamedGlobal, memberName } from "./resolve.js";
import { leadingLiteral } from "../target.js";

const CODEGEN_NAMES: ReadonlySet<string> = new Set(["eval", "Function", "setTimeout", "setInterval"]);

/**
 * Turning strings into code: eval (direct, indirect, or via the global
 * object), Function only when it is actually called or constructed (a bare
 * `Function` reference such as `instanceof Function` is everywhere and is
 * not codegen), timers only when the first argument is string-valued, and
 * document.write.
 */
export const codegen: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const parent = ancestors[0] as AnyNode | undefined;

  if (n.type === "MemberExpression") {
    const prop = memberName(n);
    if (prop === "write" || prop === "writeln") {
      const r = asNamedGlobal(n["object"] as AnyNode, "document");
      return r && callArgs(node, parent) ? match("codegen.write", r, node) : null;
    }
  }

  const g = asGlobalIn(n, CODEGEN_NAMES);
  if (!g) return null;
  const args = callArgs(node, parent, true);
  switch (g.name) {
    case "eval":
      return match("codegen.eval", g.r, node);
    case "Function":
      return args ? match("codegen.function", g.r, node) : null;
    default: {
      const first = args?.[0];
      return first && leadingLiteral(first) !== null ? match("codegen.timer", g.r, node) : null;
    }
  }
};
