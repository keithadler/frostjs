import type { CapabilityUse } from "../extract/capability.js";

export type Verdict = "allowed" | "denied" | "unknown";

export interface Decision {
  use: CapabilityUse;
  verdict: Verdict;
  /** The policy line that produced the verdict, or null for unknown. */
  rule: string | null;
}

/**
 * A compiled policy. Phase B replaces this with the frost compiler's output;
 * the shape is what the gate needs, not what the language looks like.
 */
export interface Policy {
  name: string;
  /** Return the rule text that allows the use, or null if nothing does. */
  allows(use: CapabilityUse): string | null;
}

/** The hardcoded Phase A policy: nothing is granted. */
export const DENY_ALL: Policy = {
  name: "deny-all",
  allows: () => null,
};

/**
 * Confidence below this is never a hard failure; it is reported as unknown.
 * `--min-confidence` arrives in step 15; `probable` is the documented default.
 */
const FAILING: ReadonlySet<CapabilityUse["confidence"]> = new Set(["certain", "probable"]);

export function decide(uses: readonly CapabilityUse[], policy: Policy): Decision[] {
  return uses.map((use) => {
    const rule = policy.allows(use);
    if (rule !== null) return { use, verdict: "allowed", rule };
    if (!FAILING.has(use.confidence)) return { use, verdict: "unknown", rule: null };
    return { use, verdict: "denied", rule: "deny everything" };
  });
}
