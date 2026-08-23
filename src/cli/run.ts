/**
 * The command-line orchestrator: one function per command, sharing policy
 * loading, discovery and registry access. Nothing here calls process.exit;
 * every command returns its exit code so tests drive it directly.
 *
 * Exit codes: 0 clean; 1 a use was denied, or (registry sync, sri) something
 * needs a person; 2 usage or input error (bad flag, missing path, syntax
 * error, unreadable policy).
 */
import fs from "node:fs";
import path from "node:path";
import { HELP, parseArgs, UsageError, type ParsedArgs } from "./args.js";
import { VERSION } from "../version.js";
import { discover, isHtml } from "../discover/index.js";
import { parseFile, type ParseError } from "../extract/ast.js";
import { extract, stringLiterals } from "../extract/index.js";
import { parseHtml, htmlAttributeUses } from "../extract/html.js";
import type { CapabilityUse } from "../extract/capability.js";
import {
  commonAncestor,
  compilePolicyFile,
  csp,
  decide,
  findPolicyFile,
  isoToday,
  matchesGlob,
  DENY_ALL,
  PolicyError,
  type Policy,
} from "../policy/index.js";
import { text, describeUse } from "../report/text.js";
import { json } from "../report/json.js";
import { sarif } from "../report/sarif.js";
import { github } from "../report/github.js";
import { summary } from "../report/summary.js";
import { baselineKey, baselineKeys, readBaseline, writeBaseline } from "../baseline.js";
import { changedLines, isChanged } from "../changed.js";
import {
  guessPackage,
  integrityOfFile,
  lookup,
  readRegistry,
  registryPath,
  upsert,
  writeRegistry,
  type Registry,
} from "../registry.js";
import { includesFor, sync, usesOf } from "../sync.js";
import { policyNameFor, starterPolicy } from "../init.js";
import { audit, auditJson, formatAudit, groupByFile, type FileSource } from "../audit.js";
import { taint, type TaintFinding } from "../extract/taint.js";
import { capabilitiesJson, capabilitiesMarkdown, capabilitiesText } from "../capabilities.js";
import { suppressions, isSuppressed } from "../extract/suppress.js";

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Directory inputs are resolved against and reported paths are made relative to. Defaults to process.cwd(). */
  cwd?: string;
}

/** Run the CLI against argv (without node and script name) and return the exit code. */
export function run(argv: readonly string[], io: Io): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`frostjs: ${e.message}\n`);
    io.stderr(HELP);
    return 2;
  }
  if (args.version) {
    io.stdout(`frostjs ${VERSION}\n`);
    return 0;
  }
  if (args.help) {
    io.stdout(HELP);
    return 0;
  }
  switch (args.command) {
    case "init":
      return runInit(args, io);
    case "audit":
      return runAudit(args, io);
    case "capabilities":
      return runCapabilities(args, io);
    case "csp":
    case "summary":
      return runPolicyCommand(args, io);
    case "vendor-add":
      return runVendorAdd(args, io);
    case "registry-sync":
      return runRegistrySync(args, io);
    case "sri":
      return runSri(args, io);
    default:
      return runCheck(args, io);
  }
}

// Shared pieces. Each returns a value or an exit code, having already
// printed the reason; callers test `typeof x === "number"`.

const cwdOf = (io: Io): string => io.cwd ?? process.cwd();

/** A path as it should appear in reports: relative to cwd, forward slashes. */
const shown = (cwd: string, file: string): string => path.relative(cwd, file).split(path.sep).join("/") || ".";

/** A path relative to the policy directory, forward slashes, for globs and the registry. */
const relToPolicy = (policyDir: string, file: string): string =>
  path.relative(policyDir, file).split(path.sep).join("/");

function fail(io: Io, message: string): number {
  io.stderr(`frostjs: ${message}\n`);
  return 2;
}

interface Loaded {
  policy: Policy;
  policyDir: string;
}

