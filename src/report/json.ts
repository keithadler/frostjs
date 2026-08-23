/**
 * JSON output. The schema is versioned; bump SCHEMA_VERSION on any
 * incompatible change and say so in the changelog.
 */
import type { Decision } from "../policy/index.js";
import type { Policy } from "../policy/compile.js";
import { VERSION } from "../version.js";

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

export interface JsonReport {
  schema: number;
  permit: string;
  policy: { file: string; name: string };
  files: number;
  summary: Record<string, number>;
  warnings: string[];
  decisions: JsonDecision[];
}

export function buildJson(decisions: readonly Decision[], files: number, policy: Policy): JsonReport {
  const summary: Record<string, number> = {
    allowed: 0,
    denied: 0,
    unknown: 0,
    suppressed: 0,
    baselined: 0,
    unchanged: 0,
  };
  for (const d of decisions) summary[d.verdict] = (summary[d.verdict] ?? 0) + 1;
  return {
    schema: SCHEMA_VERSION,
    permit: VERSION,
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

export function json(decisions: readonly Decision[], files: number, policy: Policy): string {
  return JSON.stringify(buildJson(decisions, files, policy), null, 2) + "\n";
}
