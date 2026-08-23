/**
 * A plain-English reading of a policy for someone who does not write
 * JavaScript. Says what the code may do, what it may not, and that
 * everything else is denied, which the policy file leaves implicit.
 */
import type { Policy } from "../policy/compile.js";
import type { Rule } from "../policy/parse.js";
import { CAPABILITY_PHRASES, FAMILIES } from "../policy/vocabulary.js";

/** The friendliest phrase for a code: the first vocabulary entry that maps to it. */
export function phraseFor(code: string): string {
  if (code === "*") return "everything";
  for (const [phrase, c] of CAPABILITY_PHRASES) if (c === code) return phrase;
  return code;
}

function describe(r: Rule, today: string): string {
  const parts: string[] = [];
  if (r.hosts.length > 0)
    parts.push(`reach ${r.hosts.map((h) => (h === "same-origin" ? "its own origin" : h)).join(", ")}`);
  else parts.push(`use ${phraseFor(r.capability)}`);
  if (r.paths.length > 0) parts.push(`only in ${r.paths.join(", ")}`);
  if (r.until !== null) parts.push(r.until < today ? `expired ${r.until}` : `until ${r.until}`);
  let s = parts.join(", ");
  s += ` (line ${r.line})`;
  if (r.hint) s += ` - ${r.hint}`;
  return s;
}

export function summary(policy: Policy, today: string): string {
  const lines: string[] = [];
  lines.push(`Policy "${policy.name}" (${policy.file})`);
  lines.push("");

  const may = policy.rules.filter((r) => r.verb === "may");
  const forbid = policy.rules.filter((r) => r.verb === "forbid" && r.capability !== "*");

  lines.push("This code may:");
  if (may.length === 0) lines.push("  - nothing; every capability is denied");
  for (const r of may) lines.push(`  - ${describe(r, today)}`);
  lines.push("");

  if (forbid.length > 0) {
    lines.push("It may not, even where a broader grant would allow it:");
    for (const r of forbid) lines.push(`  - ${describe(r, today)}`);
    lines.push("");
  }

  const granted = new Set(may.map((r) => (r.capability === "*" ? "*" : r.capability.split(".")[0]!)));
  const untouched = granted.has("*") ? [] : FAMILIES.filter((f) => !granted.has(f));
  if (untouched.length > 0) {
    lines.push(
      `Everything else is denied. In particular this code may not use: ${untouched.map(phraseFor).join(", ")}.`,
    );
  } else {
    lines.push("Everything not listed above is denied.");
  }
  for (const w of policy.warnings) lines.push(`Warning: ${w}`);
  return lines.join("\n") + "\n";
}
