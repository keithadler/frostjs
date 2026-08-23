import fs from "node:fs";
import path from "node:path";
import { HELP, parseArgs, UsageError, type ParsedArgs } from "./args.js";
import { VERSION } from "../version.js";
import { discover, isHtml } from "../discover/index.js";
import { parseFile, type ParseError } from "../extract/ast.js";
import { extract } from "../extract/index.js";
import { parseHtml } from "../extract/html.js";
import type { CapabilityUse } from "../extract/capability.js";
import { DENY_ALL, decide, compile, parsePolicy, PolicyError, type Policy } from "../policy/index.js";
import { commonAncestor, findPolicyFile } from "../policy/config.js";
import { matchesGlob } from "../policy/glob.js";
import { csp } from "../policy/csp.js";
import { text } from "../report/text.js";
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
  type RegistryUse,
} from "../registry.js";
import { includesFor, sync } from "../sync.js";

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Directory that inputs are resolved against and reported paths are made relative to. Defaults to process.cwd(). */
  cwd?: string;
}

/** git reports paths under the repository's real location; temp dirs on macOS are symlinked. */
function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

const isoToday = (): string => new Date().toISOString().slice(0, 10);

/**
 * Run the CLI against argv (without node and script name). Returns the exit
 * code instead of calling process.exit so tests can drive it directly.
 *
 * Exit codes: 0 clean, 1 policy violations, 2 usage or input error (bad
 * flag, missing path, syntax error, unreadable policy).
 */
