/**
 * Bounded taint analysis: does untrusted input reach a dangerous sink?
 *
 * frostjs's recognizers say "this file can eval" or "this file reaches
 * host X". Taint answers the harder question: does a value that came from
 * an attacker-influenced source (a URL parameter, document.cookie, a
 * postMessage payload) actually flow into eval, innerHTML, importScripts,
 * a redirect, and so on. That is the difference between a capability and a
 * vulnerability, and it is what the three.js/ECSY finding was underneath:
 * `location.search` gated a path that eval'd relay data.
 *
 * The one rule that keeps this from crying wolf: **taint survives only
 * through operations that provably preserve it** - string methods, URL
 * decoding, JSON.parse, template concatenation, member access. Any other
 * function call breaks the chain, so `el.innerHTML = DOMPurify.sanitize(x)`
 * is not flagged while `el.innerHTML = x` is. Flow is followed within a
 * function (with closure inheritance and message-handler seeding) and one
 * hop across a call: a tainted argument to a local function whose parameter
 * reaches a sink. A whole call graph is not walked, and that is stated as a
 * limit rather than hidden.
 */
import { positionAt, type AnyNode, type Node, type ParsedFile } from "./ast.js";
import { analyzeScopes } from "./scope.js";
import { FOLDED, FREE } from "./annotations.js";
import { isIdentifier, memberName } from "./recognizers/resolve.js";

export interface TaintFinding {
  /** Where the value came from, e.g. "location.hash", "document.cookie", "postMessage data". */
  source: string;
  /** What it reached, e.g. "eval", "innerHTML", "importScripts". */
  sink: string;
  file: string;
  line: number;
  column: number;
  /** Source text of the sink expression. */
  expression: string;
}

/** The global objects a source can hang off. */
const GLOBALS: ReadonlySet<string> = new Set(["window", "globalThis", "self"]);
/**
 * location members that carry attacker-influenced text. Narrowed to the
 * parts an attacker actually controls (the query, fragment, full URL and
 * path); host/hostname/origin/protocol are the page's own identity and
 * are rarely an injection vector, so they are left out to protect the
 * zero-false-positive property.
 */
const LOCATION_PROPS: ReadonlySet<string> = new Set(["search", "hash", "href", "pathname"]);
/** document members that carry attacker-influenced text. */
const DOCUMENT_PROPS: ReadonlySet<string> = new Set(["URL", "documentURI", "referrer", "cookie", "baseURI"]);

/** String and URL operations that preserve taint: `t.<method>(...)` stays tainted. */
const PRESERVING_METHODS: ReadonlySet<string> = new Set([
  "replace",
  "replaceAll",
  "slice",
  "substring",
  "substr",
  "trim",
  "trimStart",
  "trimEnd",
  "toLowerCase",
  "toUpperCase",
  "toString",
  "split",
  "concat",
  "padStart",
  "padEnd",
  "normalize",
  "at",
  "charAt",
  "repeat",
  "get",
  "getAll",
  "toJSON",
]);
/** Global functions that preserve taint on their first argument. */
const PRESERVING_CALLS: ReadonlySet<string> = new Set([
  "decodeURIComponent",
  "decodeURI",
  "encodeURIComponent",
  "encodeURI",
  "atob",
  "escape",
  "unescape",
  "String",
]);

type Scope = { tainted: Set<string>; sources: Map<string, string> };

const isNode = (v: unknown): v is AnyNode =>
  typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

/** Strip TS value wrappers and parentheses. */
function unwrap(n: AnyNode): AnyNode {
  let c = n;
  while (
    c.type === "ParenthesizedExpression" ||
    c.type === "TSAsExpression" ||
    c.type === "TSNonNullExpression" ||
    c.type === "TSSatisfiesExpression" ||
    c.type === "TSTypeAssertion"
  ) {
    c = c["expression"] as AnyNode;
  }
  return c;
}

