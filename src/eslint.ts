/**
 * ESLint plugin. One rule, `permit/capability`, runs the same engine the
 * CLI does on each file ESLint hands it: permit's own parse, extraction,
 * policy discovery (nearest permit.policy above the file) and decision.
 * Reports are ESLint problems at the use's position, so they show in
 * editors and `eslint-disable` comments work alongside `permit: ignore`.
 *
 *   import permit from "permit/eslint";
 *   export default [{ plugins: { permit }, rules: { "permit/capability": "error" } }];
 */
import fs from "node:fs";
import path from "node:path";
import { parseSource } from "./extract/ast.js";
import { extract } from "./extract/index.js";
import { compile, decide, parsePolicy, DENY_ALL, PolicyError, type Policy } from "./policy/index.js";
import { findPolicyFile } from "./policy/config.js";
import { denialText } from "./report/text.js";
import { VERSION } from "./version.js";

interface RuleOptions {
  /** Explicit policy file; otherwise the nearest permit.policy above the linted file. */
  policy?: string;
  minConfidence?: "certain" | "probable" | "possible";
  /** Also report uses below the confidence floor, as they appear under "unknown" in the CLI. */
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
  dir: string;
  mtimeMs: number;
  today: string;
}

const cache = new Map<string, Cached>();

function loadPolicy(file: string, today: string, explicit?: string): { policy: Policy; dir: string; error?: string } {
  const policyFile = explicit ? path.resolve(explicit) : findPolicyFile(path.dirname(file));
  if (policyFile === null) return { policy: DENY_ALL, dir: path.dirname(file) };
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(policyFile).mtimeMs;
  } catch {
    return { policy: DENY_ALL, dir: path.dirname(policyFile), error: `policy not found: ${policyFile}` };
  }
  const hit = cache.get(policyFile);
  if (hit && hit.mtimeMs === mtimeMs && hit.today === today) return { policy: hit.policy, dir: hit.dir };
  try {
    const policy = compile(parsePolicy(fs.readFileSync(policyFile, "utf8"), policyFile), { today });
    const dir = path.dirname(policyFile);
    cache.set(policyFile, { policy, dir, mtimeMs, today });
    return { policy, dir };
  } catch (e) {
    if (e instanceof PolicyError) return { policy: DENY_ALL, dir: path.dirname(policyFile), error: e.message };
    throw e;
  }
}

export const capabilityRule = {
  meta: {
    type: "problem",
    docs: { description: "Deny capability uses the permit policy has not granted", recommended: true },
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
        const today = opts.today ?? new Date().toISOString().slice(0, 10);
        const file = path.resolve(filename);

        const { policy, dir, error } = loadPolicy(file, today, opts.policy);
        if (error) {
          context.report({ message: `permit: ${error.split("\n")[0]}`, loc: { line: 1, column: 0 } });
          return;
        }

        const parsed = parseSource(file, text);
        if (parsed.errors.length > 0) return; // ESLint's own parser will have complained already
        const uses = extract(parsed);
        const decisions = decide(uses, policy, {
          scopePath: (u) => path.relative(dir, u.file),
          ...(opts.minConfidence ? { minConfidence: opts.minConfidence } : {}),
        });
        for (const d of decisions) {
          const { use } = d;
          const loc = { line: use.line, column: use.column - 1 };
          if (d.verdict === "denied") {
            const target = use.target !== null && use.target !== "same-origin" ? ` to ${use.target}` : "";
            context.report({ message: `${use.capability}${target} ${denialText(d)}`, loc });
          } else if (d.verdict === "unknown" && opts.reportUnknown) {
            context.report({ message: `${use.capability} ${use.confidence} (not failing the build)`, loc });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "permit", version: VERSION },
  rules: { capability: capabilityRule },
  configs: {} as Record<string, unknown>,
};

plugin.configs["recommended"] = {
  plugins: { permit: plugin },
  rules: { "permit/capability": "error" },
};

export default plugin;
