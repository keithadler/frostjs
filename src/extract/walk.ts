import type { Node } from "./ast.js";

export interface Visit {
  node: Node;
  /** Nearest ancestor first. */
  ancestors: readonly Node[];
  /** True when this node is (inside) a binding position: a declared name, parameter, pattern, or import. */
  binding: boolean;
}

type AnyNode = Node & Record<string, unknown>;

const isNode = (v: unknown): v is AnyNode =>
  typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

/**
 * Child keys that introduce bindings rather than references. An Identifier
 * reached through one of these keys names something; it does not use it.
 */
const BINDING_KEYS: Record<string, ReadonlySet<string>> = {
  VariableDeclarator: new Set(["id"]),
  FunctionDeclaration: new Set(["id", "params"]),
  FunctionExpression: new Set(["id", "params"]),
  ArrowFunctionExpression: new Set(["params"]),
  ClassDeclaration: new Set(["id"]),
  ClassExpression: new Set(["id"]),
  CatchClause: new Set(["param"]),
  ImportSpecifier: new Set(["local", "imported"]),
  ImportDefaultSpecifier: new Set(["local"]),
  ImportNamespaceSpecifier: new Set(["local"]),
  ExportSpecifier: new Set(["exported"]),
  LabeledStatement: new Set(["label"]),
  BreakStatement: new Set(["label"]),
  ContinueStatement: new Set(["label"]),
};

/** Non-computed keys are names, not references, under these parents. */
const NAME_KEYS: Record<string, string> = {
  MemberExpression: "property",
  Property: "key",
  MethodDefinition: "key",
  PropertyDefinition: "key",
  AccessorProperty: "key",
};

export function walk(root: Node, visit: (v: Visit) => void): void {
  const ancestors: Node[] = [];
  const go = (node: AnyNode, binding: boolean): void => {
    visit({ node, ancestors, binding });
    ancestors.unshift(node);
    const bindingKeys = BINDING_KEYS[node.type];
    const nameKey = NAME_KEYS[node.type];
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const value = node[key];
      const childBinding = binding || (bindingKeys?.has(key) ?? false);
      // A non-computed property name is never a reference; skip it outright.
      if (key === nameKey && node["computed"] !== true && isNode(value) && value.type === "Identifier") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) go(item, childBinding);
      } else if (isNode(value)) {
        go(value, childBinding);
      }
    }
    ancestors.shift();
  };
  go(root as AnyNode, false);
}
