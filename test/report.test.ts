import { describe, expect, it } from "vitest";
import { text } from "../src/report/text.js";
import type { Decision, Rule } from "../src/policy/index.js";
import type { CapabilityUse } from "../src/extract/capability.js";

const use = (over: Partial<CapabilityUse> = {}): CapabilityUse => ({
  capability: "storage.local",
  target: null,
  file: "src/a.js",
  line: 2,
  column: 3,
  expression: 'localStorage.setItem("a", 1)',
  confidence: "certain",
  origin: "first-party",
  ...over,
});

describe("text report", () => {
  it("prints one line per denial, then a summary", () => {
    const ds: Decision[] = [{ use: use(), verdict: "denied", reason: "not granted", rule: null }];
    const out = text(ds, { files: 1 });
    expect(out).toBe(
      'src/a.js:2:3: storage.local denied by "deny everything": localStorage.setItem("a", 1)\n' +
        "\n1 file, 1 denied, 0 unknown\n",
    );
  });

  it("lists unknown uses in a separate section", () => {
    const ds: Decision[] = [
      { use: use({ confidence: "possible", expression: "caches.x", capability: "storage.cache" }), verdict: "unknown", reason: null, rule: null },
    ];
    const out = text(ds, { files: 1 });
    expect(out).toContain("unknown (not failing the build):");
    expect(out).toContain("src/a.js:2:3: storage.cache possible: caches.x");
    expect(out).toContain("1 file, 0 denied, 1 unknown");
  });

  it("clean run", () => {
    expect(text([], { files: 3 })).toBe("3 files, 0 denied, 0 unknown\n");
  });

  const rule = (over: Partial<Rule> = {}): Rule => ({
    verb: "forbid",
    capability: "storage.cookie",
    paths: [],
    until: null,
    hint: "",
    line: 4,
    text: "forbid cookies",
    ...over,
  });

  it("names the forbidding rule, its line and its hint", () => {
    const ds: Decision[] = [
      { use: use({ capability: "storage.cookie" }), verdict: "denied", reason: "forbidden", rule: rule({ hint: "consent banner owns these" }) },
    ];
    expect(text(ds, { files: 1 })).toContain(
      'src/a.js:2:3: storage.cookie denied by "forbid cookies" (line 4): consent banner owns these: localStorage.setItem("a", 1)',
    );
  });

  it("expired grants say so", () => {
    const ds: Decision[] = [
      { use: use(), verdict: "denied", reason: "expired", rule: rule({ verb: "may", capability: "storage", until: "2026-01-01", text: "may use storage until 2026-01-01", line: 2 }) },
    ];
    expect(text(ds, { files: 1 })).toContain(
      'storage.local denied, grant expired 2026-01-01: "may use storage until 2026-01-01" (line 2): localStorage',
    );
  });

  it("prints warnings before the summary", () => {
    const out = text([], { files: 1 }, { warnings: ["permit.policy line 1: x expires in 3 days"] });
    expect(out).toBe("warning: permit.policy line 1: x expires in 3 days\n\n1 file, 0 denied, 0 unknown\n");
  });
});
