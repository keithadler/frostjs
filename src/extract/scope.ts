/**
 * Lexical scope analysis. Answers one question for every identifier in
 * reference position: does it resolve to a local binding, or is it free
 * (and therefore a reference to a global)? Also folds `const k = "..."`
 * so that `window[k]` can be recognized.
 *
 * Hoisting is honoured: `var` and function declarations bind for their
 * whole function, `let`/`const`/`class` for their whole block, regardless
 * of where the reference sits. A reference inside `with` is unresolvable
 * and is reported as ambiguous.
 */
import type { Node } from "./ast.js";

type AnyNode = Node & Record<string, unknown>;

export interface ScopeInfo {
  /** Reference-position identifiers that resolve to no local binding. */
  free: ReadonlySet<Node>;
  /** Reference-position identifiers inside a `with` block. */
  ambiguous: ReadonlySet<Node>;
  /** Reference-position identifiers bound by `const x = "literal"`, with the literal. */
  constants: ReadonlyMap<Node, string>;
}

type BindingKind = "var" | "let" | "const" | "function" | "class" | "param" | "import" | "catch";

interface Binding {
  kind: BindingKind;
  /** For const declarators: the initializer, to fold string literals. */
  init: AnyNode | null;
}

class Scope {
  readonly names = new Map<string, Binding>();
  constructor(
    readonly parent: Scope | null,
    readonly isFunction: boolean,
  ) {}

  declare(name: string, binding: Binding): void {
    // First declaration wins for folding purposes; a second declaration of the
    // same name in one scope is either a var re-declaration or an error anyway.
    if (!this.names.has(name)) this.names.set(name, binding);
    else this.names.set(name, { kind: binding.kind, init: null });
  }

  nearestFunction(): Scope {
    let s: Scope = this;
    while (!s.isFunction && s.parent) s = s.parent;
    return s;
  }

  resolve(name: string): Binding | null {
    let s: Scope | null = this;
    while (s) {
      const b = s.names.get(name);
      if (b) return b;
      s = s.parent;
    }
    return null;
  }
}

interface Ref {
  node: AnyNode;
  scope: Scope;
  ambiguous: boolean;
}

const isNode = (v: unknown): v is AnyNode =>
  typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

