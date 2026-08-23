import { describe, expect, it } from "vitest";
import { DENY_ALL, decide } from "../src/policy/index.js";
import type { CapabilityUse } from "../src/extract/capability.js";

const use = (over: Partial<CapabilityUse> = {}): CapabilityUse => ({
  capability: "storage.local",
  target: null,
  file: "a.js",
  line: 1,
  column: 1,
  expression: "localStorage",
  confidence: "certain",
  origin: "first-party",
  ...over,
});

describe("deny-all policy", () => {
  it("denies a certain use", () => {
    const [d] = decide([use()], DENY_ALL);
    expect(d).toMatchObject({ verdict: "denied", reason: "not granted", rule: null });
    expect(d?.use.capability).toBe("storage.local");
  });

  it("denies a probable use", () => {
    const [d] = decide([use({ confidence: "probable" })], DENY_ALL);
    expect(d?.verdict).toBe("denied");
  });

  it("marks a possible use unknown rather than denied", () => {
    const [d] = decide([use({ confidence: "possible" })], DENY_ALL);
    expect(d?.verdict).toBe("unknown");
  });

  it("preserves order", () => {
    const ds = decide([use({ line: 1 }), use({ line: 2 })], DENY_ALL);
    expect(ds.map((d) => d.use.line)).toEqual([1, 2]);
  });
});
