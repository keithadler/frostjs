import type { Decision } from "../policy/index.js";

export interface Totals {
  files: number;
}

export interface TextOptions {
  /** Expiry warnings from the compiled policy, printed before the summary. */
  warnings?: readonly string[];
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why a use was denied, in the words of the policy line that did it. */
export function denialText(d: Decision): string {
  const { rule, reason } = d;
  if (rule === null || reason === "not granted") return 'denied by "deny everything"';
  const where = `${rule.text}" (line ${rule.line})`;
  const hint = rule.hint ? `: ${rule.hint}` : "";
  if (reason === "expired") return `denied, grant expired ${rule.until}: "${where}${hint}`;
  if (reason === "unknown destination") return `denied, destination cannot be read and "${where} names hosts${hint}`;
  return `denied by "${where}${hint}`;
}

/** The capability plus its destination when one is known. */
function what(d: Decision): string {
  const { capability, target } = d.use;
  return target !== null && target !== "same-origin" ? `${capability} to ${target}` : capability;
}

/** Default human-readable output. One line per denial, unknowns in their own section, then a summary. */
export function text(decisions: readonly Decision[], totals: Totals, opts: TextOptions = {}): string {
  const denied = decisions.filter((d) => d.verdict === "denied");
  const unknown = decisions.filter((d) => d.verdict === "unknown");
  const suppressed = decisions.filter((d) => d.verdict === "suppressed").length;
  const lines: string[] = [];

  for (const d of denied) {
    const { use } = d;
    lines.push(`${use.file}:${use.line}:${use.column}: ${what(d)} ${denialText(d)}: ${use.expression}`);
  }
  if (unknown.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("unknown (not failing the build):");
    for (const { use } of unknown) {
      lines.push(`${use.file}:${use.line}:${use.column}: ${use.capability} ${use.confidence}: ${use.expression}`);
    }
  }
  for (const w of opts.warnings ?? []) {
    if (lines.length > 0 && !lines[lines.length - 1]!.startsWith("warning:")) lines.push("");
    lines.push(`warning: ${w}`);
  }
  if (lines.length > 0) lines.push("");
  lines.push(
    `${plural(totals.files, "file")}, ${denied.length} denied, ${unknown.length} unknown` +
      (suppressed > 0 ? `, ${suppressed} suppressed` : ""),
  );
  return lines.join("\n") + "\n";
}
