import type { CapabilityUse } from "../extract/capability.js";
import { compile, type Policy, type Reason } from "./compile.js";
import type { Rule } from "./parse.js";

export { compile, type Policy, type Evaluation, type Reason } from "./compile.js";
export { parsePolicy, PolicyError, type ParsedPolicy, type Rule } from "./parse.js";

export type Verdict = "allowed" | "denied" | "unknown";

export interface Decision {
  use: CapabilityUse;
  verdict: Verdict;
  reason: Reason | null;
  /** The policy rule that decided it, or null for the implicit deny or for unknown. */
  rule: Rule | null;
}

/** The policy used when no permit.policy exists: nothing is granted. */
export const DENY_ALL: Policy = compile({ file: "(no policy)", name: "deny-all", rules: [] }, { today: "1970-01-01" });
export { matchesHost } from "./compile.js";

export type Confidence = CapabilityUse["confidence"];
export const CONFIDENCE_ORDER: readonly Confidence[] = ["possible", "probable", "certain"];
/** Uses below this confidence are reported as unknown and never fail the build. */
export const DEFAULT_MIN_CONFIDENCE: Confidence = "probable";

export interface DecideOptions {
  /** Map a use's reported path to the path the policy's globs should see. */
  scopePath?: (use: CapabilityUse) => string;
  minConfidence?: Confidence;
}

export function decide(uses: readonly CapabilityUse[], policy: Policy, opts: DecideOptions = {}): Decision[] {
  const floor = CONFIDENCE_ORDER.indexOf(opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE);
  return uses.map((use) => {
    const e = policy.evaluate(opts.scopePath ? { ...use, file: opts.scopePath(use) } : use);
    if (e.verdict === "allowed") return { use, verdict: "allowed", reason: e.reason, rule: e.rule };
    if (CONFIDENCE_ORDER.indexOf(use.confidence) < floor) return { use, verdict: "unknown", reason: null, rule: null };
    return { use, verdict: "denied", reason: e.reason, rule: e.rule };
  });
}