/** A free reference to one of `names`. */
function freeGlobal(n: AnyNode, names: ReadonlySet<string>): boolean {
  return isIdentifier(n) && names.has(n.name) && n[FREE] === true;
}

/** `location`, `window.location`, `document.location`, `self.location`. */
function isLocation(n: AnyNode): boolean {
  n = unwrap(n);
  if (freeGlobal(n, new Set(["location"]))) return true;
  if (n.type === "MemberExpression" && memberName(n) === "location") {
    const obj = unwrap(n["object"] as AnyNode);
    return freeGlobal(obj, GLOBALS) || freeGlobal(obj, new Set(["document"]));
  }
  return false;
}

/** A member read that is itself an untrusted source; returns a label or null. */
function sourceMember(n: AnyNode): string | null {
  if (n.type !== "MemberExpression") return null;
  const prop = memberName(n);
  if (prop === null) return null;
  const obj = unwrap(n["object"] as AnyNode);
  if (LOCATION_PROPS.has(prop) && isLocation(obj)) return `location.${prop}`;
  if (DOCUMENT_PROPS.has(prop) && freeGlobal(obj, new Set(["document"]))) return `document.${prop}`;
  if (prop === "name" && freeGlobal(obj, GLOBALS)) return "window.name";
  return null;
}

/** Does `n` evaluate to a tainted value under the current scope? Also reports which source, when asked. */
function taintSource(n: AnyNode, scope: Scope): string | null {
  n = unwrap(n);
  switch (n.type) {
    case "Identifier":
      return scope.tainted.has(n.name) ? (scope.sources.get(n.name) ?? "untrusted input") : null;
    case "MemberExpression": {
      const direct = sourceMember(n);
      if (direct) return direct;
      // t.foo / t[i]: a member of a tainted object is tainted.
      return taintSource(n["object"] as AnyNode, scope);
    }
    case "BinaryExpression":
      return n["operator"] === "+"
        ? (taintSource(n["left"] as AnyNode, scope) ?? taintSource(n["right"] as AnyNode, scope))
        : null;
    case "TemplateLiteral": {
      for (const e of n["expressions"] as AnyNode[]) {
        const s = taintSource(e, scope);
        if (s) return s;
      }
      return null;
    }
    case "ConditionalExpression":
      return taintSource(n["consequent"] as AnyNode, scope) ?? taintSource(n["alternate"] as AnyNode, scope);
    case "AwaitExpression":
    case "YieldExpression":
      return n["argument"] ? taintSource(n["argument"] as AnyNode, scope) : null;
    case "AssignmentExpression":
      return taintSource(n["right"] as AnyNode, scope);
    case "SequenceExpression": {
      const exprs = n["expressions"] as AnyNode[];
      return exprs.length ? taintSource(exprs[exprs.length - 1]!, scope) : null;
    }
    case "NewExpression":
      // new URLSearchParams(tainted) / new URL(tainted) is a tainted object.
      if (isIdentifier(n["callee"], "URLSearchParams") || isIdentifier(n["callee"], "URL")) {
        for (const a of n["arguments"] as AnyNode[]) {
          const s = taintSource(a, scope);
          if (s) return s;
        }
      }
      return null;
    case "CallExpression": {
      const callee = unwrap(n["callee"] as AnyNode);
      const args = n["arguments"] as AnyNode[];
      // preserving global call: decodeURIComponent(tainted), JSON.parse(tainted)
      if (isIdentifier(callee) && PRESERVING_CALLS.has(callee.name)) return taintSource(args[0] ?? callee, scope);
      if (callee.type === "MemberExpression") {
        const method = memberName(callee);
        const recv = callee["object"] as AnyNode;
        if (method === "parse" && isIdentifier(unwrap(recv), "JSON")) return taintSource(args[0] ?? callee, scope);
        // preserving method on a tainted receiver: location.hash.slice(1), params.get('x')
        if (method !== null && PRESERVING_METHODS.has(method)) return taintSource(recv, scope);
      }
      return null;
    }
    default:
      return null;
  }
}

