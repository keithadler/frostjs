import { describe, expect, it } from "vitest";
import { text } from "../src/report/text.js";
import type { Decision } from "../src/policy/index.js";
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
    const ds: Decision[] = [{ use: use(), verdict: "denied", rule: "deny everything" }];
    const out = text(ds, { files: 1 });
    expect(out).toBe(
      'src/a.js:2:3: storage.local denied by "deny everything": localStorage.setItem("a", 1)\n' +
        "\n1 file, 1 denied, 0 unknown\n",
    );
  });

  it("lists unknown uses in a separate section", () => {
    const ds: Decision[] = [
      { use: use({ confidence: "possible", expression: "caches.x", capability: "storage.cache" }), verdict: "unknown", rule: null },
    ];
    const out = text(ds, { files: 1 });
    expect(out).toContain("unknown (not failing the build):");
    expect(out).toContain("src/a.js:2:3: storage.cache possible: caches.x");
    expect(out).toContain("1 file, 0 denied, 1 unknown");
  });

  it("clean run", () => {
    expect(text([], { files: 3 })).toBe("3 files, 0 denied, 0 unknown\n");
  });
});
