export interface ParsedArgs {
  version: boolean;
  help: boolean;
  exclude: string[];
  exitZero: boolean;
  policy: string | null;
  today: string | null;
  minConfidence: "certain" | "probable" | "possible" | null;
  baseline: string | null;
  updateBaseline: boolean;
  changedSince: string | null;
  paths: string[];
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    version: false,
    help: false,
    exclude: [],
    exitZero: false,
    policy: null,
    today: null,
    minConfidence: null,
    baseline: null,
    updateBaseline: false,
    changedSince: null,
    paths: [],
  };
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
      case "--exit-zero":
        out.exitZero = true;
        break;
      case "--policy":
        out.policy = takeValue();
        break;
      case "--min-confidence": {
        const v = takeValue();
        if (v !== "certain" && v !== "probable" && v !== "possible") {
          throw new UsageError("--min-confidence must be certain, probable or possible");
        }
        out.minConfidence = v;
        break;
      }
      case "--baseline":
        out.baseline = takeValue();
        break;
      case "--update-baseline":
        out.updateBaseline = true;
        break;
      case "--changed-since":
        out.changedSince = takeValue();
        break;
      case "--today": {
        const v = takeValue();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UsageError("--today needs a date like 2026-12-01");
        out.today = v;
        break;
      }
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
  --exit-zero          report findings but always exit 0
  --policy <file>      use this policy instead of searching for permit.policy
  --today <date>       treat this YYYY-MM-DD as today when checking expiry
  --min-confidence <c> lowest confidence that can fail the build:
                       certain, probable (default) or possible; uses below
                       it are listed as unknown
  --baseline <file>    denials recorded in this file do not fail the build
  --update-baseline    write every current denial into the baseline file
                       and exit 0; use once to adopt permit on a codebase
  --changed-since <ref>  fail only on uses in lines changed since the git
                       ref (e.g. origin/main); untracked files count whole

policy:
  permit.policy is searched for in the directory shared by all the given
  paths, then in each parent directory. The nearest one wins. Path globs in
  a policy are relative to the policy file's directory. With no policy, every
  capability is denied.

exit codes:
  0  no denied capability uses
  1  at least one denied capability use
  2  usage or input error (bad flag, missing path, syntax error)
`;
