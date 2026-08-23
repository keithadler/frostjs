/**
 * Compile a parsed policy into the ruleset the gate runs. Three rules
 * decide everything:
 *
 * - `forbid` always wins over `may`, whatever the order in the file.
 * - A grant with `until` stops granting the day after its date; inside the
 *   warning window it produces a printable warning.
 * - A host list (`may reach`, `forbid reaching`) matches a known
 *   destination by pattern. A destination that cannot be read from the
 *   code cannot be shown to match, so a forbid does not fire on it and a
 *   grant does not cover it: cannot be shown to be allowed is not allowed.
 */
import type { CapabilityUse } from "../extract/capability.js";
import { escapeRegExp, matchesGlob } from "./glob.js";
import { ymd, type ParsedPolicy, type Rule } from "./parse.js";

/**
 * Why a use was allowed or denied. `unregistered` is produced by
 * `decide()` for vendored files the registry does not know, never by
 * `compile()`.
 */
export type Reason =
  "granted" | "forbidden" | "expired" | "not granted" | "unknown destination" | "unregistered" | "tainted";

export interface Evaluation {
  verdict: "allowed" | "denied";
  reason: Reason;
  /** The rule that decided it; null when nothing in the policy applied. */
  rule: Rule | null;
}

export interface Policy {
  name: string;
  file: string;
  /** The date the policy was compiled against, YYYY-MM-DD; expiry and warnings are relative to it. */
  today: string;
  rules: readonly Rule[];
  /** Globs of vendored files, relative to the policy directory. */
  vendored: readonly string[];
  /** The policy asks frostjs check to gate on taint flows. */
  taint: boolean;
  /** Globs of files not analyzed at all, relative to the policy directory. */
  ignore: readonly string[];
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

/** True when a grant's `until` date is before `today`. ISO strings compare correctly. */
export function isExpired(rule: Rule, today: string): boolean {
  return rule.until !== null && rule.until < today;
}

/** Compile a parsed policy against a date. See the module comment for the rules. */
export function compile(parsed: ParsedPolicy, opts: CompileOptions): Policy {
  const { today } = opts;
  const warnDays = opts.warnDays ?? 14;
  const forbids = parsed.rules.filter((r) => r.verb === "forbid" && r.capability !== "*");
  const grants = parsed.rules.filter((r) => r.verb === "may");
  const expired = new Set(grants.filter((r) => isExpired(r, today)));

  const warnings: string[] = [];
  for (const r of grants) {
    if (r.until === null) continue;
    const days = daysBetween(today, r.until);
    if (days < 0 || days > warnDays) continue;
    const when = days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`;
    warnings.push(`${parsed.file} line ${r.line}: "${r.text}" expires ${when}`);
  }

  return {
    name: parsed.name,
    file: parsed.file,
    today,
    rules: parsed.rules,
    vendored: parsed.vendored,
    taint: parsed.taint,
    ignore: parsed.ignore,
    warnings,
    evaluate(use) {
      const target = use.target;
      const inScope = (r: Rule): boolean =>
        matchesCapability(r.capability, use.capability) &&
        (r.paths.length === 0 || r.paths.some((p) => matchesGlob(p, use.file)));
      const hostMatches = (r: Rule): boolean =>
        r.hosts.length === 0 || (target !== null && r.hosts.some((h) => matchesHost(h, target)));

      const forbid = forbids.find((r) => inScope(r) && hostMatches(r));
      if (forbid) return { verdict: "denied", reason: "forbidden", rule: forbid };

      let expiredGrant: Rule | null = null;
      let hostListed: Rule | null = null;
      for (const g of grants) {
        if (!inScope(g)) continue;
        if (expired.has(g)) {
          expiredGrant ??= g;
          continue;
        }
        if (!hostMatches(g)) {
          if (target === null) hostListed ??= g;
          continue;
        }
        return { verdict: "allowed", reason: "granted", rule: g };
      }
      if (hostListed) return { verdict: "denied", reason: "unknown destination", rule: hostListed };
      if (expiredGrant) return { verdict: "denied", reason: "expired", rule: expiredGrant };
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
  const rx = "^" + pattern.toLowerCase().split("*").map(escapeRegExp).join(".*") + "$";
  return new RegExp(rx).test(host.toLowerCase());
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(...ymd(to)) - Date.UTC(...ymd(from));
  return Math.round(ms / 86_400_000);
}
