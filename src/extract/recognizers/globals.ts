import type { AnyNode } from "../ast.js";
import { callArgs, match, type Recognizer, type Resolved } from "./types.js";
import { asGlobalObject, isIdentifier, memberName } from "./resolve.js";

/** Built-in constructors and namespaces whose mutation affects every script on the page. */
const BUILTINS: ReadonlySet<string> = new Set([
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Function",
  "Symbol",
  "BigInt",
  "Date",
  "RegExp",
  "Error",
  "Promise",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "Math",
  "JSON",
  "Reflect",
  "Proxy",
  "Intl",
  "ArrayBuffer",
  "DataView",
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "Uint8ClampedArray",
  "EventTarget",
  "Event",
  "Node",
  "Element",
  "HTMLElement",
  "Document",
  "Window",
  "Text",
  "CharacterData",
  "DocumentFragment",
  "ShadowRoot",
  "HTMLCollection",
  "NodeList",
  "Navigator",
  "Storage",
  "Location",
  "History",
  "XMLHttpRequest",
  "Response",
  "Request",
  "Headers",
  "URL",
]);

const MUTATORS: ReadonlySet<string> = new Set(["defineProperty", "defineProperties", "assign", "setPrototypeOf"]);

/** `<Builtin>` or `<Builtin>.prototype`, as a resolved reference. */
function asBuiltinSurface(n: AnyNode): Resolved | null {
  if (isIdentifier(n) && BUILTINS.has(n.name)) return { confidence: "certain", via: n };
  if (n.type === "MemberExpression" && memberName(n) === "prototype") {
    const obj = n["object"] as AnyNode;
    if (isIdentifier(obj) && BUILTINS.has(obj.name)) return { confidence: "certain", via: obj };
  }
  return null;
}

/**
 * Mutation of shared state: properties added to the global object, and
 * built-ins or their prototypes changed. Reads are not reported, and neither
 * are window's own event-handler properties (`window.onload = f`), which
 * install a handler rather than a global.
 */
export const globals: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const parent = ancestors[0] as AnyNode | undefined;
  if (!parent) return null;

  // window.x = v, Array.prototype.x = v, Array.from = v
  if (parent.type === "AssignmentExpression" && parent["left"] === node && n.type === "MemberExpression") {
    const prop = memberName(n);
    const obj = n["object"] as AnyNode;
    const g = asGlobalObject(obj);
    if (g) {
      if (prop !== null && (prop === "location" || prop.startsWith("on"))) return null;
      return match("globals.window", g, parent);
    }
    if (prop === "prototype") return null; // Foo.prototype = {...} replaces a whole prototype; not a mutation of a built-in
    const b = asBuiltinSurface(obj);
    if (b) return match("globals.prototype", b, parent);
    return null;
  }

  // Object.defineProperty(window, ...), Object.assign(Array.prototype, ...)
  const args = callArgs(node, parent);
  if (args && n.type === "MemberExpression") {
    const prop = memberName(n);
    if (prop === null || !MUTATORS.has(prop) || !isIdentifier(n["object"], "Object")) return null;
    const first = args[0];
    if (!first) return null;
    const g = asGlobalObject(first);
    if (g) return match("globals.window", g, node);
    const b = asBuiltinSurface(first);
    if (b) return match("globals.prototype", b, node);
  }
  return null;
};
