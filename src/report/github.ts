/**
 * GitHub Actions workflow commands. Each denial becomes an inline
 * annotation on the pull request; unknown uses become warnings. The text
 * summary follows so the job log still reads on its own.
 */
import type { Decision } from "../policy/index.js";
import { denialText, text, type Totals, type TextOptions } from "./text.js";

/** Escape per the workflow-command rules: % first, then newlines; commas and colons only in properties. */
function data(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function prop(s: string): string {
  return data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function github(decisions: readonly Decision[], totals: Totals, opts: TextOptions = {}): string {
  const lines: string[] = [];
  for (const d of decisions) {
    if (d.verdict !== "denied" && d.verdict !== "unknown") continue;
    const { use } = d;
    const kind = d.verdict === "denied" ? "error" : "warning";
    const title =
      d.verdict === "denied" ? `permit: ${use.capability} denied` : `permit: ${use.capability} ${use.confidence}`;
    const message =
      d.verdict === "denied"
        ? `${use.capability} ${denialText(d)}: ${use.expression}`
        : `${use.capability} ${use.confidence} (not failing the build): ${use.expression}`;
    lines.push(
      `::${kind} file=${prop(use.file)},line=${use.line},col=${use.column},title=${prop(title)}::${data(message)}`,
    );
  }
  for (const w of opts.warnings ?? []) lines.push(`::warning title=${prop("permit: grant expiring")}::${data(w)}`);
  const body = lines.length ? lines.join("\n") + "\n" : "";
  return body + text(decisions, totals, opts);
}
