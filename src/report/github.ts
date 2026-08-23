/**
 * GitHub Actions workflow commands. Each denial becomes an inline
 * annotation on the pull request; unknown uses become warnings. The text
 * summary follows so the job log still reads on its own.
 */
import type { Decision } from "../policy/index.js";
import { denialMessage, describeUse, text, type Totals, type TextOptions } from "./text.js";

/** Escape a message per the workflow-command rules: % first, then newlines. */
function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
/** Escape a property value: as a message, plus colons and commas. */
function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** `--format github`: one workflow command per denial or unknown use, then the text report. */
export function github(decisions: readonly Decision[], totals: Totals, opts: TextOptions = {}): string {
  const lines: string[] = [];
  for (const d of decisions) {
    if (d.verdict !== "denied" && d.verdict !== "unknown") continue;
    const { use } = d;
    const subject = describeUse(use.capability, use.target);
    const kind = d.verdict === "denied" ? "error" : "warning";
    const title =
      d.verdict === "denied" ? `permit: ${use.capability} denied` : `permit: ${use.capability} ${use.confidence}`;
    const message =
      d.verdict === "denied"
        ? denialMessage(d)
        : `${subject} ${use.confidence} (not failing the build): ${use.expression}`;
    lines.push(
      `::${kind} file=${escapeProperty(use.file)},line=${use.line},col=${use.column},title=${escapeProperty(title)}::${escapeData(message)}`,
    );
  }
  for (const w of opts.warnings ?? []) {
    lines.push(`::warning title=${escapeProperty("permit: grant expiring")}::${escapeData(w)}`);
  }
  const body = lines.length ? lines.join("\n") + "\n" : "";
  return body + text(decisions, totals, opts);
}
