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
  const decisions = decide(uses, policy, {
    scopePath: (u) => path.relative(policyDir, path.resolve(cwd, u.file)),
    ...(args.minConfidence ? { minConfidence: args.minConfidence } : {}),
  });
  io.stdout(text(decisions, { files: files.length }, { warnings: policy.warnings }));

  const denied = decisions.some((d) => d.verdict === "denied");
  return denied && !args.exitZero ? 1 : 0;
}