/** The sinks: a tainted value here is markup, code, a remote load, or a redirect. */
function checkSinks(n: AnyNode, scope: Scope, add: (source: string, sink: string, node: AnyNode) => void): void {
  // assignment sinks: el.innerHTML = tainted, location.href = tainted, setAttribute-less
  if (n.type === "AssignmentExpression") {
    const left = unwrap(n["left"] as AnyNode);
    const right = n["right"] as AnyNode;
    if (left.type === "MemberExpression") {
      const prop = memberName(left);
      if (prop === "innerHTML" || prop === "outerHTML" || prop === "srcdoc") {
        const s = taintSource(right, scope);
        if (s) add(s, prop, n);
      }
      // location = tainted, location.href = tainted
      if ((prop !== null && LOCATION_PROPS.has(prop) && isLocation(left["object"] as AnyNode)) || isLocation(left)) {
        const s = taintSource(right, scope);
        if (s) add(s, "location (redirect)", n);
      }
    }
  }
  if (n.type === "CallExpression" || n.type === "NewExpression" || n.type === "ImportExpression") {
    const args = (n["arguments"] as AnyNode[] | undefined) ?? [];
    const src = n.type === "ImportExpression" ? n["source"] : undefined;
    const callee = n.type === "ImportExpression" ? null : unwrap(n["callee"] as AnyNode);

    const flag = (arg: AnyNode | undefined, sink: string): void => {
      if (!arg) return;
      const s = taintSource(arg, scope);
      if (s) add(s, sink, n);
    };

    if (n.type === "ImportExpression") return flag(src as AnyNode, "import()");
    if (callee === null) return;

    if (isIdentifier(callee, "eval")) return flag(args[0], "eval");
    if (isIdentifier(callee, "Function")) return flag(args[args.length - 1], "Function");
    if (isIdentifier(callee, "importScripts")) return args.forEach((a) => flag(a, "importScripts"));
    // A tainted first argument to a timer is a string, so it is the string-code
    // form (setTimeout("...", n)); a function callback is never tainted.
    if (isIdentifier(callee, "setTimeout") || isIdentifier(callee, "setInterval")) return flag(args[0], callee.name);

    if (callee.type === "MemberExpression") {
      const method = memberName(callee);
      const obj = callee["object"] as AnyNode;
      if (method === "eval") return flag(args[0], "eval");
      if ((method === "setTimeout" || method === "setInterval") && freeGlobal(unwrap(obj), GLOBALS))
        return flag(args[0], method);
      if (method === "importScripts") return args.forEach((a) => flag(a, "importScripts"));
      if (method === "insertAdjacentHTML") return flag(args[1], "insertAdjacentHTML");
      if (method === "write" || method === "writeln") return flag(args[0], "document.write");
      if (method === "setAttribute") {
        const attr = args[0];
        const name = attr?.type === "Literal" && typeof attr["value"] === "string" ? attr["value"].toLowerCase() : null;
        if (name === "srcdoc" || (name !== null && /^on[a-z]+$/.test(name))) flag(args[1], `setAttribute("${name}")`);
        return;
      }
      if ((method === "assign" || method === "replace") && isLocation(obj)) return flag(args[0], "location (redirect)");
      if (method === "open" && freeGlobal(unwrap(obj), GLOBALS)) return flag(args[0], "window.open (redirect)");
    }
  }
}

/** Statements introduced by declarations/assignments that may add taint in this scope. */
function propagate(node: AnyNode, scope: Scope): boolean {
  let changed = false;
  const bind = (name: string, init: AnyNode | null | undefined): void => {
    if (!init) return;
    const s = taintSource(init, scope);
    if (s && !scope.tainted.has(name)) {
      scope.tainted.add(name);
      scope.sources.set(name, s);
      changed = true;
    }
  };
  if (node.type === "VariableDeclarator" && (node["id"] as AnyNode).type === "Identifier") {
    bind((node["id"] as AnyNode)["name"] as string, node["init"] as AnyNode | null);
  } else if (node.type === "AssignmentExpression" && (node["left"] as AnyNode).type === "Identifier") {
    bind((node["left"] as AnyNode)["name"] as string, node["right"] as AnyNode);
  }
  return changed;
}

