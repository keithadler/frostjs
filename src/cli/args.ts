/**
 * Command-line parsing and the help text. Every flag here has a usage line
 * in the README and a test; keep the three in step.
 */
import { CONFIDENCE_ORDER, type Confidence } from "../policy/index.js";

/** The subcommand, `check` being the bare `frostjs <paths>` form. */
type Command =
  "check" | "init" | "audit" | "capabilities" | "explain" | "csp" | "summary" | "vendor-add" | "registry-sync" | "sri";

export interface ParsedArgs {
  command: Command;
  version: boolean;
  help: boolean;
  exclude: string[];
  exitZero: boolean;
  policy: string | null;
  today: string | null;
  minConfidence: Confidence | null;
  baseline: string | null;
  updateBaseline: boolean;
  changedSince: string | null;
  taint: boolean;
  unused: boolean;
  format: Format;
  paths: string[];
}

const FORMATS = ["text", "json", "sarif", "github", "html", "md"] as const;
type Format = (typeof FORMATS)[number];

/** A flag or argument the CLI cannot accept; the message is printed with the help text. */
export class UsageError extends Error {}

/**
 * Parse argv (without node and script name). The first token may be a
 * subcommand; `--` ends option parsing; `--name=value` and `--name value`
 * are both accepted. Throws UsageError.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: "check",
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
    taint: false,
    unused: false,
    format: "text",
    paths: [],
  };
  let positionalOnly = false;
  let first = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (first) {
      first = false;
      if (
        arg === "csp" ||
        arg === "summary" ||
        arg === "sri" ||
        arg === "init" ||
        arg === "audit" ||
        arg === "capabilities" ||
        arg === "explain"
      ) {
        out.command = arg;
        continue;
      }
      if (arg === "registry") {
        const sub = argv[i + 1];
        if (sub !== "sync")
          throw new UsageError(`frostjs registry needs a subcommand: sync${sub ? ` (got '${sub}')` : ""}`);
        out.command = "registry-sync";
        i++;
        continue;
      }
      if (arg === "vendor") {
        const sub = argv[i + 1];
        if (sub !== "add")
          throw new UsageError(`frostjs vendor needs a subcommand: add${sub ? ` (got '${sub}')` : ""}`);
        out.command = "vendor-add";
        i++;
        continue;
      }
    }
    if (positionalOnly) {
      out.paths.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const takeValue = (): string => {
      if (eq > 0 && arg.startsWith("--")) return arg.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined) throw new UsageError(`${name} needs a value`);
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
        if (!(CONFIDENCE_ORDER as readonly string[]).includes(v)) {
          throw new UsageError("--min-confidence must be certain, probable or possible");
        }
        out.minConfidence = v as Confidence;
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
      case "--taint":
        out.taint = true;
        break;
      case "--unused":
        out.unused = true;
        break;
      case "--format": {
        const v = takeValue();
        if (!(FORMATS as readonly string[]).includes(v))
          throw new UsageError(`--format must be one of ${FORMATS.join(", ")}`);
        out.format = v as Format;
        break;
      }
      case "--today": {
        const v = takeValue();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UsageError("--today must be a date like 2026-12-01");
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

/** The `--help` text, also printed after a usage error. */
export const HELP = `usage: frostjs [options] <paths...>
       frostjs init [paths...]
       frostjs audit [--format text|json] <paths...>
       frostjs capabilities [--format text|json|md]
       frostjs explain <capability>
       frostjs csp [--policy <file>]
       frostjs summary [--policy <file>]
       frostjs vendor add <files...>
       frostjs registry sync
       frostjs sri [--format text|json|html] [paths...]

Deny-by-default capability linter for JavaScript.

commands:
  (default)            analyze the given paths against the policy
  frostjs capabilities the full capability taxonomy frostjs recognizes and
                       the policy phrase for each; --format text|json|md
  frostjs explain <c>  explain one capability, family, code or phrase: what
                       triggers it and the policy line to allow it
  frostjs audit        what the code does, with no policy: hosts reached,
                       code generation from non-constant input, script
                       injection, service workers, and files where those
                       meet a network reach (a remote code path). Point it
                       at a dependency before adopting it.
  frostjs init         write a starter frostjs.policy in the current
                       directory granting exactly what the code under the
                       paths (default .) does today, with a note on each
                       grant saying where; read it and delete what should
                       not be allowed
  frostjs csp           print the Content-Security-Policy header the policy
                       implies, and nothing else, for the deploy step
  frostjs summary       print a plain-English reading of the policy for a
                       reviewer who does not write JavaScript
  frostjs vendor add    analyze third-party files once, print the capability
                       set found, and record it with the file's SHA-384 in
                       .frostjs/registry.json beside the policy
  frostjs registry sync after a dependency bump: re-admit vendored files
                       whose capability set did not change, refuse and show
                       the difference for those that gained one, prune
                       entries whose file is gone, record the lockfile hash
  frostjs sri           print Subresource Integrity values for registered
                       vendored files (text: path and hash; json: a map;
                       html: script tags), so the browser enforces the same
                       hashes the registry reviewed

options:
  -h, --help           show this help and exit
  -V, --version        print the version and exit
  --exclude <name>     skip directories with this name (repeatable);
                       node_modules, dist, build, coverage and .git are
                       always skipped
  --exit-zero          report findings but always exit 0
  --policy <file>      use this policy instead of searching for frostjs.policy
  --today <date>       treat this YYYY-MM-DD as today when checking expiry
  --min-confidence <c> lowest confidence that can fail the build:
                       certain, probable (default) or possible; uses below
                       it are listed as unknown
  --baseline <file>    denials recorded in this file do not fail the build
  --update-baseline    write every current denial into the baseline file
                       and exit 0; use once to adopt frostjs on a codebase
  --unused             after the check, list policy grants that matched
                       nothing on a full scan, so they can be removed
  --taint              also fail on untrusted input (a URL, cookie, or
                       postMessage) reaching a dangerous sink (eval,
                       innerHTML, importScripts, a redirect); intraprocedural
  --changed-since <ref>  fail only on uses in lines changed since the git
                       ref (e.g. origin/main); untracked files count whole
  --format <f>         text (default), json (versioned schema), sarif
                       (2.1.0, one rule per capability), or github
                       (inline PR annotations followed by the text report);
                       html only with frostjs sri

policy:
  frostjs.policy is searched for in the directory shared by all the given
  paths, then in each parent directory. The nearest one wins. Path globs in
  a policy are relative to the policy file's directory. With no policy, every
  capability is denied.

exit codes:
  0  no denied capability uses
  1  at least one denied capability use
  2  usage or input error (bad flag, missing path, syntax error)
`;
