/**
 * `frostjs audit`: what a body of code does, with no policy involved. The
 * question a reviewer asks of a dependency before adopting it, or of a
 * pull request that adds one: which hosts does it reach, does it generate
 * code from non-constant input, does it inject scripts, does it register a
 * service worker, and do any of those meet in one file.
 *
 * The shape that turned up ECSY's remote eval in three.js is the last one:
 * code generation or script injection with a non-constant argument, plus a
 * network reach, in the same file. It is reported as a "remote code path".
 */
import type { CapabilityUse } from "./extract/capability.js";
import { SAME_ORIGIN } from "./extract/target.js";

export interface FileAudit {
  file: string;
  /** Code generation whose input is not a constant. */
  dynamicCodegen: CapabilityUse[];
  scriptInjection: CapabilityUse[];
  /** Hosts the engine resolved, excluding the document's own origin. */
  hosts: string[];
  /** Hosts named in URL string literals anywhere in the file. A lead, not a finding. */
  literalHosts: string[];
  unknownDestinations: number;
  /** The file reads the page URL: a switch such a path can be flipped with. */
  readsUrl: boolean;
  /** Emscripten glue, whose code generation and wasm fetch are a known benign shape. */
  emscripten: boolean;
}

export interface Audit {
  files: number;
  uses: number;
  /** Distinct capability codes with counts. */
  capabilities: Map<string, number>;
  /** Resolved hosts with use counts, excluding the document's own origin. */
  hosts: Map<string, number>;
  /** Hosts named in string literals but not resolved as a destination. */
  literalHosts: string[];
  dynamicCodegen: CapabilityUse[];
  scriptInjection: CapabilityUse[];
  serviceWorkers: CapabilityUse[];
  wildcardPostMessage: CapabilityUse[];
  /** Files where code generation or script injection meets a network reach. */
  remoteCodePaths: FileAudit[];
}