/** Find and compile the policy for the inputs; DENY_ALL with a note when there is none and it is not required. */
function loadPolicy(args: ParsedArgs, io: Io, inputs: readonly string[], required: boolean): Loaded | number {
  const cwd = cwdOf(io);
  const command = `frostjs ${args.command.replace("-", " ")}`;
  const policyFile = args.policy
    ? path.resolve(cwd, args.policy)
    : findPolicyFile(inputs.length ? commonAncestor(inputs) : cwd);
  if (policyFile === null) {
    if (required) return fail(io, `no frostjs.policy found; ${command} needs one`);
    io.stderr("frostjs: no frostjs.policy found; denying everything\n");
    return { policy: DENY_ALL, policyDir: cwd };
  }
  try {
    const policy = compilePolicyFile(policyFile, args.today ?? isoToday(), shown(cwd, policyFile));
    return { policy, policyDir: path.dirname(policyFile) };
  } catch (e) {
    if (e instanceof PolicyError || e instanceof Error) return fail(io, e.message);
    throw e;
  }
}

/** Resolve the given paths against cwd and discover source files under them. */
function discoverOrFail(
  args: ParsedArgs,
  io: Io,
  vendored: readonly string[],
  include: string[] = [],
): string[] | number {
  const cwd = cwdOf(io);
  const missing = args.paths.find((p) => !fs.existsSync(path.resolve(cwd, p)));
  if (missing !== undefined) return fail(io, `path not found: ${missing}`);
  return discover(
    args.paths.map((p) => path.resolve(cwd, p)),
    { exclude: args.exclude, include: [...includesFor(vendored), ...include] },
  );
}

function readRegistryOrFail(policyDir: string, io: Io): Registry | number {
  try {
    return readRegistry(registryPath(policyDir));
  } catch (e) {
    return fail(io, (e as Error).message);
  }
}

// frostjs <paths...>

function runCheck(args: ParsedArgs, io: Io): number {
  const cwd = cwdOf(io);
  if (args.updateBaseline && args.baseline === null) return fail(io, "--update-baseline needs --baseline <file>");
  if (args.format === "html") return fail(io, "--format html is only for frostjs sri");
  if (args.format === "md") return fail(io, "--format md is only for frostjs capabilities");
  if (args.paths.length === 0) {
    io.stderr("frostjs: no paths given\n");
    io.stderr(HELP);
    return 2;
  }
  const inputs = args.paths.map((p) => path.resolve(cwd, p));

  const loaded = loadPolicy(args, io, inputs, false);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;

  const discovered = discoverOrFail(args, io, policy.vendored);
  if (typeof discovered === "number") return discovered;
  const files = discovered.filter((f) => !policy.ignore.some((g) => matchesGlob(g, relToPolicy(policyDir, f))));

  let registry: Registry | null = null;
  if (policy.vendored.length > 0) {
    const r = readRegistryOrFail(policyDir, io);
    if (typeof r === "number") return r;
    registry = r;
  }

  const extracted = extractAll(files, cwd, io, (file, name) =>
    registry !== null && policy.vendored.some((g) => matchesGlob(g, relToPolicy(policyDir, file)))
      ? vendoredUses(file, name, registry)
      : null,
  );
  if (typeof extracted === "number") return extracted;
  const uses = extracted;

  // Report paths are relative to cwd; policy globs are relative to the policy file.
  let decisions = decide(uses, policy, {
    scopePath: (u) => relToPolicy(policyDir, path.resolve(cwd, u.file)),
    ...(args.minConfidence ? { minConfidence: args.minConfidence } : {}),
  });

  // Taint: untrusted input reaching a dangerous sink, opt-in with --taint.
  // Modeled as denials of a synthetic taint.<sink> capability so baseline,
  // changed-lines and every output format apply to them uniformly.
  if (args.taint || policy.taint) {
    const vendored = (f: string): boolean =>
      registry !== null && policy.vendored.some((g) => matchesGlob(g, relToPolicy(policyDir, f)));
    for (const file of files) {
      if (vendored(file)) continue;
      const name = shown(cwd, file);
      const units = isHtml(file) ? parseHtml(file, fs.readFileSync(file, "utf8")) : [parseFile(file)];
      for (const unit of units) {
        if (unit.errors.length > 0) continue;
        const ignores = suppressions(unit);
        for (const t of taint(unit)) {
          const capability = `taint.${t.sink}`;
          const use: CapabilityUse = {
            capability,
            target: t.source,
            file: name,
            line: t.line,
            column: t.column,
            expression: t.expression,
            confidence: "certain",
            origin: isHtml(file) ? "inline-html" : "first-party",
            suppressed: isSuppressed(ignores.get(t.line), capability),
          };
          decisions.push({
            use,
            verdict: use.suppressed ? "suppressed" : "denied",
            reason: "tainted",
            rule: null,
          });
        }
      }
    }
  }

  // Baseline: denials already on record are reported as baselined, not denied.
  let baselineNote = "";
  if (args.baseline !== null) {
    const baselineFile = path.resolve(cwd, args.baseline);
    const baselineDir = path.dirname(baselineFile);
    const relToBaseline = (u: CapabilityUse): string => relToPolicy(baselineDir, path.resolve(cwd, u.file));
    let existing;
    try {
      existing = readBaseline(baselineFile);
    } catch (e) {
      return fail(io, (e as Error).message);
    }
    if (args.updateBaseline) {
      const entries = [
        ...existing.entries,
        ...decisions
          .filter((d) => d.verdict === "denied")
          .map((d) => ({ file: relToBaseline(d.use), capability: d.use.capability, expression: d.use.expression })),
      ];
      const n = writeBaseline(baselineFile, entries);
      baselineNote = `wrote ${n} ${n === 1 ? "entry" : "entries"} to ${shown(cwd, baselineFile)}\n`;
    } else {
      const known = baselineKeys(existing);
      decisions = decisions.map((d) =>
        d.verdict === "denied" && known.has(baselineKey(relToBaseline(d.use), d.use.capability, d.use.expression))
          ? { ...d, verdict: "baselined" }
          : d,
      );
    }
  }

  // Changed lines only: denials outside the diff are reported as unchanged.
  if (args.changedSince !== null) {
    let changed;
    try {
      changed = changedLines(args.changedSince, commonAncestor(inputs));
    } catch (e) {
      return fail(io, (e as Error).message);
    }
    decisions = decisions.map((d) =>
      d.verdict === "denied" && !isChanged(changed, path.resolve(cwd, d.use.file), d.use.line)
        ? { ...d, verdict: "unchanged" }
        : d,
    );
  }

  switch (args.format) {
    case "json":
      io.stdout(json(decisions, files.length, policy));
      break;
    case "sarif":
      io.stdout(sarif(decisions));
      break;
    case "github":
      io.stdout(github(decisions, { files: files.length }, { warnings: policy.warnings }));
      break;
    default:
      io.stdout(text(decisions, { files: files.length }, { warnings: policy.warnings }));
  }
  if (baselineNote) io.stderr(baselineNote);

  const denied = decisions.some((d) => d.verdict === "denied");
  return denied && !args.exitZero && !args.updateBaseline ? 1 : 0;
}

