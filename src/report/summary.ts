/**
 * A plain-English reading of a policy for someone who does not write
 * JavaScript. Says what the code may do, what it may not, and that
 * everything else is denied, which the policy file leaves implicit.
 */
import { isExpired, type Policy, type Rule } from "../policy/index.js";
import { CAPABILITY_PHRASES, FAMILIES } from "../policy/vocabulary.js";
import { SAME_ORIGIN } from "../extract/target.js";

/** The friendliest phrase for a code: the first vocabulary entry that maps to it. */
function phraseFor(code: string): string {
  if (code === "*") return "everything";
  for (const [phrase, c] of CAPABILITY_PHRASES) if (c === code) return phrase;
  return code;
}

function describe(r: Rule, today: string): string {
  const parts: string[] = [];
  if (r.hosts.length > 0) {
    parts.push(`reach ${r.hosts.map((h) => (h === SAME_ORIGIN ? "its own origin" : h)).join(", ")}`);
  } else parts.push(`use ${phraseFor(r.capability)}`);
  if (r.paths.length > 0) parts.push(`only in ${r.paths.join(", ")}`);
  if (r.until !== null) parts.push(isExpired(r, today) ? `expired ${r.until}` : `until ${r.until}`);
  let s = parts.join(", ");
  s += ` (line ${r.line})`;
  if (r.hint) s += ` - ${r.hint}`;
  return s;
}

/** The plain-English reading of a policy, for the date it was compiled against. */
export function summary(policy: Policy): string {
  const { today } = policy;
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
