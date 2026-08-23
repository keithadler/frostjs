export interface ParsedArgs {
  version: boolean;
  help: boolean;
  exclude: string[];
  paths: string[];
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { version: false, help: false, exclude: [], paths: [] };
  let positionalOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (positionalOnly) {
      out.paths.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const takeValue = (): string => {
      if (eq > 0 && arg.startsWith("--")) return arg.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined) throw new UsageError(`${name} requires a value`);
      return next;
    };
    switch (name) {
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
      case "--exclude":
        out.exclude.push(takeValue());
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

export const HELP = `usage: permit [options] <paths...>

Deny-by-default capability linter for JavaScript.

options:
  -h, --help           show this help and exit
  -V, --version        print the version and exit
  --exclude <name>     skip directories with this name (repeatable);
                       node_modules, dist, build, coverage and .git are
                       always skipped
`;
