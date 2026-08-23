import type { AnyNode, Node, ParsedFile } from "./ast.js";
import { positionAt } from "./ast.js";
import type { CapabilityUse, Origin } from "./capability.js";
import { walk } from "./walk.js";
import { analyzeScopes } from "./scope.js";
import { AMBIGUOUS, FOLDED, FREE } from "./annotations.js";
import { isFoldedMember } from "./recognizers/resolve.js";
import { suppressions, isSuppressed } from "./suppress.js";
import type { Recognizer } from "./recognizers/types.js";
import { storage } from "./recognizers/storage.js";
import { network } from "./recognizers/network.js";
import { codegen } from "./recognizers/codegen.js";
import { domEscape } from "./recognizers/dom-escape.js";
import { identity } from "./recognizers/identity.js";
import { navigation } from "./recognizers/navigation.js";
import { globals } from "./recognizers/globals.js";
import { worker } from "./recognizers/worker.js";
import { device } from "./recognizers/device.js";

/** One recognizer per capability family. */
const RECOGNIZERS: readonly Recognizer[] = [
  storage,
  network,
  codegen,
  domEscape,
  identity,
  navigation,
  globals,
  worker,
  device,
];

export interface ExtractOptions {
  /** Where the file came from; stamped on every use. Defaults to first-party. */
  origin?: Origin;
}

/** Run every recognizer over every node and return the flat list of uses. */
export function extract(parsed: ParsedFile, opts: ExtractOptions = {}): CapabilityUse[] {
  const origin = opts.origin ?? "first-party";
  annotate(parsed.program);
  const ignores = suppressions(parsed);
  const out: CapabilityUse[] = [];
  walk(parsed.program, (visit) => {
    for (const recognize of RECOGNIZERS) {
      const m = recognize(visit);
      if (!m) continue;
      // The identifier the match rests on must be a free reference, i.e. the
      // global. A local of the same name is not a use of the capability at
      // all. Inside `with` nothing resolves, so the use is only possible.
      let confidence = m.confidence;
      if (m.via !== null) {
        const via = m.via as AnyNode;
        if (via[AMBIGUOUS]) confidence = "possible";
        else if (!via[FREE]) continue;
      }
      if (isFoldedMember(m.node as AnyNode) && confidence === "certain") confidence = "probable";
      const expr = enclosingExpression(m.node, visit.ancestors);
      const pos = positionAt(parsed.lines, expr.start);
      out.push({
        capability: m.capability,
        target: m.target,
        file: parsed.file,
        line: pos.line,
        column: pos.column,
        expression: parsed.source.slice(expr.start, expr.end),
        confidence,
        origin,
        suppressed: isSuppressed(ignores.get(pos.line), m.capability),
      });
    }
  });
  return out;
}

/** Every string literal and template chunk in the program, for leads like hosts named in strings. */
export function stringLiterals(parsed: ParsedFile): string[] {
  const out: string[] = [];
  walk(parsed.program, ({ node }) => {
    const n = node as AnyNode;
    if (n.type === "Literal" && typeof n["value"] === "string") out.push(n["value"]);
    else if (n.type === "TemplateElement") {
      const cooked = (n["value"] as { cooked?: string } | undefined)?.cooked;
      if (typeof cooked === "string") out.push(cooked);
    }
  });
  return out;
}

/** Run the scope analysis and write its answers onto the identifier nodes for the recognizers to read. */
function annotate(program: Node): void {
  const info = analyzeScopes(program);
  for (const n of info.free) (n as AnyNode)[FREE] = true;
  for (const n of info.ambiguous) (n as AnyNode)[AMBIGUOUS] = true;
  for (const [n, v] of info.constants) (n as AnyNode)[FOLDED] = v;
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
