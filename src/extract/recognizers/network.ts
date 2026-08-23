import type { Node } from "../ast.js";
import type { Recognizer, Match } from "./types.js";
import { asGlobalObject, asNamedGlobal, isIdentifier, memberName, type Resolved } from "./globals.js";
import { resolveTargetOf } from "../target.js";

type AnyNode = Node & Record<string, unknown>;

/** Globals that are network entry points. Target comes from the first call argument. */
const NETWORK_GLOBALS: ReadonlyMap<string, string> = new Map([
  ["fetch", "network.fetch"],
  ["XMLHttpRequest", "network.xhr"],
  ["WebSocket", "network.websocket"],
  ["EventSource", "network.eventsource"],
]);

export const network: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;

  // Dynamic import is a network use only when it can reach another host:
  // an absolute URL, or an expression whose destination cannot be fixed.
  // Relative paths (code splitting) and bare specifiers ("lodash", "node:fs")
  // resolve through the bundler or import map, not the network.
  if (n.type === "ImportExpression") {
    const target = resolveTargetOf(n["source"] as AnyNode, "specifier");
    if (target === "same-origin" || target === "bare") return null;
    return { capability: "network.import", target, confidence: "certain", via: null, node };
  }

  // fetch, XMLHttpRequest, WebSocket, EventSource: bare or via the global object.
  let name: string | null = null;
  let resolved: Resolved | null = null;
  if (isIdentifier(n)) {
    name = n.name;
    resolved = { confidence: "certain", via: n };
  } else if (n.type === "MemberExpression") {
    const prop = memberName(n);
    const obj = n["object"] as AnyNode;
    if (prop !== null && NETWORK_GLOBALS.has(prop)) {
      name = prop;
      resolved = asGlobalObject(obj);
    } else if (prop === "sendBeacon") {
      const r = asNamedGlobal(obj, "navigator");
      return r
        ? {
            capability: "network.beacon",
            target: firstArgTarget(node, ancestors),
            confidence: r.confidence,
            via: r.via,
            node,
          }
        : null;
    }
  }
  if (name === null || resolved === null) return null;
  const cap = NETWORK_GLOBALS.get(name);
  if (!cap) return null;
  return {
    capability: cap,
    target: firstArgTarget(node, ancestors),
    confidence: resolved.confidence,
    via: resolved.via,
    node,
  };
};

/** If the node is the callee of a call or `new`, resolve the first argument's destination. */
function firstArgTarget(node: Node, ancestors: readonly Node[]): Match["target"] {
  const parent = ancestors[0] as AnyNode | undefined;
  if (!parent) return null;
  if ((parent.type === "CallExpression" || parent.type === "NewExpression") && parent["callee"] === node) {
    const args = parent["arguments"] as AnyNode[];
    return resolveTargetOf(args[0]);
  }
  return null;
}
