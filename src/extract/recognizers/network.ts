import type { AnyNode } from "../ast.js";
import { callArgs, match, plain, type Recognizer } from "./types.js";
import { asGlobalIn, asNamedGlobal, memberName } from "./resolve.js";
import { resolveTargetOf } from "../target.js";

/** Globals that are network entry points. The target comes from the first call argument. */
const NETWORK_GLOBALS: ReadonlyMap<string, string> = new Map([
  ["fetch", "network.fetch"],
  ["XMLHttpRequest", "network.xhr"],
  ["WebSocket", "network.websocket"],
  ["EventSource", "network.eventsource"],
]);
const NETWORK_NAMES: ReadonlySet<string> = new Set(NETWORK_GLOBALS.keys());

/**
 * Ways code reaches another host: fetch, XMLHttpRequest, WebSocket,
 * EventSource, navigator.sendBeacon, and dynamic import() of an absolute
 * URL or an expression whose destination cannot be fixed. import() of a
 * relative path (code splitting) or a bare specifier ("lodash", "node:fs")
 * resolves through the bundler or import map, not the network, and is not
 * reported.
 */
export const network: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const parent = ancestors[0] as AnyNode | undefined;
  const firstArg = (): string | null => resolveTargetOf(callArgs(node, parent, true)?.[0]);

  if (n.type === "ImportExpression") {
    const target = resolveTargetOf(n["source"] as AnyNode, "specifier");
    if (target === "same-origin" || target === "bare") return null;
    return plain("network.import", node, target);
  }

  const g = asGlobalIn(n, NETWORK_NAMES);
  if (g) return match(NETWORK_GLOBALS.get(g.name)!, g.r, node, firstArg());

  if (n.type === "MemberExpression" && memberName(n) === "sendBeacon") {
    const r = asNamedGlobal(n["object"] as AnyNode, "navigator");
    return r ? match("network.beacon", r, node, firstArg()) : null;
  }
  return null;
};
