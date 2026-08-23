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

/**
 * Confidence below this is never a hard failure; it is reported as unknown.
 * `--min-confidence` arrives in step 15; `probable` is the documented default.
 */
const FAILING: ReadonlySet<CapabilityUse["confidence"]> = new Set(["certain", "probable"]);

export function decide(uses: readonly CapabilityUse[], policy: Policy): Decision[] {
  return uses.map((use) => {
    const e = policy.evaluate(use);
    if (e.verdict === "allowed") return { use, verdict: "allowed", reason: e.reason, rule: e.rule };
    if (!FAILING.has(use.confidence)) return { use, verdict: "unknown", reason: null, rule: null };
    return { use, verdict: "denied", reason: e.reason, rule: e.rule };
  });
}
