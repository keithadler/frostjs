import type { Node } from "../ast.js";
import type { Recognizer, Match } from "./types.js";
import { asGlobalObject, asNamedGlobal, isIdentifier, memberName, type Resolved } from "./globals.js";
import { resolveTargetOf } from "../target.js";

type AnyNode = Node & Record<string, unknown>;

const WORKER_GLOBALS: ReadonlyMap<string, string> = new Map([
  ["Worker", "worker.dedicated"],
  ["SharedWorker", "worker.shared"],
]);

const WORKLETS: ReadonlySet<string> = new Set(["paintWorklet", "audioWorklet", "animationWorklet", "layoutWorklet"]);

/**
 * Code that runs off the main thread or intercepts requests. A service
 * worker has the largest blast radius of anything here: once registered it
 * sees every future request from the origin.
 */
export const worker: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;
  const parent = ancestors[0] as AnyNode | undefined;
  const calledHere =
    parent !== undefined &&
    (parent.type === "CallExpression" || parent.type === "NewExpression") &&
    parent["callee"] === node;
  const args = calledHere ? (parent!["arguments"] as AnyNode[]) : [];

  // Worker, SharedWorker: bare or via the global object.
  let name: string | null = null;
  let r: Resolved | null = null;
  if (isIdentifier(n)) {
    name = n.name;
    r = { confidence: "certain", via: n.name };
  } else if (n.type === "MemberExpression") {
    const prop = memberName(n);
    const obj = n["object"] as AnyNode;
    if (prop !== null && WORKER_GLOBALS.has(prop)) {
      name = prop;
      r = asGlobalObject(obj);
    } else if (
      prop === "register" &&
      calledHere &&
      obj.type === "MemberExpression" &&
      memberName(obj) === "serviceWorker"
    ) {
      const nav = asNamedGlobal(obj["object"] as AnyNode, "navigator");
      if (nav) return hit("worker.service", nav, node, resolveTargetOf(args[0]));
    } else if (prop === "addModule" && calledHere && obj.type === "MemberExpression") {
      const worklet = memberName(obj);
      if (worklet !== null && WORKLETS.has(worklet)) {
        return hit("worker.worklet", { confidence: "certain", via: "" }, node, resolveTargetOf(args[0]));
      }
    }
  }
  if (name === null || r === null) return null;
  const cap = WORKER_GLOBALS.get(name);
  if (!cap) return null;
  return hit(cap, r, node, calledHere ? resolveTargetOf(args[0]) : null);
};

function hit(capability: string, r: Resolved, node: Node, target: Match["target"]): Match {
  return { capability, target, confidence: r.confidence, via: r.via, node };
}