/**
 * Extract every use from the files, reporting paths relative to cwd.
 * `special` may claim a file (vendored files do) and return its uses.
 * Syntax errors are printed and end the run with exit 2.
 */
function extractAll(
  files: readonly string[],
  cwd: string,
  io: Io,
  special: (file: string, name: string) => CapabilityUse[] | null = () => null,
): CapabilityUse[] | number {
  const syntaxErrors: ParseError[] = [];
  const uses: CapabilityUse[] = [];
  for (const file of files) {
    const name = shown(cwd, file);
    const claimed = special(file, name);
    if (claimed !== null) {
      uses.push(...claimed);
    } else if (isHtml(file)) {
      const text = fs.readFileSync(file, "utf8");
      for (const block of parseHtml(file, text)) {
        if (block.errors.length > 0) syntaxErrors.push(...block.errors.map((e) => ({ ...e, file: name })));
        else uses.push(...extract(block, { origin: "inline-html" }).map((u) => ({ ...u, file: name })));
      }
      uses.push(...htmlAttributeUses(file, text).map((u) => ({ ...u, file: name })));
    } else {
      const parsed = parseFile(file);
      if (parsed.errors.length > 0) syntaxErrors.push(...parsed.errors.map((e) => ({ ...e, file: name })));
      else uses.push(...extract(parsed).map((u) => ({ ...u, file: name })));
    }
  }
  for (const e of syntaxErrors) io.stderr(`${e.file}:${e.line}:${e.column}: syntax error: ${e.message}\n`);
  return syntaxErrors.length > 0 ? 2 : uses;
}

