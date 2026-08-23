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
const DOCUMENT_GLOBAL: ReadonlySet<string> = new Set(["document"]);
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
/**
 * Global functions that preserve taint on their first argument. Only
 * DECODING functions belong here: they un-neutralize a value (reveal HTML
 * or script the encoding hid). ENCODING functions (encodeURIComponent,
 * encodeURI, escape) are deliberately absent - they percent-encode `<`,
 * `>`, `&`, so `el.innerHTML = encodeURIComponent(x)` cannot inject markup
 * and must not be flagged.
 */
const PRESERVING_CALLS: ReadonlySet<string> = new Set([
  "decodeURIComponent",
  "decodeURI",
  "atob",
  "unescape",
  "String",
]);

/** Properties whose value is a number, so they carry no attacker-controlled text. */
const NUMERIC_PROPS: ReadonlySet<string> = new Set(["length", "size", "byteLength", "index", "lastIndex"]);

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
      // t.length / t.size return a number, which carries no attacker text.
      if (NUMERIC_PROPS.has(memberName(n) ?? "")) return null;
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

/**
 * The sinks: a tainted value here is markup, code, or a remote load.
 *
 * Open redirect (`location = tainted`, `window.open(tainted)`) is
 * deliberately NOT a sink. A sweep of 20 top web apps found this sink fired
 * 15 times and every hit was benign same-origin navigation - reloading with
 * the current query, `location.href = new URL(location.href).pathname`,
 * `?next=${location.href}` login redirects - because redirecting off the
 * current URL is ubiquitous and frostjs cannot statically tell it from an
 * attacker-controlled full URL. A ~0% precision sink violates the
 * zero-false-positive rule, so it is left to other tooling.
 */
function checkSinks(n: AnyNode, scope: Scope, add: (source: string, sink: string, node: AnyNode) => void): void {
  // assignment sinks: el.innerHTML = tainted, el.outerHTML = tainted, iframe.srcdoc = tainted
  if (n.type === "AssignmentExpression") {
    const left = unwrap(n["left"] as AnyNode);
    const right = n["right"] as AnyNode;
    if (left.type === "MemberExpression") {
      const prop = memberName(left);
      if (prop === "innerHTML" || prop === "outerHTML" || prop === "srcdoc") {
        const s = taintSource(right, scope);
        if (s) add(s, prop, n);
      }
    }
  }
  // React: dangerouslySetInnerHTML={{ __html: tainted }}. The __html key is
  // React's convention and nothing else uses it, so a tainted value there is
  // unambiguously that sink.
  if (n.type === "Property" && n["computed"] !== true) {
    const key = n["key"] as AnyNode;
    const name =
      key.type === "Identifier" ? (key["name"] as string) : key.type === "Literal" ? String(key["value"]) : null;
    if (name === "__html") {
      const s = taintSource(n["value"] as AnyNode, scope);
      if (s) add(s, "dangerouslySetInnerHTML", n);
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
    // new Worker(tainted) / new SharedWorker(tainted): loads an attacker-chosen script off-thread.
    if (n.type === "NewExpression" && (isIdentifier(callee, "Worker") || isIdentifier(callee, "SharedWorker")))
      return flag(args[0], callee.name);
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
      // location.assign / .replace and window.open are open-redirect sinks,
      // deliberately omitted (see the note on checkSinks).
      // navigator.serviceWorker.register(tainted): registers an attacker-chosen script that intercepts every request.
      if (method === "register" && obj.type === "MemberExpression" && memberName(obj) === "serviceWorker")
        return flag(args[0], "serviceWorker.register");
    }
  }
}

