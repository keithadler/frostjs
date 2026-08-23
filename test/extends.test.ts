import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compilePolicyFile } from "../src/policy/index.js";

function tree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-ext-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}
const load = (dir: string, rel: string) => compilePolicyFile(path.join(dir, rel), "2026-08-23", rel);
const use = (capability: string, file: string, target: string | null = null) => ({
  capability,
  target,
  file,
  line: 1,
  column: 1,
  expression: "x",
  confidence: "certain" as const,
  origin: "first-party" as const,
  suppressed: false,
});

describe("policy extends", () => {
  it("merges base grants and forbids; base forbid wins over a child grant", () => {
    const dir = tree({
      "base/frostjs.policy": 'policy "base"\nmay use storage\nforbid cookies\n',
      "app/frostjs.policy": 'policy "app"\nextends "../base/frostjs.policy"\nmay use the network\n',
    });
    const p = load(dir, "app/frostjs.policy");
    expect(p.name).toBe("app");
    expect(p.evaluate(use("storage.local", "a.js")).verdict).toBe("allowed"); // from base
    expect(p.evaluate(use("network.fetch", "a.js", "x.example")).verdict).toBe("allowed"); // from child
    expect(p.evaluate(use("storage.cookie", "a.js")).verdict).toBe("denied"); // base forbid
  });

  it("inherits the taint gate flag", () => {
    const dir = tree({
      "base/frostjs.policy": "forbid tainted flows\n",
      "app/frostjs.policy": 'extends "../base/frostjs.policy"\n',
    });
    expect(load(dir, "app/frostjs.policy").taint).toBe(true);
  });

  it("rebases a base path glob to the extending policy's directory", () => {
    const dir = tree({
      "base/frostjs.policy": 'policy "base"\nmay use cookies in "legacy/*"\n',
      "app/frostjs.policy": 'extends "../base/frostjs.policy"\n',
    });
    const p = load(dir, "app/frostjs.policy");
    // base glob "legacy/*" was relative to base/, so from app/ it is "../base/legacy/*"
    expect(p.evaluate(use("storage.cookie", "../base/legacy/x.js")).verdict).toBe("allowed");
    expect(p.evaluate(use("storage.cookie", "legacy/x.js")).verdict).toBe("denied");
  });

  it("follows a chain of extends", () => {
    const dir = tree({
      "a/frostjs.policy": "may use storage\n",
      "b/frostjs.policy": 'extends "../a/frostjs.policy"\nmay use the network\n',
      "c/frostjs.policy": 'extends "../b/frostjs.policy"\nforbid cookies\n',
    });
    const p = load(dir, "c/frostjs.policy");
    expect(p.evaluate(use("storage.local", "x.js")).verdict).toBe("allowed"); // from a
    expect(p.evaluate(use("network.fetch", "x.js", "h")).verdict).toBe("allowed"); // from b
    expect(p.evaluate(use("storage.cookie", "x.js")).verdict).toBe("denied"); // from c
  });

  it("a cycle is an error", () => {
    const dir = tree({
      "x/frostjs.policy": 'extends "../y/frostjs.policy"\n',
      "y/frostjs.policy": 'extends "../x/frostjs.policy"\n',
    });
    expect(() => load(dir, "x/frostjs.policy")).toThrow(/cycle/);
  });

  it("a missing target names the line", () => {
    const dir = tree({ "app/frostjs.policy": 'may use storage\nextends "../nope.policy"\n' });
    expect(() => load(dir, "app/frostjs.policy")).toThrow(/line 2: extends target not found: \.\.\/nope\.policy/);
  });

  it("a parse error in the base is reported", () => {
    const dir = tree({
      "base/frostjs.policy": "allow storage\n",
      "app/frostjs.policy": 'extends "../base/frostjs.policy"\n',
    });
    expect(() => load(dir, "app/frostjs.policy")).toThrow(/cannot read 'allow storage'/);
  });

  it("rejects a bad extends line", () => {
    const dir = tree({ "app/frostjs.policy": "extends base\n" });
    expect(() => load(dir, "app/frostjs.policy")).toThrow(/'extends' needs a quoted policy path/);
  });
});
