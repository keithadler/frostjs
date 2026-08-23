import type { Node } from "../ast.js";
import type { Recognizer, Match } from "./types.js";
import { asGlobalObject, asNamedGlobal, isIdentifier, memberName, type Resolved } from "./globals.js";
import { resolveTargetOf } from "../target.js";

type AnyNode = Node & Record<string, unknown>;

/** location members whose assignment navigates. `hash` stays on the document and is left out. */
const LOCATION_WRITES: ReadonlySet<string> = new Set([
  "href",
  "search",
  "pathname",
  "protocol",
  "host",
  "hostname",
  "port",
]);
const LOCATION_CALLS: ReadonlySet<string> = new Set(["assign", "replace", "reload"]);
const HISTORY_CALLS: ReadonlySet<string> = new Set(["pushState", "replaceState", "back", "forward", "go"]);
/** Receivers that are some other window. */
const WINDOW_RECEIVERS: ReadonlySet<string> = new Set(["parent", "top", "opener", "contentWindow"]);

/** `location`, `window.location`, `document.location`. */
function asLocation(n: AnyNode): Resolved | null {
  if (isIdentifier(n, "location")) return { confidence: "certain", via: n };
  if (n.type === "MemberExpression" && memberName(n) === "location") {
    const obj = n["object"] as AnyNode;
    return asGlobalObject(obj) ?? asNamedGlobal(obj, "document");
  }
  return null;
}

export const navigation: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const parent = ancestors[0] as AnyNode | undefined;
  if (!parent) return null;
  const assignedHere = parent.type === "AssignmentExpression" && parent["left"] === node;
  const calledHere = parent.type === "CallExpression" && parent["callee"] === node;
  const args = calledHere ? (parent["arguments"] as AnyNode[]) : [];

  // location = x, window.location = x
  if (assignedHere) {
    const loc = asLocation(n);
    if (loc) return hit("navigation.location", loc, parent, resolveTargetOf(parent["right"] as AnyNode));
  }

  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null) return null;
  const obj = n["object"] as AnyNode;

  // location.href = x; location.assign(x)
  if (assignedHere && LOCATION_WRITES.has(prop)) {
    const loc = asLocation(obj);
    if (loc) return hit("navigation.location", loc, parent, resolveTargetOf(parent["right"] as AnyNode));
  }
  if (calledHere && LOCATION_CALLS.has(prop)) {
    const loc = asLocation(obj);
    if (loc) return hit("navigation.location", loc, node, prop === "reload" ? "same-origin" : resolveTargetOf(args[0]));
  }

  // window.open(url)
  if (calledHere && prop === "open") {
    const g = asGlobalObject(obj);
    if (g) return hit("navigation.open", g, node, resolveTargetOf(args[0]));
  }

  // history.pushState(...)
  if (calledHere && HISTORY_CALLS.has(prop)) {
    const h = asNamedGlobal(obj, "history");
    if (h) return hit("navigation.history", h, node, null);
  }

  // somewindow.postMessage(data, origin)
  if (calledHere && prop === "postMessage") {
    const receiver = isIdentifier(obj) ? obj.name : memberName(obj);
    const origin = args[1];
    const originIsString =
      origin !== undefined &&
      (origin.type === "Literal" ? typeof origin["value"] === "string" : origin.type === "TemplateLiteral");
    const originIsOptions = origin?.type === "ObjectExpression";
    if ((receiver !== null && WINDOW_RECEIVERS.has(receiver)) || originIsString || originIsOptions) {
      const target = originIsString ? originTarget(origin) : null;
      const via = isIdentifier(obj) && WINDOW_RECEIVERS.has(obj.name) ? obj : null;
      return { capability: "navigation.postmessage", target, confidence: "certain", via, node };
    }
  }
  return null;
};

function originTarget(origin: AnyNode): string | null {
  if (origin.type === "Literal" && origin["value"] === "*") return "*";
  return resolveTargetOf(origin);
}

function hit(capability: string, r: Resolved, node: Node, target: Match["target"]): Match {
  return { capability, target, confidence: r.confidence, via: r.via, node };
}
