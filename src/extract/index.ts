import type { Node, ParsedFile } from "./ast.js";
import { positionAt } from "./ast.js";
import type { CapabilityUse, Origin } from "./capability.js";
import { walk } from "./walk.js";
import type { Recognizer } from "./recognizers/types.js";
import { storage } from "./recognizers/storage.js";

export type { CapabilityUse } from "./capability.js";

/** One recognizer per capability family. Phase C adds the rest. */
export const RECOGNIZERS: readonly Recognizer[] = [storage];

export interface ExtractOptions {
  origin?: Origin;
}

type AnyNode = Node & Record<string, unknown>;

/** Run every recognizer over every node and return the flat list of uses. */
export function extract(parsed: ParsedFile, opts: ExtractOptions = {}): CapabilityUse[] {
  const origin = opts.origin ?? "first-party";
  const declared = declaredNames(parsed.program);
  const out: CapabilityUse[] = [];
  walk(parsed.program, (visit) => {
    for (const recognize of RECOGNIZERS) {
      const m = recognize(visit);
      if (!m) continue;
      const expr = enclosingExpression(m.node, visit.ancestors);
      const pos = positionAt(parsed.lines, expr.start);
      out.push({
        capability: m.capability,
        target: m.target,
        file: parsed.file,
        line: pos.line,
        column: pos.column,
        expression: parsed.source.slice(expr.start, expr.end),
        // Interim shadowing check until Phase D scope analysis: if this file
        // declares the name the match rests on, we cannot tell whether the
        // reference is the global or the local, so it is only `possible`.
        confidence: declared.has(m.via) ? "possible" : m.confidence,
        origin,
      });
    }
  });
  return out;
}

/** Every name bound anywhere in the file: declarations, params, patterns, imports. */
function declaredNames(program: Node): Set<string> {
  const names = new Set<string>();
  walk(program, ({ node, binding }) => {
    if (binding && (node as AnyNode).type === "Identifier") {
      names.add((node as AnyNode)["name"] as string);
    }
  });
  return names;
}

/**
 * Grow outward from the matched node through the member/call chain it heads,
 * so `localStorage` inside `localStorage.getItem('k').trim()` reports the
 * whole chain.
 */
function enclosingExpression(node: Node, ancestors: readonly Node[]): Node {
  let current = node as AnyNode;
  for (const parent of ancestors as AnyNode[]) {
    const continues =
      (parent.type === "MemberExpression" && parent["object"] === current) ||
      (parent.type === "CallExpression" && parent["callee"] === current) ||
      (parent.type === "NewExpression" && parent["callee"] === current) ||
      (parent.type === "ChainExpression" && parent["expression"] === current);
    if (!continues) break;
    current = parent;
  }
  return current;
}
