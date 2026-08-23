import type { Node } from "../ast.js";
import type { Recognizer } from "./types.js";
import { asNamedGlobal, memberName } from "./globals.js";

type AnyNode = Node & Record<string, unknown>;

/** navigator members that identify the device, user, or their surroundings. */
const NAVIGATOR: ReadonlyMap<string, string> = new Map([
  ["userAgent", "identity.device"],
  ["userAgentData", "identity.device"],
  ["platform", "identity.device"],
  ["vendor", "identity.device"],
  ["appVersion", "identity.device"],
  ["appName", "identity.device"],
  ["oscpu", "identity.device"],
  ["hardwareConcurrency", "identity.device"],
  ["deviceMemory", "identity.device"],
  ["plugins", "identity.device"],
  ["mimeTypes", "identity.device"],
  ["geolocation", "identity.geolocation"],
  ["mediaDevices", "identity.media"],
  ["getUserMedia", "identity.media"],
  ["webkitGetUserMedia", "identity.media"],
  ["mozGetUserMedia", "identity.media"],
  ["clipboard", "identity.clipboard"],
  ["credentials", "identity.credentials"],
  ["permissions", "identity.permissions"],
]);

const CLIPBOARD_COMMANDS: ReadonlySet<string> = new Set(["copy", "cut", "paste"]);

/**
 * Identity and fingerprinting surfaces reached through `navigator`, plus
 * the legacy clipboard path through document.execCommand. Canvas and audio
 * fingerprinting are deliberately not recognized: every charting and 3D
 * library draws to canvases, and no static signature separates that from
 * fingerprinting without false positives.
 */
export const identity: Recognizer = ({ node, ancestors, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;

  // const { userAgent, clipboard } = navigator
  if (n.type === "VariableDeclarator" || n.type === "AssignmentExpression") {
    const pattern = (n.type === "VariableDeclarator" ? n["id"] : n["left"]) as AnyNode;
    const source = (n.type === "VariableDeclarator" ? n["init"] : n["right"]) as AnyNode | null;
    if (!source || pattern.type !== "ObjectPattern") return null;
    const r = asNamedGlobal(source, "navigator");
    if (!r) return null;
    for (const p of pattern["properties"] as AnyNode[]) {
      if (p.type !== "Property" || p["computed"] === true) continue;
      const key = p["key"] as AnyNode;
      const name =
        key.type === "Identifier" ? (key["name"] as string) : key.type === "Literal" ? String(key["value"]) : null;
      const cap = name === null ? undefined : NAVIGATOR.get(name);
      // One match per declarator is enough to name the capability; report the first.
      if (cap) return { capability: cap, target: null, confidence: r.confidence, via: r.via, node };
    }
    return null;
  }

  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null) return null;
  const obj = n["object"] as AnyNode;

  const cap = NAVIGATOR.get(prop);
  if (cap) {
    const r = asNamedGlobal(obj, "navigator");
    return r ? { capability: cap, target: null, confidence: r.confidence, via: r.via, node } : null;
  }

  if (prop === "execCommand") {
    const parent = ancestors[0] as AnyNode | undefined;
    if (!parent || parent.type !== "CallExpression" || parent["callee"] !== node) return null;
    const first = (parent["arguments"] as AnyNode[])[0];
    const cmd = first?.type === "Literal" && typeof first["value"] === "string" ? first["value"].toLowerCase() : null;
    if (cmd === null || !CLIPBOARD_COMMANDS.has(cmd)) return null;
    const d = asNamedGlobal(obj, "document");
    return d ? { capability: "identity.clipboard", target: null, confidence: d.confidence, via: d.via, node } : null;
  }
  return null;
};
