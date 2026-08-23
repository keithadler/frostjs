import path from "node:path";
import { HELP, parseArgs, UsageError } from "./args.js";
import { VERSION } from "../version.js";
import { discover } from "../discover/index.js";
import { parseFile, type ParseError } from "../extract/ast.js";
import { extract } from "../extract/index.js";
import type { CapabilityUse } from "../extract/capability.js";
import fs from "node:fs";
import { DENY_ALL, decide, compile, parsePolicy, PolicyError, type Policy } from "../policy/index.js";
import { commonAncestor, findPolicyFile } from "../policy/config.js";
import { text } from "../report/text.js";
import { json } from "../report/json.js";
import { sarif } from "../report/sarif.js";
import { baselineKey, baselineKeys, readBaseline, writeBaseline } from "../baseline.js";
import { changedLines, isChanged } from "../changed.js";

/** git reports paths under the repository's real location; temp dirs on macOS are symlinked. */
function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Directory that reported paths are made relative to. Defaults to process.cwd(). */
  cwd?: string;
}

/**
 * Run the CLI against argv (without node and script name). Returns the exit
 * code instead of calling process.exit so tests can drive it directly.
 *
 * Exit codes: 0 clean, 1 policy violations (from step 4 on), 2 usage or
 * input error (bad flag, missing path, syntax error).
 */
export function run(argv: readonly string[], io: Io): number {
  let args;
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
  if (args.updateBaseline && args.baseline === null) {
    io.stderr("permit: --update-baseline needs --baseline <file>\n");
    return 2;
  }
  if (args.paths.length === 0) {
    io.stderr("permit: no paths given\n");
    io.stderr(HELP);
    return 2;
  }

  let files: string[];
  try {
    files = discover(args.paths, { exclude: args.exclude });
  } catch (e) {
    io.stderr(`permit: ${(e as Error).message}\n`);
    return 2;
  }

  const cwd = io.cwd ?? process.cwd();
  const today = args.today ?? new Date().toISOString().slice(0, 10);

  let policy: Policy;
  let policyDir: string;
  const policyFile = args.policy ? path.resolve(args.policy) : findPolicyFile(commonAncestor(args.paths));
  if (policyFile === null) {
    io.stderr("permit: no permit.policy found; denying everything\n");
    policy = DENY_ALL;
    policyDir = cwd;
  } else {
    let source: string;
    try {
      source = fs.readFileSync(policyFile, "utf8");
    } catch {
      io.stderr(`permit: policy not found: ${args.policy ?? policyFile}\n`);
      return 2;
    }
    const shown = path.relative(cwd, policyFile) || policyFile;
    try {
      policy = compile(parsePolicy(source, shown), { today });
    } catch (e) {
      if (e instanceof PolicyError) {
        io.stderr(`permit: ${e.message}\n`);
        return 2;
      }
      throw e;
    }
    policyDir = path.dirname(policyFile);
  }

  const syntaxErrors: ParseError[] = [];
  const uses: CapabilityUse[] = [];
  for (const file of files) {
    const parsed = parseFile(file);
    const shown = path.relative(cwd, file) || ".";
    if (parsed.errors.length > 0) {
      syntaxErrors.push(...parsed.errors.map((e) => ({ ...e, file: shown })));
      continue;
    }
    uses.push(...extract(parsed).map((u) => ({ ...u, file: shown })));
  }

  for (const e of syntaxErrors) {
    io.stderr(`${e.file}:${e.line}:${e.column}: syntax error: ${e.message}\n`);
  }
  if (syntaxErrors.length > 0) {
    return 2;
  }

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
      changed = changedLines(args.changedSince, commonAncestor(args.paths));
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
    default:
      io.stdout(text(decisions, { files: files.length }, { warnings: policy.warnings }));
  }
  if (baselineNote) io.stderr(baselineNote);

  const denied = decisions.some((d) => d.verdict === "denied");
  return denied && !args.exitZero && !args.updateBaseline ? 1 : 0;
}