/** Collect every node in a function body, not descending into nested functions. */
function ownNodes(root: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
  const go = (n: AnyNode, top: boolean): void => {
    if (!top && FN.has(n.type)) return; // a nested function is its own scope
    out.push(n);
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const it of v) if (isNode(it)) go(it, false);
      } else if (isNode(v)) go(v, false);
    }
  };
  go(root, true);
  return out;
}

/** Analyze one function scope: fixpoint on taint, then scan sinks; recurse into nested functions. */
/** Local functions whose parameters reach a sink: name -> (param index -> sink). */
type SinkFns = ReadonlyMap<string, ReadonlyMap<number, string>>;
const NO_SINK_FNS: SinkFns = new Map();

function analyzeScope(
  body: AnyNode,
  inherited: Scope,
  findings: TaintFinding[],
  parsed: ParsedFile,
  seedParam: { name: string; source: string } | null,
  sinkFns: SinkFns = NO_SINK_FNS,
): void {
  const scope: Scope = { tainted: new Set(inherited.tainted), sources: new Map(inherited.sources) };
  if (seedParam) {
    scope.tainted.add(seedParam.name);
    scope.sources.set(seedParam.name, seedParam.source);
  }
  const nodes = ownNodes(body);

  // Fixpoint: keep binding tainted variables until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    for (const n of nodes) if (propagate(n, scope)) changed = true;
  }

  const report = (source: string, sink: string, at: AnyNode): void => {
    const pos = positionAt(parsed.lines, at.start);
    findings.push({
      source,
      sink,
      file: parsed.file,
      line: pos.line,
      column: pos.column,
      expression: parsed.source.slice(at.start, at.end).replace(/\s+/g, " ").slice(0, 120),
    });
  };

  for (const n of nodes) {
    checkSinks(n, scope, report);
    // One-hop interprocedural: a tainted argument passed to a local function's sink parameter.
    if (n.type === "CallExpression") {
      const name = isIdentifier(n["callee"] as AnyNode) ? ((n["callee"] as AnyNode)["name"] as string) : null;
      const summary = name !== null ? sinkFns.get(name) : undefined;
      if (summary) {
        const args = n["arguments"] as AnyNode[];
        for (const [i, sink] of summary) {
          const s = args[i] ? taintSource(args[i]!, scope) : null;
          if (s) report(s, `${sink} (via ${name}())`, n);
        }
      }
    }
  }

  // Recurse into nested functions, inheriting this scope's taint (closure).
  for (const fn of nestedFunctions(body)) {
    analyzeScope(fn["body"] as AnyNode, scope, findings, parsed, messageSeed(fn), sinkFns);
  }
}

/** Every function reachable by name: `function f(){}` and `const f = () => {}`. */
function namedFunctions(program: Node): Map<string, AnyNode> {
  const out = new Map<string, AnyNode>();
  const FN = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
  const walk = (n: AnyNode): void => {
    if (n.type === "FunctionDeclaration" && n["id"]) out.set((n["id"] as AnyNode)["name"] as string, n);
    if (
      n.type === "VariableDeclarator" &&
      (n["id"] as AnyNode).type === "Identifier" &&
      n["init"] &&
      FN.has((n["init"] as AnyNode).type)
    ) {
      out.set((n["id"] as AnyNode)["name"] as string, n["init"] as AnyNode);
    }
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const it of v) if (isNode(it)) walk(it);
      } else if (isNode(v)) walk(v);
    }
  };
  walk(program as AnyNode);
  return out;
}

