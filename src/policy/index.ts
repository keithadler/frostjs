/**
 * The policy stage: parse a frostjs.policy, compile it, and decide each
 * CapabilityUse. Everything outside this directory imports from here.
 */
import type { CapabilityUse, Confidence } from "../extract/capability.js";
import { compile, type Policy, type Reason } from "./compile.js";
import type { Rule } from "./parse.js";

export { compile, isExpired, matchesCapability, type Policy, type Evaluation, type Reason } from "./compile.js";
export { parsePolicy, PolicyError, type ParsedPolicy, type Rule } from "./parse.js";
export { commonAncestor, compilePolicyFile, findPolicyFile, isoToday, POLICY_FILENAME } from "./config.js";
export { matchesGlob } from "./glob.js";
export { csp } from "./csp.js";
export type { Confidence } from "../extract/capability.js";

/**
 * What became of a use. `allowed` and `denied` come from the policy;
 * `unknown` is a use below the confidence floor (listed, never failing);
 * `suppressed` has an inline `frostjs: ignore`; `baselined` is on record in
 * the baseline file; `unchanged` sits outside the lines a `--changed-since`
 * diff touched. Only `denied` fails the build.
 */
export type Verdict = "allowed" | "denied" | "unknown" | "suppressed" | "baselined" | "unchanged";

export interface Decision {
  use: CapabilityUse;
  verdict: Verdict;
  reason: Reason | null;
  /** The policy rule that decided it, or null for the implicit deny or for unknown. */
  rule: Rule | null;
}

/** The policy used when no frostjs.policy exists: nothing is granted. */
export const DENY_ALL: Policy = compile(
  { file: "(no policy)", name: "deny-all", rules: [], vendored: [], ignore: [] },
  { today: "1970-01-01" },
);

/** Confidence tiers, lowest first. */
export const CONFIDENCE_ORDER: readonly Confidence[] = ["possible", "probable", "certain"];
/** Uses below this confidence are reported as unknown and never fail the build. */
export const DEFAULT_MIN_CONFIDENCE: Confidence = "probable";

export interface DecideOptions {
  /** Map a use's reported path to the path the policy's globs should see. */
  scopePath?: (use: CapabilityUse) => string;
  minConfidence?: Confidence;
}

/**
 * Decide every use against the policy. Allowed uses are allowed at any
 * confidence; a denied use is then suppressed, unknown (below the floor),
 * or denied. An unregistered vendored file is denied whatever the policy
 * says, since no grant can admit a hash nobody reviewed.
 */
export function decide(uses: readonly CapabilityUse[], policy: Policy, opts: DecideOptions = {}): Decision[] {
  const floor = CONFIDENCE_ORDER.indexOf(opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE);
  return uses.map((use) => {
    if (use.capability === "vendor.unregistered") return { use, verdict: "denied", reason: "unregistered", rule: null };
    const e = policy.evaluate(opts.scopePath ? { ...use, file: opts.scopePath(use) } : use);
    if (e.verdict === "allowed") return { use, verdict: "allowed", reason: e.reason, rule: e.rule };
    if (use.suppressed) return { use, verdict: "suppressed", reason: null, rule: null };
    if (CONFIDENCE_ORDER.indexOf(use.confidence) < floor) return { use, verdict: "unknown", reason: null, rule: null };
    return { use, verdict: "denied", reason: e.reason, rule: e.rule };
  });
}