export function run(argv: readonly string[], io: Io): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`permit: ${e.message}\n`);
      io.stderr(HELP);
      return 2;
    }
    throw e;
  }
  if (args.version) {
    io.stdout(`permit ${VERSION}\n`);
    return 0;
  }
  if (args.help) {
    io.stdout(HELP);
    return 0;
  }
  switch (args.command) {
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

interface Loaded {
  policy: Policy;
  policyDir: string;
  policyFile: string | null;
}

/** Find and compile the policy for the given inputs, or DENY_ALL when there is none. */
function loadPolicy(args: ParsedArgs, io: Io, inputs: readonly string[], required: boolean): Loaded | number {
  const cwd = io.cwd ?? process.cwd();
  const today = args.today ?? isoToday();
  const policyFile = args.policy
    ? path.resolve(cwd, args.policy)
    : findPolicyFile(inputs.length ? commonAncestor(inputs) : cwd);
  if (policyFile === null) {
    if (required) {
      io.stderr(`permit: no permit.policy found; ${args.command.replace("-", " ")} needs one\n`);
      return 2;
    }
    io.stderr("permit: no permit.policy found; denying everything\n");
    return { policy: DENY_ALL, policyDir: cwd, policyFile: null };
  }
  let source: string;
  try {
    source = fs.readFileSync(policyFile, "utf8");
  } catch {
    io.stderr(`permit: policy not found: ${args.policy ?? policyFile}\n`);
    return 2;
  }
  try {
    const policy = compile(parsePolicy(source, path.relative(cwd, policyFile) || policyFile), { today });
    return { policy, policyDir: path.dirname(policyFile), policyFile };
  } catch (e) {
    if (e instanceof PolicyError) {
      io.stderr(`permit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

function runCheck(args: ParsedArgs, io: Io): number {
  const cwd = io.cwd ?? process.cwd();
  if (args.updateBaseline && args.baseline === null) {
    io.stderr("permit: --update-baseline needs --baseline <file>\n");
    return 2;
  }
  if (args.format === "html") {
    io.stderr("permit: --format html is only for permit sri\n");
    return 2;
  }
  if (args.paths.length === 0) {
    io.stderr("permit: no paths given\n");
    io.stderr(HELP);
    return 2;
  }
  const inputs = args.paths.map((p) => path.resolve(cwd, p));
  const missing = args.paths.find((p) => !fs.existsSync(path.resolve(cwd, p)));
  if (missing !== undefined) {
    io.stderr(`permit: path not found: ${missing}\n`);
    return 2;
  }

  const loaded = loadPolicy(args, io, inputs, false);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;

  let files: string[];
  try {
    files = discover(inputs, { exclude: args.exclude, include: includesFor(policy.vendored) });
  } catch (e) {
    io.stderr(`permit: ${(e as Error).message}\n`);
    return 2;
  }

  let registry: Registry | null = null;
  if (policy.vendored.length > 0) {
    try {
      registry = readRegistry(registryPath(policyDir));
    } catch (e) {
      io.stderr(`permit: ${(e as Error).message}\n`);
      return 2;
    }
  }

  const syntaxErrors: ParseError[] = [];
  const uses: CapabilityUse[] = [];
  for (const file of files) {
    const shown = path.relative(cwd, file) || ".";
    const relToPolicy = path.relative(policyDir, file);
    if (registry !== null && policy.vendored.some((g) => matchesGlob(g, relToPolicy))) {
      uses.push(...vendoredUses(file, shown, registry));
      continue;
    }
    if (isHtml(file)) {
      for (const block of parseHtml(file, fs.readFileSync(file, "utf8"))) {
        if (block.errors.length > 0) syntaxErrors.push(...block.errors.map((e) => ({ ...e, file: shown })));
        else uses.push(...extract(block, { origin: "inline-html" }).map((u) => ({ ...u, file: shown })));
      }
      continue;
    }
    const parsed = parseFile(file);
    if (parsed.errors.length > 0) {
      syntaxErrors.push(...parsed.errors.map((e) => ({ ...e, file: shown })));
      continue;
    }
    uses.push(...extract(parsed).map((u) => ({ ...u, file: shown })));
  }

  for (const e of syntaxErrors) io.stderr(`${e.file}:${e.line}:${e.column}: syntax error: ${e.message}\n`);
  if (syntaxErrors.length > 0) return 2;

  // Report paths relative to cwd; scope policy globs relative to the policy file.
  let decisions = decide(uses, policy, {
    scopePath: (u) => path.relative(policyDir, path.resolve(cwd, u.file)),
    ...(args.minConfidence ? { minConfidence: args.minConfidence } : {}),
  });

  // Baseline: denials already on record are reported as baselined, not denied.
  let baselineNote = "";
  if (args.baseline !== null) {
    const baselineFile = path.resolve(cwd, args.baseline);
    const baselineDir = path.dirname(baselineFile);
    const relToBaseline = (u: CapabilityUse): string =>
      path.relative(baselineDir, path.resolve(cwd, u.file)).split(path.sep).join("/");
    let existing;
    try {
      existing = readBaseline(baselineFile);
    } catch (e) {
      io.stderr(`permit: ${(e as Error).message}\n`);
      return 2;
    }
    if (args.updateBaseline) {
      const entries = [
        ...existing.entries,
        ...decisions
          .filter((d) => d.verdict === "denied")
          .map((d) => ({ file: relToBaseline(d.use), capability: d.use.capability, expression: d.use.expression })),
      ];
      const n = writeBaseline(baselineFile, entries);
      baselineNote = `wrote ${n} ${n === 1 ? "entry" : "entries"} to ${path.relative(cwd, baselineFile) || baselineFile}\n`;
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
      io.stderr(`permit: ${(e as Error).message}\n`);
      return 2;
    }
    decisions = decisions.map((d) =>
      d.verdict === "denied" && !isChanged(changed, realpath(path.resolve(cwd, d.use.file)), d.use.line)
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

/** A vendored file contributes its registry entry's capability set, or one unregistered use. */
function vendoredUses(file: string, shown: string, registry: Registry): CapabilityUse[] {
  const integrity = integrityOfFile(file);
  const base = {
    file: shown,
    line: 1,
    column: 1,
    confidence: "certain" as const,
    origin: "vendored" as const,
    suppressed: false,
  };
  const entry = lookup(registry, integrity);
  if (entry === null) {
    return [{ ...base, capability: "vendor.unregistered", target: null, expression: integrity }];
  }
  const expression = `${entry.package}@${entry.version} (vendored)`;
  return entry.uses.map((u) => ({ ...base, capability: u.capability, target: u.target, expression }));
}

/** `permit vendor add <files>`: analyze each file once, record its capability set and hash. */
function runVendorAdd(args: ParsedArgs, io: Io): number {
  const cwd = io.cwd ?? process.cwd();
  if (args.paths.length === 0) {
    io.stderr("permit: permit vendor add needs one or more files\n");
    return 2;
  }
  const inputs = args.paths.map((p) => path.resolve(cwd, p));
  const loaded = loadPolicy(args, io, inputs, true);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;
  const regFile = registryPath(policyDir);
  let registry: Registry;
  try {
    registry = readRegistry(regFile);
  } catch (e) {
    io.stderr(`permit: ${(e as Error).message}\n`);
    return 2;
  }

  let files: string[];
  try {
    files = discover(inputs, { exclude: args.exclude, include: includesFor(policy.vendored) });
  } catch (e) {
    io.stderr(`permit: ${(e as Error).message}\n`);
    return 2;
  }
  const today = args.today ?? isoToday();
  for (const file of files) {
    const shown = path.relative(cwd, file) || file;
    const relToPolicy = path.relative(policyDir, file).split(path.sep).join("/");
    if (!policy.vendored.some((g) => matchesGlob(g, relToPolicy))) {
      io.stderr(
        `permit: note: ${shown} is not covered by a 'vendored' line in the policy; add one or it will be analyzed line by line\n`,
      );
    }
    const parsed = parseFile(file);
    if (parsed.errors.length > 0) {
      const e = parsed.errors[0]!;
      io.stderr(`${shown}:${e.line}:${e.column}: syntax error: ${e.message}\n`);
      return 2;
    }
    const seen = new Map<string, RegistryUse>();
    for (const u of extract(parsed)) {
      if (u.confidence === "possible") continue;
      seen.set(`${u.capability}\0${u.target ?? ""}`, { capability: u.capability, target: u.target });
    }
    const uses = [...seen.values()].sort((a, b) =>
      a.capability === b.capability
        ? (a.target ?? "").localeCompare(b.target ?? "")
        : a.capability.localeCompare(b.capability),
    );
    const pkg = guessPackage(file, policyDir);
    registry = upsert(registry, {
      integrity: integrityOfFile(file),
      package: pkg.package,
      version: pkg.version,
      file: relToPolicy,
      uses,
      added: today,
    });
    io.stdout(
      `${shown} (${pkg.package}@${pkg.version}): ${uses.length} capability ${uses.length === 1 ? "use" : "uses"}\n`,
    );
    for (const u of uses) {
      io.stdout(`  ${u.capability}${u.target !== null && u.target !== "same-origin" ? ` to ${u.target}` : ""}\n`);
    }
  }
  writeRegistry(regFile, registry);
  io.stdout(
    `added to ${path.relative(cwd, regFile) || regFile}; review the capabilities above and grant them in the policy if they are acceptable\n`,
  );
  return 0;
}

/** `permit registry sync`: reconcile the registry with the tree after a dependency bump. */
function runRegistrySync(args: ParsedArgs, io: Io): number {
  const cwd = io.cwd ?? process.cwd();
  const loaded = loadPolicy(args, io, [], true);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;
  if (policy.vendored.length === 0) {
    io.stderr("permit: the policy has no 'vendored' line, so there is nothing to sync\n");
    return 2;
  }
  const regFile = registryPath(policyDir);
  let registry: Registry;
  try {
    registry = readRegistry(regFile);
  } catch (e) {
    io.stderr(`permit: ${(e as Error).message}\n`);
    return 2;
  }
  const result = sync(registry, policyDir, policy.vendored, args.today ?? isoToday());
  writeRegistry(regFile, result.registry);
  for (const line of result.lines) io.stdout(line + "\n");
  io.stdout(
    `${path.relative(cwd, regFile) || regFile}: ${result.registry.entries.length} ${result.registry.entries.length === 1 ? "entry" : "entries"}\n`,
  );
  return result.needsReview ? 1 : 0;
}

/** `permit sri`: integrity values for registered vendored files, in the registry's own hash form. */
function runSri(args: ParsedArgs, io: Io): number {
  const cwd = io.cwd ?? process.cwd();
  const inputs = (args.paths.length ? args.paths : ["."]).map((p) => path.resolve(cwd, p));
  const loaded = loadPolicy(args, io, inputs, true);
  if (typeof loaded === "number") return loaded;
  const { policy, policyDir } = loaded;
  let registry: Registry;
  try {
    registry = readRegistry(registryPath(policyDir));
  } catch (e) {
    io.stderr(`permit: ${(e as Error).message}\n`);
    return 2;
  }
  let files: string[];
  try {
    files = discover(inputs, { exclude: args.exclude, include: includesFor(policy.vendored) });
  } catch (e) {
    io.stderr(`permit: ${(e as Error).message}\n`);
    return 2;
  }
  const out: { file: string; integrity: string }[] = [];
  let missing = 0;
  for (const file of files) {
    const rel = path.relative(policyDir, file).split(path.sep).join("/");
    if (!policy.vendored.some((g) => matchesGlob(g, rel))) continue;
    const integrity = integrityOfFile(file);
    const shown = path.relative(cwd, file).split(path.sep).join("/");
    if (lookup(registry, integrity) === null) {
      io.stderr(`${shown}: not in the registry; review it with: permit vendor add ${shown}\n`);
      missing++;
      continue;
    }
    out.push({ file: shown, integrity });
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

/** `permit csp` and `permit summary`: read the policy, print the derived artifact. */
function runPolicyCommand(args: ParsedArgs, io: Io): number {
  const cwd = io.cwd ?? process.cwd();
  const today = args.today ?? isoToday();
  const inputs = args.paths.map((p) => path.resolve(cwd, p));
  const loaded = loadPolicy(args, io, inputs, true);
  if (typeof loaded === "number") return loaded;
  io.stdout(args.command === "csp" ? csp(loaded.policy, today) + "\n" : summary(loaded.policy, today));
  return 0;
}
