import type { Decision } from "../policy/index.js";

export interface Totals {
  files: number;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Default human-readable output. One line per denial, unknowns in their own section, then a summary. */
export function text(decisions: readonly Decision[], totals: Totals): string {
  const denied = decisions.filter((d) => d.verdict === "denied");
  const unknown = decisions.filter((d) => d.verdict === "unknown");
  const lines: string[] = [];

  for (const { use, rule } of denied) {
    lines.push(`${use.file}:${use.line}:${use.column}: ${use.capability} denied by "${rule}": ${use.expression}`);
  }
  if (unknown.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("unknown (not failing the build):");
    for (const { use } of unknown) {
      lines.push(`${use.file}:${use.line}:${use.column}: ${use.capability} ${use.confidence}: ${use.expression}`);
    }
  }
  if (lines.length > 0) lines.push("");
  lines.push(`${plural(totals.files, "file")}, ${denied.length} denied, ${unknown.length} unknown`);
  return lines.join("\n") + "\n";
}