/**
 * For each named function, which parameters flow to a sink. Computed by
 * seeding one parameter at a time as the only source and seeing whether any
 * sink fires - so a parameter that is sanitized before the sink does not
 * count. Direct only: a parameter that reaches a sink through another
 * function is not summarized (a stated limit).
 */
function summarize(functions: ReadonlyMap<string, AnyNode>, parsed: ParsedFile): SinkFns {
  const out = new Map<string, Map<number, string>>();
  for (const [name, fn] of functions) {
    const params = fn["params"] as AnyNode[];
    const sinkParams = new Map<number, string>();
    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;
      if (p.type !== "Identifier") continue;
      const probe: TaintFinding[] = [];
      const scope: Scope = { tainted: new Set(), sources: new Map() };
      analyzeScope(fn["body"] as AnyNode, scope, probe, parsed, { name: p["name"] as string, source: "@param" });
      const hit = probe.find((f) => f.source === "@param");
      if (hit) sinkParams.set(i, hit.sink);
    }
    if (sinkParams.size > 0) out.set(name, sinkParams);
  }
  return out;
}

/** Immediate nested functions of a body (not deeper - each recursion handles its own). */
function nestedFunctions(root: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
  const go = (n: AnyNode, top: boolean): void => {
    if (!top && FN.has(n.type)) {
      out.push(n);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const it of v) if (isNode(it)) go(it, false);
      } else if (isNode(v)) go(v, false);
    }
  };
  go(root, true);
  return out;
}

/**
 * If a function is the handler of a `window` message listener, its first
 * parameter is a source ("postMessage data"). Only window, not self: a
 * worker's messages come from its own creator (see message.ts).
 */
function messageSeed(fn: AnyNode): { name: string; source: string } | null {
  const p = (fn["params"] as AnyNode[])[0];
  const name = p?.type === "Identifier" ? (p["name"] as string) : null;
  if (name === null) return null;
  const listener = fn["$frostjsMessageHandler"];
  return listener === true ? { name, source: "postMessage data" } : null;
}

/** Mark window message handlers so messageSeed can find them. */
function markMessageHandlers(program: Node): void {
  const walk = (n: AnyNode): void => {
    if (n.type === "CallExpression") {
      const callee = n["callee"] as AnyNode;
      if (
        callee.type === "MemberExpression" &&
        memberName(callee) === "addEventListener" &&
        freeGlobal(callee["object"] as AnyNode, new Set(["window"]))
      ) {
        const args = n["arguments"] as AnyNode[];
        if (args[0]?.type === "Literal" && args[0]["value"] === "message" && args[1])
          (args[1] as AnyNode)["$frostjsMessageHandler"] = true;
      }
    }
    if (n.type === "AssignmentExpression") {
      const left = n["left"] as AnyNode;
      if (
        left.type === "MemberExpression" &&
        memberName(left) === "onmessage" &&
        freeGlobal(left["object"] as AnyNode, new Set(["window"]))
      ) {
        (n["right"] as AnyNode)["$frostjsMessageHandler"] = true;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = (n as AnyNode)[key];
      if (Array.isArray(v)) {
        for (const it of v) if (isNode(it)) walk(it);
      } else if (isNode(v)) walk(v);
    }
  };
  walk(program as AnyNode);
}

/** Find every untrusted-source-to-dangerous-sink flow in the file. */
export function taint(parsed: ParsedFile): TaintFinding[] {
  const info = analyzeScopes(parsed.program);
  for (const n of info.free) (n as AnyNode)[FREE] = true;
  for (const [n, v] of info.constants) (n as AnyNode)[FOLDED] = v;
  markMessageHandlers(parsed.program);

  const sinkFns = summarize(namedFunctions(parsed.program), parsed);
  const findings: TaintFinding[] = [];
  const empty: Scope = { tainted: new Set(), sources: new Map() };
  analyzeScope(parsed.program as AnyNode, empty, findings, parsed, null, sinkFns);
  // Deduplicate by position and sink.
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.line}:${f.column}:${f.sink}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