// frostjs capabilities

function runCapabilities(args: ParsedArgs, io: Io): number {
  if (args.format === "json") io.stdout(capabilitiesJson());
  else if (args.format === "md") io.stdout(capabilitiesMarkdown());
  else if (args.format === "text") io.stdout(capabilitiesText());
  else return fail(io, "frostjs capabilities prints text, json or md");
  return 0;
}

// frostjs audit <paths...>

function runAudit(args: ParsedArgs, io: Io): number {
  const cwd = cwdOf(io);
  if (args.paths.length === 0) return fail(io, "frostjs audit needs one or more paths");
  if (args.format !== "text" && args.format !== "json") return fail(io, "frostjs audit prints text or json");
  // A dependency's shipped code lives in dist/ or build/; the default excludes are for a project's own output.
  const files = discoverOrFail(args, io, [], ["dist", "build"]);
  if (typeof files === "number") return files;
  const uses = extractAll(files, cwd, io);
  if (typeof uses === "number") return uses;
  const sources = new Map<string, FileSource>();
  const taintFlows: TaintFinding[] = [];
  for (const f of files) {
    const name = shown(cwd, f);
    const text = fs.readFileSync(f, "utf8");
    const units = isHtml(f) ? parseHtml(f, text) : [parseFile(f)];
    sources.set(name, { text, strings: units.flatMap((u) => (u.errors.length ? [] : stringLiterals(u))) });
    for (const u of units) if (!u.errors.length) taintFlows.push(...taint(u).map((t) => ({ ...t, file: name })));
  }
  const byFile = groupByFile(uses);
  for (const f of files) if (!byFile.has(shown(cwd, f))) byFile.set(shown(cwd, f), []);
  const a = audit(byFile, sources, taintFlows);
  io.stdout(args.format === "json" ? auditJson(a) : formatAudit(a));
  return 0;
}

// frostjs init [paths...]

function runInit(args: ParsedArgs, io: Io): number {
  const cwd = cwdOf(io);
  const target = path.join(cwd, "frostjs.policy");
  if (fs.existsSync(target))
    return fail(io, "frostjs.policy already exists here; edit it, or delete it and run init again");
  if (args.paths.length === 0) args = { ...args, paths: ["."] };
  const files = discoverOrFail(args, io, []);
  if (typeof files === "number") return files;
  const uses = extractAll(files, cwd, io);
  if (typeof uses === "number") return uses;
  const policy = starterPolicy(policyNameFor(cwd), uses, args.today ?? isoToday());
  fs.writeFileSync(target, policy);
  const grants = policy.split("\n").filter((l) => l.startsWith("may ")).length;
  io.stdout(policy);
  io.stderr(
    `wrote frostjs.policy with ${grants} ${grants === 1 ? "grant" : "grants"} from ${files.length} ${files.length === 1 ? "file" : "files"}; read it, delete what should not be allowed, then run: frostjs ${args.paths.join(" ")}\n`,
  );
  return 0;
}

/** A vendored file contributes its registry entry's capability set, or one unregistered use. */
function vendoredUses(file: string, name: string, registry: Registry): CapabilityUse[] {
  const integrity = integrityOfFile(file);
  const base = {
    file: name,
    line: 1,
    column: 1,
    confidence: "certain",
    origin: "vendored",
    suppressed: false,
  } as const;
  const entry = lookup(registry, integrity);
  if (entry === null) return [{ ...base, capability: "vendor.unregistered", target: null, expression: integrity }];
  const expression = `${entry.package}@${entry.version} (vendored)`;
  return entry.uses.map((u) => ({ ...base, capability: u.capability, target: u.target, expression }));
}

// frostjs vendor add <files...>

