import type { CapabilityUse } from "../extract/capability.js";
import { matchesGlob } from "./glob.js";
import type { ParsedPolicy, Rule } from "./parse.js";

export type Reason = "granted" | "forbidden" | "expired" | "not granted" | "unknown destination";

export interface Evaluation {
  verdict: "allowed" | "denied";
  reason: Reason;
  /** The rule that decided it; null when nothing in the policy applied. */
  rule: Rule | null;
}

export interface Policy {
  name: string;
  file: string;
  rules: readonly Rule[];
  /** Grants that expire within the warning window, as printable lines. */
  warnings: readonly string[];
  /** `use.file` must be relative to the policy file's directory. */
  evaluate(use: CapabilityUse): Evaluation;
}

export interface CompileOptions {
  /** ISO date, YYYY-MM-DD. Injected so runs are reproducible and testable. */
  today: string;
  /** Days before expiry at which a grant starts warning. Default 14. */
  warnDays?: number;
}

export function compile(parsed: ParsedPolicy, opts: CompileOptions): Policy {
  const warnDays = opts.warnDays ?? 14;
  const forbids = parsed.rules.filter((r) => r.verb === "forbid" && r.capability !== "*");
  const grants = parsed.rules.filter((r) => r.verb === "may");

  const warnings: string[] = [];
  for (const r of grants) {
    if (r.until === null) continue;
    const days = daysBetween(opts.today, r.until);
    if (days < 0 || days > warnDays) continue;
    const when = days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`;
    warnings.push(`${parsed.file} line ${r.line}: "${r.text}" expires ${when}`);
  }

  return {
    name: parsed.name,
    file: parsed.file,
    rules: parsed.rules,
    warnings,
    evaluate(use) {
      const inScope = (r: Rule): boolean =>
        matchesCapability(r.capability, use.capability) &&
        (r.paths.length === 0 || r.paths.some((p) => matchesGlob(p, use.file)));
      // A host list matches a known destination by pattern. An unknown
      // destination cannot be shown to match, so a forbid does not fire on
      // it and a grant does not cover it.
      const hostMatches = (r: Rule): boolean =>
        r.hosts.length === 0 || (use.target !== null && r.hosts.some((h) => matchesHost(h, use.target!)));

      const forbid = forbids.find((r) => inScope(r) && hostMatches(r));
      if (forbid) return { verdict: "denied", reason: "forbidden", rule: forbid };

      let expired: Rule | null = null;
      let hostListed: Rule | null = null;
      for (const g of grants) {
        if (!inScope(g)) continue;
        if (g.until !== null && daysBetween(opts.today, g.until) < 0) {
          expired ??= g;
          continue;
        }
        if (!hostMatches(g)) {
          if (use.target === null) hostListed ??= g;
          continue;
        }
        return { verdict: "allowed", reason: "granted", rule: g };
      }
      if (hostListed) return { verdict: "denied", reason: "unknown destination", rule: hostListed };
      if (expired) return { verdict: "denied", reason: "expired", rule: expired };
      return { verdict: "denied", reason: "not granted", rule: null };
    },
  };
}

/** "*" matches all; a family matches itself and its members; a code matches exactly. */
export function matchesCapability(pattern: string, capability: string): boolean {
  return pattern === "*" || pattern === capability || capability.startsWith(pattern + ".");
}

/** Host patterns: `*` spans any characters including dots; the match is whole-host and case-insensitive. */
export function matchesHost(pattern: string, host: string): boolean {
  const rx =
    "^" +
    pattern
      .toLowerCase()
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*") +
    "$";
  return new RegExp(rx).test(host.toLowerCase());
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(...ymd(to)) - Date.UTC(...ymd(from));
  return Math.round(ms / 86_400_000);
}

function ymd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return [y, m - 1, d];
}
