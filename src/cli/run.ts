import { HELP, parseArgs, UsageError } from "./args.js";
import { VERSION } from "../version.js";

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

/**
 * Run the CLI against argv (without node and script name). Returns the exit
 * code instead of calling process.exit so tests can drive it directly.
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
  io.stderr("permit: nothing to do yet\n");
  return 2;
}