/** A codegen use whose input is not a constant: `eval(data.script)`, not `Function("return this")`. */
export function isDynamicCodegen(u: CapabilityUse): boolean {
  if (!u.capability.startsWith("codegen.") || u.capability === "codegen.write") return false;
  const e = u.expression.replace(/\s+/g, " ");
  if (/^(new )?Function\s*\(\s*["'`]return this["'`]\s*\)/.test(e)) return false;
  if (/^eval$/.test(e)) return false; // a bare reference: typeof eval, feature detection
  const args = e.replace(/^(new )?(eval|Function|setTimeout|setInterval)\s*\(/, "");
  return !/^\s*["'`][^"'`]*["'`]\s*(,\s*["'`][^"'`]*["'`]\s*)*\)/.test(args);
}

/** Hosts that appear only in documentation links inside strings and comments. */
const DOC_HOSTS =
  /(^|\.)(w3\.org|mozilla\.org|github\.com|githubusercontent\.com|example\.com|wikipedia\.org|stackoverflow\.com|ietf\.org|json-schema\.org|whatwg\.org|khronos\.org|ecma-international\.org|npmjs\.com)$/i;

/** Hosts at the start of URL-shaped string literals, minus documentation hosts. Comments are not strings. */
export function literalHostsIn(strings: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of strings) {
    const m = /^\s*https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/:?#\s]|$)/i.exec(s);
    if (m && !DOC_HOSTS.test(m[1]!)) out.add(m[1]!.toLowerCase());
  }
  return [...out].sort();
}

const interesting = (t: string | null): t is string =>
  t !== null && t !== SAME_ORIGIN && t !== "data:" && t !== "blob:" && t !== "javascript:" && t !== "*";

/** Emscripten output: its code generation is embind and its fetch is its own .wasm. Reported, ranked below the rest. */
export const isEmscripten = (text: string): boolean => /emscripten/i.test(text) && /wasmBinary|WebAssembly/.test(text);

export interface FileSource {
  /** The file's text, for the reads-the-URL lead. */
  text: string;
  /** Its string literals, for the hosts-named-in-strings lead. */
  strings: readonly string[];
}

/**
 * Audit uses grouped by file. `sources` supplies each file's text and
 * string literals for the two leads; a file missing from it just loses
 * those columns.
 */
export function audit(
  byFile: ReadonlyMap<string, readonly CapabilityUse[]>,
  sources: ReadonlyMap<string, FileSource>,
): Audit {
  const capabilities = new Map<string, number>();
  const hosts = new Map<string, number>();
  const literal = new Set<string>();
  const dynamicCodegen: CapabilityUse[] = [];
  const scriptInjection: CapabilityUse[] = [];
  const serviceWorkers: CapabilityUse[] = [];
  const wildcardPostMessage: CapabilityUse[] = [];
  const remoteCodePaths: FileAudit[] = [];
  let uses = 0;

  for (const [file, fileUses] of byFile) {
    uses += fileUses.length;
    const { text, strings } = sources.get(file) ?? { text: "", strings: [] };
    const fa: FileAudit = {
      file,
      dynamicCodegen: fileUses.filter(isDynamicCodegen),
      scriptInjection: fileUses.filter((u) => u.capability === "dom-escape.script"),
      hosts: [...new Set(fileUses.map((u) => u.target).filter(interesting))].sort(),
      literalHosts: literalHostsIn(strings),
      unknownDestinations: fileUses.filter((u) => u.capability.startsWith("network.") && u.target === null).length,
      readsUrl: /URLSearchParams|location\.search|location\.hash/.test(text),
      emscripten: isEmscripten(text),
    };
    for (const u of fileUses) {
      capabilities.set(u.capability, (capabilities.get(u.capability) ?? 0) + 1);
      if (interesting(u.target)) hosts.set(u.target, (hosts.get(u.target) ?? 0) + 1);
      if (u.capability === "worker.service") serviceWorkers.push(u);
      if (u.capability === "navigation.postmessage" && u.target === "*") wildcardPostMessage.push(u);
    }
    for (const h of fa.literalHosts) literal.add(h);
    dynamicCodegen.push(...fa.dynamicCodegen);
    scriptInjection.push(...fa.scriptInjection);
    const remoteCode = fa.dynamicCodegen.length > 0 || fa.scriptInjection.length > 0;
    const reaches = fa.hosts.length > 0 || fa.literalHosts.length > 0 || fa.unknownDestinations > 0;
    if (remoteCode && reaches) remoteCodePaths.push(fa);
  }
  remoteCodePaths.sort((x, y) => Number(x.emscripten) - Number(y.emscripten));
  const literalHosts = [...literal].filter((h) => !hosts.has(h)).sort();
  return {
    files: byFile.size,
    uses,
    capabilities,
    hosts,
    literalHosts,
    dynamicCodegen,
    scriptInjection,
    serviceWorkers,
    wildcardPostMessage,
    remoteCodePaths,
  };
}

const site = (u: CapabilityUse): string => `${u.file}:${u.line}: ${u.expression.replace(/\s+/g, " ").slice(0, 90)}`;

/** The audit as a report a person reads top to bottom: the alarming things first. */
export function formatAudit(a: Audit): string {
  const lines: string[] = [];
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
  lines.push(`${plural(a.files, "file")}, ${plural(a.uses, "capability use")}`);
  lines.push("");

  lines.push("remote code paths (code generation or script injection meets a network reach in one file):");
  if (a.remoteCodePaths.length === 0) lines.push("  none");
  for (const f of a.remoteCodePaths) {
    const tags = [f.readsUrl ? "reads the page URL" : "", f.emscripten ? "Emscripten glue" : ""].filter(Boolean);
    lines.push(`  ${f.file}${tags.length ? `   [${tags.join(", ")}]` : ""}`);
    for (const u of [...f.dynamicCodegen, ...f.scriptInjection]) lines.push(`    ${site(u)}`);
    const reach = [
      ...f.hosts,
      ...f.literalHosts.filter((h) => !f.hosts.includes(h)).map((h) => `${h} (named in a string)`),
    ];
    if (reach.length) lines.push(`    reaches: ${reach.join(", ")}`);
    if (f.unknownDestinations)
      lines.push(`    and ${plural(f.unknownDestinations, "destination")} that cannot be read`);
  }
  lines.push("");

  lines.push("code generation from non-constant input:");
  const rcFiles = new Set(a.remoteCodePaths.map((f) => f.file));
  const cg = a.dynamicCodegen.filter((u) => !rcFiles.has(u.file));
  if (a.dynamicCodegen.length === 0) lines.push("  none");
  else if (cg.length === 0) lines.push("  only in the remote code paths above");
  for (const u of cg) lines.push(`  ${site(u)}`);
  lines.push("");

  lines.push("hosts reached:");
  if (a.hosts.size === 0) lines.push("  none resolved");
  for (const [h, n] of [...a.hosts].sort((x, y) => y[1] - x[1])) lines.push(`  ${h} (${plural(n, "use")})`);
  if (a.literalHosts.length)
    lines.push(`  named in strings, not resolved as a destination: ${a.literalHosts.join(", ")}`);
  lines.push("");

  if (a.serviceWorkers.length) {
    lines.push("service workers:");
    for (const u of a.serviceWorkers) lines.push(`  ${site(u)}`);
    lines.push("");
  }
  if (a.wildcardPostMessage.length) {
    lines.push("postMessage to any origin:");
    for (const u of a.wildcardPostMessage) lines.push(`  ${site(u)}`);
    lines.push("");
  }

  lines.push("capabilities:");
  if (a.capabilities.size === 0) lines.push("  none");
  for (const [c, n] of [...a.capabilities].sort((x, y) => x[0].localeCompare(y[0]))) lines.push(`  ${c} (${n})`);
  return lines.join("\n") + "\n";
}

/** The audit as JSON. Maps become objects; uses keep their positions. */
export function auditJson(a: Audit): string {
  const uses = (us: readonly CapabilityUse[]) =>
    us.map((u) => ({
      file: u.file,
      line: u.line,
      column: u.column,
      capability: u.capability,
      target: u.target,
      expression: u.expression,
    }));
  return (
    JSON.stringify(
      {
        files: a.files,
        uses: a.uses,
        capabilities: Object.fromEntries(a.capabilities),
        hosts: Object.fromEntries(a.hosts),
        literalHosts: a.literalHosts,
        dynamicCodegen: uses(a.dynamicCodegen),
        scriptInjection: uses(a.scriptInjection),
        serviceWorkers: uses(a.serviceWorkers),
        wildcardPostMessage: uses(a.wildcardPostMessage),
        remoteCodePaths: a.remoteCodePaths.map((f) => ({
          file: f.file,
          readsUrl: f.readsUrl,
          emscripten: f.emscripten,
          hosts: f.hosts,
          literalHosts: f.literalHosts,
          unknownDestinations: f.unknownDestinations,
          dynamicCodegen: uses(f.dynamicCodegen),
          scriptInjection: uses(f.scriptInjection),
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

/** Group uses by file, for audit(). */
export function groupByFile(uses: readonly CapabilityUse[]): Map<string, CapabilityUse[]> {
  const out = new Map<string, CapabilityUse[]>();
  for (const u of uses) {
    if (!out.has(u.file)) out.set(u.file, []);
    out.get(u.file)!.push(u);
  }
  return out;
}
