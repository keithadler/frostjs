export interface ParsedArgs {
  version: boolean;
  help: boolean;
  paths: string[];
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { version: false, help: false, paths: [] };
  let positionalOnly = false;
  for (const arg of argv) {
    if (positionalOnly) {
      out.paths.push(arg);
      continue;
    }
    switch (arg) {
      case "--":
        positionalOnly = true;
        break;
      case "--version":
      case "-V":
        out.version = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new UsageError(`unknown option: ${arg}`);
        }
        out.paths.push(arg);
    }
  }
  return out;
}

export const HELP = `usage: permit [options] [paths...]

Deny-by-default capability linter for JavaScript.

options:
  -h, --help       show this help and exit
  -V, --version    print the version and exit
`;
