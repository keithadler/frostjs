/**
 * JSON output. The schema is versioned; bump SCHEMA_VERSION on any
 * incompatible change and say so in the changelog.
 */
import type { Decision, Policy, Verdict } from "../policy/index.js";
import { VERSION } from "../version.js";

/** Bumped on any incompatible change to JsonReport. */
export const SCHEMA_VERSION = 1;

export interface JsonRule {
  line: number;
  text: string;
  hint: string;
}

export interface JsonDecision {
  file: string;
  line: number;
  column: number;
  capability: string;
  target: string | null;
  expression: string;
  confidence: string;
  verdict: string;
  reason: string | null;
  rule: JsonRule | null;
}

/** The document `--format json` prints. `schema` is SCHEMA_VERSION; `frostjs` is the tool version. */
export interface JsonReport {
  schema: number;
  frostjs: string;
  policy: { file: string; name: string };
  /** Files analyzed. */
  files: number;
  /** Count of decisions by verdict. */
  summary: Record<Verdict, number>;
  /** Expiry warnings from the policy. */
  warnings: string[];
  /** Every use, including allowed ones. */
  decisions: JsonDecision[];
}

function buildJson(decisions: readonly Decision[], files: number, policy: Policy): JsonReport {
  const summary: Record<Verdict, number> = {
    allowed: 0,
    denied: 0,
    unknown: 0,
    suppressed: 0,
    baselined: 0,
    unchanged: 0,
  };
  for (const d of decisions) summary[d.verdict]++;
  return {
    schema: SCHEMA_VERSION,
    frostjs: VERSION,
    policy: { file: policy.file, name: policy.name },
    files,
    summary,
    warnings: [...policy.warnings],
    decisions: decisions.map((d) => ({
      file: d.use.file,
      line: d.use.line,
      column: d.use.column,
      capability: d.use.capability,
      target: d.use.target,
      expression: d.use.expression,
      confidence: d.use.confidence,
      verdict: d.verdict,
      reason: d.reason,
      rule: d.rule ? { line: d.rule.line, text: d.rule.text, hint: d.rule.hint } : null,
    })),
  };
}

/** `--format json`: the JsonReport, pretty-printed. */
export function json(decisions: readonly Decision[], files: number, policy: Policy): string {
  return JSON.stringify(buildJson(decisions, files, policy), null, 2) + "\n";
}
