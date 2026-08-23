/**
 * `frostjs init`: write a starter policy that grants exactly what the code
 * does today, so the first run passes and every later change is a
 * visible decision. The generated file is meant to be read and pruned:
 * each grant says where it is used, a capability used in only a few files
 * is scoped to them, and an unreadable network destination is called out
 * rather than quietly widened to the whole network.
 */
import path from "node:path";
import type { CapabilityUse } from "./extract/capability.js";
import { CAPABILITY_PHRASES } from "./policy/vocabulary.js";

/** Scope a grant to its files when it is used in no more than this many. */
const SCOPE_UP_TO = 3;

/** The friendliest phrase for a code, else the code. */
function phraseFor(code: string): string {
  for (const [phrase, c] of CAPABILITY_PHRASES) if (c === code) return phrase;
  return code;
}

function where(files: readonly string[]): string {
  const shown = files.slice(0, SCOPE_UP_TO);
  const more = files.length - shown.length;
  return `used in ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

function scope(files: readonly string[]): string {
  return files.length <= SCOPE_UP_TO ? ` in ${files.map((f) => `"${f}"`).join(", ")}` : "";
}

/**
 * The text of a starter policy for these uses. `uses` carry paths relative
 * to the directory the policy will live in. Only certain and probable uses
 * count; possible ones never fail a build and are left for the person.
 */
export function starterPolicy(name: string, uses: readonly CapabilityUse[], today: string): string {
  const counted = uses.filter((u) => u.confidence !== "possible" && !u.suppressed);
  const lines: string[] = [
    `policy "${name}"`,
    `-- Written by frostjs init on ${today} from what the code does today.`,
    "-- Every line below is a grant. Delete the ones that should not be",
    "-- allowed and the build will start refusing them. Add an expiry",
    "-- (until YYYY-MM-DD) to anything that is meant to go away.",
    "",
  ];

  // Network: known destinations become `may reach`; anything unreadable
  // needs `may use the network`, which the hint says how to narrow.
  const net = counted.filter((u) => u.capability.startsWith("network."));
  if (net.length > 0) {
    const hosts = [...new Set(net.map((u) => u.target).filter((t): t is string => t !== null))].sort();
    const unknown = net.filter((u) => u.target === null);
    const netFiles = [...new Set(net.map((u) => u.file))].sort();
    if (unknown.length === 0) {
      lines.push(`may reach ${hosts.map((h) => `"${h}"`).join(", ")}${scope(netFiles)}   -- ${where(netFiles)}`);
    } else {
      const hint = `${unknown.length} ${unknown.length === 1 ? "use" : "uses"} whose destination cannot be read; narrow this to: may reach ${hosts.length ? hosts.map((h) => `"${h}"`).join(", ") : '"host"'}`;
      lines.push(`may use the network${scope(netFiles)}   -- ${hint}`);
    }
  }

  // Everything else: one grant per member code, scoped when used in few files.
  const byCode = new Map<string, Set<string>>();
  for (const u of counted) {
    if (u.capability.startsWith("network.")) continue;
    if (!byCode.has(u.capability)) byCode.set(u.capability, new Set());
    byCode.get(u.capability)!.add(u.file);
  }
  for (const [code, fileSet] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const files = [...fileSet].sort();
    lines.push(`may use ${phraseFor(code)}${scope(files)}   -- ${where(files)}`);
  }

  if (lines.length === 6)
    lines.push("-- Nothing found: the code uses no capability frostjs recognizes. Every grant is off.");
  return lines.join("\n") + "\n";
}

/** A policy name from the directory it lives in. */
export function policyNameFor(dir: string): string {
  return path.basename(path.resolve(dir)) || "project";
}
