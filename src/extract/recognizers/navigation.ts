import type { AnyNode } from "../ast.js";
import { callArgs, match, type Recognizer, type Resolved } from "./types.js";
import { asGlobalObject, asNamedGlobal, isIdentifier, memberName } from "./resolve.js";
import { resolveTargetOf, SAME_ORIGIN } from "../target.js";

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

/** A window-to-window origin argument: "*" stays "*", anything else resolves like a URL. */
function originTarget(origin: AnyNode): string | null {
  return origin.type === "Literal" && origin["value"] === "*" ? "*" : resolveTargetOf(origin);
}

/**
 * Moving the user or another window: assignment to `location` or its
 * navigating members (reads and `hash` are not navigation),
 * `location.assign/replace/reload`, `window.open`, the history methods, and
 * `postMessage` when the receiver is another window (parent, top, opener,
 * contentWindow) or a string origin is given. Worker and port postMessage
 * have no origin argument and stay quiet.
 */
export const navigation: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const parent = ancestors[0] as AnyNode | undefined;
  if (!parent) return null;
  const assigned = parent.type === "AssignmentExpression" && parent["left"] === node;
  const assignedTarget = (): string | null => resolveTargetOf(parent["right"] as AnyNode);
  const args = callArgs(node, parent);

  if (assigned) {
    const loc = asLocation(n);
    if (loc) return match("navigation.location", loc, parent, assignedTarget());
  }

  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null) return null;
  const obj = n["object"] as AnyNode;

  if (assigned && LOCATION_WRITES.has(prop)) {
    const loc = asLocation(obj);
    if (loc) return match("navigation.location", loc, parent, assignedTarget());
  }
  if (!args) return null;

  if (LOCATION_CALLS.has(prop)) {
    const loc = asLocation(obj);
    if (loc) return match("navigation.location", loc, node, prop === "reload" ? SAME_ORIGIN : resolveTargetOf(args[0]));
  }
  if (prop === "open") {
    const r = asGlobalObject(obj);
    if (r) return match("navigation.open", r, node, resolveTargetOf(args[0]));
  }
  if (HISTORY_CALLS.has(prop)) {
    const r = asNamedGlobal(obj, "history");
    if (r) return match("navigation.history", r, node);
  }
  if (prop === "postMessage") {
    const receiver = isIdentifier(obj) ? obj.name : memberName(obj);
    const origin = args[1];
    const originIsString =
      origin !== undefined &&
      (origin.type === "Literal" ? typeof origin["value"] === "string" : origin.type === "TemplateLiteral");
    const originIsOptions = origin?.type === "ObjectExpression";
    if ((receiver !== null && WINDOW_RECEIVERS.has(receiver)) || originIsString || originIsOptions) {
      const via = isIdentifier(obj) && WINDOW_RECEIVERS.has(obj.name) ? obj : null;
      return {
        capability: "navigation.postmessage",
        target: originIsString ? originTarget(origin) : null,
        confidence: "certain",
        via,
        node,
      };
    }
  }
  return null;
};
