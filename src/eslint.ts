/**
 * ESLint plugin. One rule, `frostjs/capability`, runs the same engine the
 * CLI does on each file ESLint hands it: frostjs's own parse, extraction,
 * policy discovery (nearest frostjs.policy above the file) and decision.
 * Reports are ESLint problems at the use's position, so they show in
 * editors and `eslint-disable` comments work alongside `frostjs: ignore`.
 *
 *   import frostjs from "frostjs/eslint";
 *   export default [{ plugins: { frostjs }, rules: { "frostjs/capability": "error" } }];
 */
import fs from "node:fs";
import path from "node:path";
import { parseSource } from "./extract/ast.js";
import { extract } from "./extract/index.js";
import {
  compilePolicyFile,
  decide,
  findPolicyFile,
  isoToday,
  matchesGlob,
  DENY_ALL,
  PolicyError,
  type Confidence,
  type Policy,
} from "./policy/index.js";
import { denialText, describeUse } from "./report/text.js";
import { VERSION } from "./version.js";

/** Options for the `frostjs/capability` rule, all optional. */
export interface RuleOptions {
  /** Explicit policy file; otherwise the nearest frostjs.policy above the linted file. */
  policy?: string;
  /** Lowest confidence that is reported as an error; default probable. */
  minConfidence?: Confidence;
  /** Also report uses below the floor, as they appear under "unknown" in the CLI. */
  reportUnknown?: boolean;
  /** ISO date for expiry checks; defaults to today. */
  today?: string;
}

/** The slice of ESLint's RuleContext this rule needs, typed here so eslint is not a dependency. */
interface Context {
  filename?: string;
  getFilename?: () => string;
  sourceCode?: { text: string };
  getSourceCode?: () => { text: string };
  options: unknown[];
  report: (descriptor: { message: string; loc: { line: number; column: number } }) => void;
}

interface Cached {
  policy: Policy;
  mtimeMs: number;
}

const cache = new Map<string, Cached>();

/** The policy for a file, cached by mtime so edits are picked up without restarting ESLint. */
function loadPolicy(file: string, today: string, explicit?: string): { policy: Policy; dir: string; error?: string } {
  const policyFile = explicit ? path.resolve(explicit) : findPolicyFile(path.dirname(file));
  if (policyFile === null) return { policy: DENY_ALL, dir: path.dirname(file) };
  const dir = path.dirname(policyFile);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(policyFile).mtimeMs;
  } catch {
    return { policy: DENY_ALL, dir, error: `cannot read policy ${policyFile}` };
  }
  const hit = cache.get(policyFile);
  if (hit && hit.mtimeMs === mtimeMs && hit.policy.today === today) return { policy: hit.policy, dir };
  try {
    const policy = compilePolicyFile(policyFile, today);
    cache.set(policyFile, { policy, mtimeMs });
    return { policy, dir };
  } catch (e) {
    if (e instanceof PolicyError || e instanceof Error) return { policy: DENY_ALL, dir, error: e.message };
    throw e;
  }
}

/** The `frostjs/capability` rule. See RuleOptions. */
export const capabilityRule = {
  meta: {
    type: "problem",
    docs: { description: "Deny capability uses the frostjs policy has not granted", recommended: true },
    schema: [
      {
        type: "object",
        properties: {
          policy: { type: "string" },
          minConfidence: { enum: ["certain", "probable", "possible"] },
          reportUnknown: { type: "boolean" },
          today: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context: Context) {
    return {
      Program() {
        const filename = context.filename ?? context.getFilename?.() ?? "<input>";
        const text = context.sourceCode?.text ?? context.getSourceCode?.().text ?? "";
        const opts = (context.options[0] ?? {}) as RuleOptions;
        const today = opts.today ?? isoToday();
        const file = path.resolve(filename);

        const { policy, dir, error } = loadPolicy(file, today, opts.policy);
        if (error) {
          context.report({ message: `frostjs: ${error.split("\n")[0]}`, loc: { line: 1, column: 0 } });
          return;
        }

        if (policy.ignore.some((g) => matchesGlob(g, path.relative(dir, file)))) return;
        const parsed = parseSource(file, text);
        if (parsed.errors.length > 0) return; // ESLint's own parser will have complained already
        const decisions = decide(extract(parsed), policy, {
          scopePath: (u) => path.relative(dir, u.file),
          ...(opts.minConfidence ? { minConfidence: opts.minConfidence } : {}),
        });
        for (const d of decisions) {
          const { use } = d;
          const loc = { line: use.line, column: use.column - 1 };
          const subject = describeUse(use.capability, use.target);
          if (d.verdict === "denied") {
            context.report({ message: `${subject} ${denialText(d)}`, loc });
          } else if (d.verdict === "unknown" && opts.reportUnknown) {
            context.report({ message: `${subject} ${use.confidence} (not failing the build)`, loc });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "frostjs", version: VERSION },
  rules: { capability: capabilityRule },
  configs: {} as Record<string, unknown>,
};

plugin.configs["recommended"] = {
  plugins: { frostjs: plugin },
  rules: { "frostjs/capability": "error" },
};

export default plugin;