function runVendorAdd(args: ParsedArgs, io: Io): number {
  const cwd = cwdOf(io);
  if (args.paths.length === 0) return fail(io, "frostjs vendor add needs one or more files");
  const inputs = args.paths.map((p) => path.resolve(cwd, p));
  const loaded = loadPolicy(args, io, inputs, true);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;
  const regFile = registryPath(policyDir);
  let registry = readRegistryOrFail(policyDir, io);
  if (typeof registry === "number") return registry;
  const files = discoverOrFail(args, io, policy.vendored);
  if (typeof files === "number") return files;

  const today = args.today ?? isoToday();
  for (const file of files) {
    const name = shown(cwd, file);
    const rel = relToPolicy(policyDir, file);
    if (!policy.vendored.some((g) => matchesGlob(g, rel))) {
      io.stderr(
        `frostjs: note: ${name} is not covered by a 'vendored' line in the policy; add one or it will be analyzed line by line\n`,
      );
    }
    const parsed = parseFile(file);
    if (parsed.errors.length > 0) {
      const e = parsed.errors[0]!;
      return fail(io, `${name}:${e.line}:${e.column}: syntax error: ${e.message}`);
    }
    const uses = usesOf(parsed);
    const pkg = guessPackage(file, policyDir);
    registry = upsert(registry, { integrity: integrityOfFile(file), ...pkg, file: rel, uses, added: today });
    io.stdout(
      `${name} (${pkg.package}@${pkg.version}): ${uses.length} capability ${uses.length === 1 ? "use" : "uses"}\n`,
    );
    for (const u of uses) io.stdout(`  ${describeUse(u.capability, u.target)}\n`);
  }
  writeRegistry(regFile, registry);
  io.stdout(
    `added to ${shown(cwd, regFile)}; review the capabilities above and grant them in the policy if they are acceptable\n`,
  );
  return 0;
}

// frostjs registry sync

function runRegistrySync(args: ParsedArgs, io: Io): number {
  const cwd = cwdOf(io);
  const loaded = loadPolicy(args, io, [], true);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;
  if (policy.vendored.length === 0) return fail(io, "the policy has no 'vendored' line, so there is nothing to sync");
  const registry = readRegistryOrFail(policyDir, io);
  if (typeof registry === "number") return registry;

  const result = sync(registry, policyDir, policy.vendored, args.today ?? isoToday());
  const regFile = registryPath(policyDir);
  writeRegistry(regFile, result.registry);
  for (const w of result.warnings) io.stderr(`frostjs: warning: ${w}\n`);
  for (const line of result.lines) io.stdout(line + "\n");
  const n = result.registry.entries.length;
  io.stdout(`${shown(cwd, regFile)}: ${n} ${n === 1 ? "entry" : "entries"}\n`);
  return result.needsReview ? 1 : 0;
}

// frostjs sri [paths...]

function runSri(args: ParsedArgs, io: Io): number {
  const cwd = cwdOf(io);
  if (args.paths.length === 0) args = { ...args, paths: ["."] };
  const inputs = args.paths.map((p) => path.resolve(cwd, p));
  const loaded = loadPolicy(args, io, inputs, true);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;
  const registry = readRegistryOrFail(policyDir, io);
  if (typeof registry === "number") return registry;
  const files = discoverOrFail(args, io, policy.vendored);
  if (typeof files === "number") return files;

  const out: { file: string; integrity: string }[] = [];
  let missing = 0;
  for (const file of files) {
    if (!policy.vendored.some((g) => matchesGlob(g, relToPolicy(policyDir, file)))) continue;
    const integrity = integrityOfFile(file);
    const name = shown(cwd, file);
    if (lookup(registry, integrity) === null) {
      io.stderr(`${name}: not in the registry; review it with: frostjs vendor add ${name}\n`);
      missing++;
    } else out.push({ file: name, integrity });
  }
  switch (args.format) {
    case "json":
      io.stdout(JSON.stringify(Object.fromEntries(out.map((o) => [o.file, o.integrity])), null, 2) + "\n");
      break;
    case "html":
      for (const o of out)
        io.stdout(`<script src="${o.file}" integrity="${o.integrity}" crossorigin="anonymous"></script>\n`);
      break;
    default:
      for (const o of out) io.stdout(`${o.file} ${o.integrity}\n`);
  }
  return missing > 0 ? 1 : 0;
}

// frostjs csp, frostjs summary

function runPolicyCommand(args: ParsedArgs, io: Io): number {
  const cwd = cwdOf(io);
  const loaded = loadPolicy(
    args,
    io,
    args.paths.map((p) => path.resolve(cwd, p)),
    true,
  );
  if (typeof loaded === "number") return loaded;
  io.stdout(args.command === "csp" ? csp(loaded.policy) + "\n" : summary(loaded.policy));
  return 0;
}
