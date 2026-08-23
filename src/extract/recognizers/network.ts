import type { AnyNode } from "../ast.js";
import { callArgs, match, plain, type Recognizer } from "./types.js";
import { asGlobalIn, asGlobalObject, asNamedGlobal, isIdentifier, memberName } from "./resolve.js";
import { resolveTargetOf, SAME_ORIGIN } from "../target.js";

/** Globals that are network entry points. The target comes from the first call argument. */
const NETWORK_GLOBALS: ReadonlyMap<string, string> = new Map([
  ["fetch", "network.fetch"],
  ["XMLHttpRequest", "network.xhr"],
  ["WebSocket", "network.websocket"],
  ["EventSource", "network.eventsource"],
  ["WebTransport", "network.webtransport"],
  ["RTCPeerConnection", "network.webrtc"],
  ["webkitRTCPeerConnection", "network.webrtc"],
  ["mozRTCPeerConnection", "network.webrtc"],
]);
const NETWORK_NAMES: ReadonlySet<string> = new Set(NETWORK_GLOBALS.keys());
const IMPORT_SCRIPTS = "importScripts";

/**
 * Ways code reaches another host: fetch, XMLHttpRequest, WebSocket,
 * EventSource, navigator.sendBeacon, importScripts() (which loads and runs
 * a script in a worker), and dynamic import() of an absolute URL or an
 * expression whose destination cannot be fixed. import() of a
 * relative path (code splitting) or a bare specifier ("lodash", "node:fs")
 * resolves through the bundler or import map, not the network, and is not
 * reported.
 *
 * Also `network.resource`: an element's `src` set to another host
 * (`script.src = "https://cdn..."`, `setAttribute("src", ...)`), when the
 * URL is a literal or a folded const. The element is not checked; what
 * matters is the host. A value that cannot be read is not reported: `.src`
 * is set on tokens and props as often as on elements, and a list of
 * "unknown" lines nobody can act on is noise.
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

  // importScripts("https://...") / self.importScripts(...): loads and runs a script in a worker.
  if (callArgs(node, parent)) {
    if (isIdentifier(n, IMPORT_SCRIPTS)) {
      return { capability: "network.importscripts", target: firstArg(), confidence: "certain", via: n, node };
    }
    if (n.type === "MemberExpression" && memberName(n) === IMPORT_SCRIPTS) {
      const r = asGlobalObject(n["object"] as AnyNode);
      if (r) return match("network.importscripts", r, node, firstArg());
    }
  }

  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === "sendBeacon") {
    const r = asNamedGlobal(n["object"] as AnyNode, "navigator");
    return r ? match("network.beacon", r, node, firstArg()) : null;
  }

  // el.src = url; el.setAttribute("src", url)
  let value: AnyNode | undefined;
  let anchor: AnyNode = n;
  if (prop === "src" && parent?.type === "AssignmentExpression" && parent["left"] === node) {
    value = parent["right"] as AnyNode;
    anchor = parent;
  } else if (prop === "setAttribute") {
    const args = callArgs(node, parent);
    if (args && args[0]?.type === "Literal" && args[0]["value"] === "src") value = args[1];
  }
  if (value === undefined) return null;
  // URL.createObjectURL(...) is a blob by construction.
  if (value.type === "CallExpression" && memberName(value["callee"] as AnyNode) === "createObjectURL") return null;
  const target = resolveTargetOf(value);
  if (target === null || target === SAME_ORIGIN || target === "bare" || target === "data:" || target === "blob:")
    return null;
  return { capability: "network.resource", target, confidence: "certain", via: null, node: anchor };
};
