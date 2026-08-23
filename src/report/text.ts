/**
 * The default, human-readable report, and the wording of a denial that
 * every other format reuses so the same use reads the same everywhere.
 */
import type { Decision } from "../policy/index.js";
import { SAME_ORIGIN } from "../extract/target.js";

export interface Totals {
  /** Files analyzed, for the summary line. */
  files: number;
}

export interface TextOptions {
  /** Expiry warnings from the compiled policy, printed before the summary. */
  warnings?: readonly string[];
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A capability plus its destination when one is known: `network.fetch to api.example.com`. */
export function describeUse(capability: string, target: string | null): string {
  return target !== null && target !== SAME_ORIGIN ? `${capability} to ${target}` : capability;
}

/**
 * Why a use was denied, in the words of the policy line that did it:
 *
 *   denied by default (no rule grants it)
 *   denied by "forbid cookies" (line 4): consent banner owns these
 *   denied (grant expired 2026-08-30) by "may use the cache until 2026-08-30" (line 5)
 *   denied (destination cannot be read) by "may reach "api.example.com"" (line 2), which names hosts
 *
 * An unregistered vendored file has no capability or expression to show,
 * so its whole message is the sentence `vendored file is not in the
 * registry; review it with: permit vendor add lib/x.js`; see denialMessage.
 */
export function denialText(d: Decision): string {
  const { rule, reason, use } = d;
  if (reason === "unregistered")
    return `vendored file is not in the registry; review it with: permit vendor add ${use.file}`;
  if (rule === null) return "denied by default (no rule grants it)";
  const where = `"${rule.text}" (line ${rule.line})`;
  const hint = rule.hint ? `: ${rule.hint}` : "";
  switch (reason) {
    case "expired":
      return `denied (grant expired ${rule.until}) by ${where}${hint}`;
    case "unknown destination":
      return `denied (destination cannot be read) by ${where}, which names hosts${hint}`;
    default:
      return `denied by ${where}${hint}`;
  }
}

/** The message for a denied (or baselined, or unchanged) use, without the position: subject, reason, expression. */
export function denialMessage(d: Decision): string {
  const { use } = d;
  if (d.reason === "unregistered") return denialText(d);
  return `${describeUse(use.capability, use.target)} ${denialText(d)}: ${use.expression}`;
}

/** One report line for a denied (or baselined, or unchanged) use. */
export function denialLine(d: Decision): string {
  const { use } = d;
  return `${use.file}:${use.line}:${use.column}: ${denialMessage(d)}`;
}

/** One report line for a use below the confidence floor. */
export function unknownLine(d: Decision): string {
  const { use } = d;
  return `${use.file}:${use.line}:${use.column}: ${describeUse(use.capability, use.target)} ${use.confidence}: ${use.expression}`;
}

/** One line per denial, unknowns in their own section, warnings, then a summary. */
export function text(decisions: readonly Decision[], totals: Totals, opts: TextOptions = {}): string {
  const denied = decisions.filter((d) => d.verdict === "denied");
  const unknown = decisions.filter((d) => d.verdict === "unknown");
  const count = (verdict: string): number => decisions.filter((d) => d.verdict === verdict).length;
  const warnings = opts.warnings ?? [];
  const lines: string[] = denied.map(denialLine);

  if (unknown.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("unknown (not failing the build):", ...unknown.map(unknownLine));
  }
  if (warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...warnings.map((w) => `warning: ${w}`));
  }
  if (lines.length > 0) lines.push("");

  let summary = `${plural(totals.files, "file")}, ${denied.length} denied, ${unknown.length} unknown`;
  for (const verdict of ["suppressed", "baselined", "unchanged"]) {
    const n = count(verdict);
    if (n > 0) summary += `, ${n} ${verdict}`;
  }
  lines.push(summary);
  return lines.join("\n") + "\n";
}
