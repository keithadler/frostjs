import type { AnyNode } from "../ast.js";
import { callArgs, match, type Recognizer } from "./types.js";
import { asGlobalIn, asNamedGlobal, memberName } from "./resolve.js";
import { resolveTargetOf } from "../target.js";

const WORKER_GLOBALS: ReadonlyMap<string, string> = new Map([
  ["Worker", "worker.dedicated"],
  ["SharedWorker", "worker.shared"],
]);
const WORKER_NAMES: ReadonlySet<string> = new Set(WORKER_GLOBALS.keys());
const WORKLETS: ReadonlySet<string> = new Set(["paintWorklet", "audioWorklet", "animationWorklet", "layoutWorklet"]);

/**
 * Code that runs off the main thread or intercepts requests: Worker and
 * SharedWorker (bare or via the global object, target from the script
 * URL), navigator.serviceWorker.register, and worklet addModule. A service
 * worker has the largest blast radius of anything here: once registered it
 * sees every future request from the origin. Reading serviceWorker state
 * is not a use.
 */
export const worker: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const args = callArgs(node, ancestors[0] as AnyNode | undefined, true);
  const firstArg = (): string | null => resolveTargetOf(args?.[0]);

  const g = asGlobalIn(n, WORKER_NAMES);
  if (g) return match(WORKER_GLOBALS.get(g.name)!, g.r, node, args ? firstArg() : null);

  if (n.type !== "MemberExpression" || !args) return null;
  const prop = memberName(n);
  const obj = n["object"] as AnyNode;
  if (prop === "register" && obj.type === "MemberExpression" && memberName(obj) === "serviceWorker") {
    const r = asNamedGlobal(obj["object"] as AnyNode, "navigator");
    if (r) return match("worker.service", r, node, firstArg());
  }
  if (prop === "addModule" && obj.type === "MemberExpression" && WORKLETS.has(memberName(obj) ?? "")) {
    return { capability: "worker.worklet", target: firstArg(), confidence: "certain", via: null, node };
  }
  return null;
};