/** Statements introduced by declarations/assignments that may add taint in this scope. */
function propagate(node: AnyNode, scope: Scope): boolean {
  let changed = false;
  const bindName = (name: string, source: string | null): void => {
    if (source && !scope.tainted.has(name)) {
      scope.tainted.add(name);
      scope.sources.set(name, source);
      changed = true;
    }
  };
  // `const { data } = e` / `const { hash } = location` / `const [a] = arr`: a
  // destructured binding is tainted if its member is (a source, or a member
  // of a tainted object).
  const bindPattern = (pat: AnyNode, init: AnyNode): void => {
    if (pat.type === "Identifier") return bindName(pat["name"] as string, taintSource(init, scope));
    if (pat.type === "ObjectPattern") {
      for (const prop of pat["properties"] as AnyNode[]) {
        if (prop.type === "RestElement") bindPattern(prop["argument"] as AnyNode, init);
        else if (prop["computed"] !== true) {
          const k = prop["key"] as AnyNode;
          const key =
            k.type === "Identifier" ? (k["name"] as string) : k.type === "Literal" ? String(k["value"]) : null;
          const target =
            (prop["value"] as AnyNode).type === "AssignmentPattern"
              ? (prop["value"] as AnyNode)["left"]
              : prop["value"];
          if (key !== null && (target as AnyNode).type === "Identifier")
            bindName((target as AnyNode)["name"] as string, sourceOfMember(init, key, scope));
        }
      }
    } else if (pat.type === "ArrayPattern") {
      // Elements of a tainted array/iterable are tainted.
      const s = taintSource(init, scope);
      for (const el of pat["elements"] as (AnyNode | null)[])
        if (el?.type === "Identifier") bindName(el["name"] as string, s);
    }
  };
  if (node.type === "VariableDeclarator" && node["init"]) {
    bindPattern(node["id"] as AnyNode, node["init"] as AnyNode);
  } else if (node.type === "AssignmentExpression" && (node["left"] as AnyNode).type === "Identifier") {
    bindName((node["left"] as AnyNode)["name"] as string, taintSource(node["right"] as AnyNode, scope));
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
  seedParam: { param: AnyNode; source: string } | null,
  sinkFns: SinkFns = NO_SINK_FNS,
): void {
  const scope: Scope = { tainted: new Set(inherited.tainted), sources: new Map(inherited.sources) };
  if (seedParam) seedPattern(seedParam.param, seedParam.source, scope);
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
      analyzeScope(fn["body"] as AnyNode, scope, probe, parsed, { param: p, source: "@param" });
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
 * If a function is a marked message handler, its first parameter is a
 * source. `window` postMessage handlers and the handlers of a WebSocket or
 * EventSource this file constructs both carry remote, untrusted data. Not
 * `self` (a worker's messages come from its own creator; see message.ts).
 */
function messageSeed(fn: AnyNode): { param: AnyNode; source: string } | null {
  const param = (fn["params"] as AnyNode[])[0];
  if (!param) return null;
  if (fn["$frostjsMessageHandler"] === true) return { param, source: "postMessage data" };
  if (fn["$frostjsRemoteHandler"] === true) return { param, source: "server message" };
  return null;
}

/** Mark every identifier bound by a pattern (destructuring included) as tainted with `source`. */
function seedPattern(pat: AnyNode, source: string, scope: Scope): void {
  switch (pat.type) {
    case "Identifier":
      scope.tainted.add(pat["name"] as string);
      scope.sources.set(pat["name"] as string, source);
      return;
    case "ObjectPattern":
      for (const prop of pat["properties"] as AnyNode[])
        seedPattern((prop.type === "RestElement" ? prop["argument"] : prop["value"]) as AnyNode, source, scope);
      return;
    case "ArrayPattern":
      for (const el of pat["elements"] as (AnyNode | null)[]) if (el) seedPattern(el, source, scope);
      return;
    case "AssignmentPattern":
    case "RestElement":
      seedPattern((pat["left"] ?? pat["argument"]) as AnyNode, source, scope);
      return;
  }
}

/** The source label for `obj.key`, whether a direct source or a member of a tainted object. */
function sourceOfMember(obj: AnyNode, key: string, scope: Scope): string | null {
  obj = unwrap(obj);
  if (NUMERIC_PROPS.has(key)) return null;
  if (LOCATION_PROPS.has(key) && isLocation(obj)) return `location.${key}`;
  if (DOCUMENT_PROPS.has(key) && freeGlobal(obj, DOCUMENT_GLOBAL)) return `document.${key}`;
  if (key === "name" && freeGlobal(obj, GLOBALS)) return "window.name";
  return taintSource(obj, scope);
}

/** Names bound to `new WebSocket(...)` or `new EventSource(...)` anywhere in the file. */
function socketVars(program: Node): Set<string> {
  const names = new Set<string>();
  const walk = (n: AnyNode): void => {
    if (n.type === "VariableDeclarator" && (n["id"] as AnyNode).type === "Identifier") {
      const init = n["init"] as AnyNode | null;
      if (
        init?.type === "NewExpression" &&
        (isIdentifier(init["callee"], "WebSocket") || isIdentifier(init["callee"], "EventSource"))
      ) {
        names.add((n["id"] as AnyNode)["name"] as string);
      }
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
  return names;
}

/** Mark window postMessage handlers and WebSocket/EventSource message handlers so messageSeed can find them. */
function markMessageHandlers(program: Node): void {
  const sockets = socketVars(program);
  const receiverIsRemote = (obj: AnyNode): "window" | "socket" | null => {
    if (freeGlobal(obj, new Set(["window"]))) return "window";
    if (isIdentifier(obj) && sockets.has(obj.name)) return "socket";
    return null;
  };
  const mark = (handler: AnyNode, kind: "window" | "socket"): void => {
    (handler as AnyNode)[kind === "window" ? "$frostjsMessageHandler" : "$frostjsRemoteHandler"] = true;
  };
  const walk = (n: AnyNode): void => {
    if (n.type === "CallExpression") {
      const callee = n["callee"] as AnyNode;
      if (callee.type === "MemberExpression" && memberName(callee) === "addEventListener") {
        const kind = receiverIsRemote(callee["object"] as AnyNode);
        const args = n["arguments"] as AnyNode[];
        if (kind && args[0]?.type === "Literal" && args[0]["value"] === "message" && args[1])
          mark(args[1] as AnyNode, kind);
      }
    }
    if (n.type === "AssignmentExpression") {
      const left = n["left"] as AnyNode;
      if (left.type === "MemberExpression" && memberName(left) === "onmessage") {
        const kind = receiverIsRemote(left["object"] as AnyNode);
        if (kind) mark(n["right"] as AnyNode, kind);
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
