import { HELP, parseArgs, UsageError } from "./args.js";
import { VERSION } from "../version.js";
import { discover } from "../discover/index.js";
import { parseFile, type ParseError } from "../extract/ast.js";

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
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

  const syntaxErrors: ParseError[] = [];
  for (const file of files) {
    const parsed = parseFile(file);
    syntaxErrors.push(...parsed.errors);
  }

  for (const e of syntaxErrors) {
    io.stderr(`${e.file}:${e.line}:${e.column}: syntax error: ${e.message}\n`);
  }
  if (syntaxErrors.length > 0) {
    return 2;
  }

  io.stdout(`${files.length} ${files.length === 1 ? "file" : "files"} parsed, 0 findings\n`);
  return 0;
}