export function analyzeScopes(program: Node): ScopeInfo {
  const refs: Ref[] = [];
  const root = new Scope(null, true);

  const visit = (node: AnyNode, scope: Scope, ambiguous: boolean): void => {
    switch (node.type) {
      case "Identifier":
        refs.push({ node, scope, ambiguous });
        return;

      case "FunctionDeclaration": {
        const id = node["id"] as AnyNode | null;
        if (id) scope.nearestFunction().declare(id["name"] as string, { kind: "function", init: null });
        visitFunction(node, new Scope(scope, true), ambiguous);
        return;
      }
      case "FunctionExpression": {
        const fn = new Scope(scope, true);
        const id = node["id"] as AnyNode | null;
        if (id) fn.declare(id["name"] as string, { kind: "function", init: null });
        visitFunction(node, fn, ambiguous);
        return;
      }
      case "ArrowFunctionExpression":
        visitFunction(node, new Scope(scope, true), ambiguous);
        return;

      case "ClassDeclaration": {
        const id = node["id"] as AnyNode | null;
        if (id) scope.declare(id["name"] as string, { kind: "class", init: null });
        visitClass(node, scope, ambiguous);
        return;
      }
      case "ClassExpression": {
        const inner = new Scope(scope, false);
        const id = node["id"] as AnyNode | null;
        if (id) inner.declare(id["name"] as string, { kind: "class", init: null });
        visitClass(node, inner, ambiguous);
        return;
      }

      case "BlockStatement":
      case "SwitchStatement":
        visitChildren(node, new Scope(scope, false), ambiguous, ["discriminant"]);
        return;
      case "StaticBlock":
        visitChildren(node, new Scope(scope, true), ambiguous);
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
        visitChildren(node, new Scope(scope, false), ambiguous);
        return;

      case "CatchClause": {
        const inner = new Scope(scope, false);
        const param = node["param"] as AnyNode | null;
        if (param) declarePattern(param, inner, "catch", null, ambiguous);
        visit(node["body"] as AnyNode, inner, ambiguous);
        return;
      }

      case "VariableDeclaration": {
        const kind = node["kind"] as string;
        const target = kind === "var" ? scope.nearestFunction() : scope;
        const bkind: BindingKind = kind === "var" ? "var" : kind === "const" ? "const" : "let";
        for (const d of node["declarations"] as AnyNode[]) {
          const init = d["init"] as AnyNode | null;
          declarePattern(d["id"] as AnyNode, target, bkind, init, ambiguous);
          if (init) visit(init, scope, ambiguous);
        }
        return;
      }

      case "ImportDeclaration":
        for (const s of node["specifiers"] as AnyNode[]) {
          root.declare((s["local"] as AnyNode)["name"] as string, { kind: "import", init: null });
        }
        return;
      case "ExportSpecifier":
        visit(node["local"] as AnyNode, scope, ambiguous);
        return;
      case "ExportAllDeclaration":
        return;

      case "WithStatement":
        visit(node["object"] as AnyNode, scope, ambiguous);
        visit(node["body"] as AnyNode, scope, true);
        return;

      case "MemberExpression":
        visit(node["object"] as AnyNode, scope, ambiguous);
        if (node["computed"] === true) visit(node["property"] as AnyNode, scope, ambiguous);
        return;

      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty":
        if (node["computed"] === true) visit(node["key"] as AnyNode, scope, ambiguous);
        if (isNode(node["value"])) visit(node["value"], scope, ambiguous);
        return;

      case "LabeledStatement":
        visit(node["body"] as AnyNode, scope, ambiguous);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;

      case "MetaProperty":
        return;

      default:
        visitChildren(node, scope, ambiguous);
    }
  };

  const visitChildren = (node: AnyNode, scope: Scope, ambiguous: boolean, first: string[] = []): void => {
    const keys = [...first, ...Object.keys(node).filter((k) => !first.includes(k))];
    for (const key of keys) {
      if (key === "type" || key === "start" || key === "end") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, scope, ambiguous);
      } else if (isNode(value)) {
        visit(value, scope, ambiguous);
      }
    }
  };

  const visitFunction = (node: AnyNode, fn: Scope, ambiguous: boolean): void => {
    for (const p of node["params"] as AnyNode[]) declarePattern(p, fn, "param", null, ambiguous);
    const body = node["body"] as AnyNode;
    // The body block shares the function scope so params and body locals can clash correctly.
    if (body.type === "BlockStatement") visitChildren(body, fn, ambiguous);
    else visit(body, fn, ambiguous);
  };

  const visitClass = (node: AnyNode, scope: Scope, ambiguous: boolean): void => {
    const sup = node["superClass"] as AnyNode | null;
    if (sup) visit(sup, scope, ambiguous);
    visit(node["body"] as AnyNode, scope, ambiguous);
  };

  /** Declare every identifier in a binding pattern; default values are expressions. */
  const declarePattern = (
    p: AnyNode,
    scope: Scope,
    kind: BindingKind,
    init: AnyNode | null,
    ambiguous: boolean,
  ): void => {
    switch (p.type) {
      case "Identifier":
        scope.declare(p["name"] as string, { kind, init });
        return;
      case "ObjectPattern":
        for (const prop of p["properties"] as AnyNode[]) {
          if (prop.type === "RestElement") declarePattern(prop["argument"] as AnyNode, scope, kind, null, ambiguous);
          else {
            if (prop["computed"] === true) visit(prop["key"] as AnyNode, scope, ambiguous);
            declarePattern(prop["value"] as AnyNode, scope, kind, null, ambiguous);
          }
        }
        return;
      case "ArrayPattern":
        for (const el of p["elements"] as (AnyNode | null)[]) if (el) declarePattern(el, scope, kind, null, ambiguous);
        return;
      case "AssignmentPattern":
        declarePattern(p["left"] as AnyNode, scope, kind, null, ambiguous);
        visit(p["right"] as AnyNode, scope, ambiguous);
        return;
      case "RestElement":
        declarePattern(p["argument"] as AnyNode, scope, kind, null, ambiguous);
        return;
      default:
        // TypeScript parameter properties and the like arrive in Phase G.
        visitChildren(p, scope, ambiguous);
    }
  };

  visitChildren(program as AnyNode, root, false);

  const free = new Set<Node>();
  const ambiguous = new Set<Node>();
  const constants = new Map<Node, string>();
  for (const ref of refs) {
    if (ref.ambiguous) {
      ambiguous.add(ref.node);
      continue;
    }
    const b = ref.scope.resolve(ref.node["name"] as string);
    if (b === null) {
      free.add(ref.node);
    } else if (b.kind === "const" && b.init) {
      const v = stringLiteral(b.init);
      if (v !== null) constants.set(ref.node, v);
    }
  }
  return { free, ambiguous, constants };
}

/** The value of a string literal or expression-free template, else null. */
export function stringLiteral(n: AnyNode): string | null {
  if (n.type === "Literal" && typeof n["value"] === "string") return n["value"];
  if (n.type === "TemplateLiteral" && (n["expressions"] as unknown[]).length === 0) {
    return ((n["quasis"] as AnyNode[])[0]?.["value"] as { cooked?: string } | undefined)?.cooked ?? null;
  }
  return null;
}
