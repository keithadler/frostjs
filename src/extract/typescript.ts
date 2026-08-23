/**
 * What TypeScript and JSX add to the tree, and how the walkers treat it.
 * Type positions are never references: nothing in a type annotation runs.
 * `declare` statements describe globals rather than create bindings. JSX
 * element and attribute names are not identifiers.
 */
import type { AnyNode } from "./ast.js";

const TYPE_LEVEL: ReadonlySet<string> = new Set([
  "TSTypeAnnotation",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSImportType",
  "TSIndexSignature",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSAbstractAccessorProperty",
  "TSInterfaceBody",
  "TSInterfaceHeritage",
  "TSClassImplements",
  "TSExportAssignment",
  "TSNamespaceExportDeclaration",
]);

/** True for a subtree that contributes no runtime code: types, signatures, `declare`, `import type`. */
export function isTypeOnly(node: AnyNode): boolean {
  const t = node.type;
  if (t.startsWith("TSType") || TYPE_LEVEL.has(t)) return true;
  if (node["declare"] === true) return true;
  if (
    (t === "ImportDeclaration" || t === "ExportNamedDeclaration" || t === "ExportAllDeclaration") &&
    node["exportKind"] === "type"
  )
    return true;
  if (t === "ImportDeclaration" && node["importKind"] === "type") return true;
  if (
    (t === "ImportSpecifier" || t === "ExportSpecifier") &&
    (node["importKind"] === "type" || node["exportKind"] === "type")
  )
    return true;
  return false;
}

/** Expression wrappers TypeScript adds around a value: the value is the `expression` child. */
const VALUE_WRAPPERS: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "ParenthesizedExpression",
]);

/** Strip `as`, `!`, `satisfies`, parentheses and the like. */
export function unwrap(node: AnyNode): AnyNode {
  let n = node;
  while (VALUE_WRAPPERS.has(n.type)) n = n["expression"] as AnyNode;
  return n;
}
