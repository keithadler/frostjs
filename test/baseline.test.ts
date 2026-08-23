import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { baselineKey, readBaseline, writeBaseline } from "../src/baseline.js";
import { cli } from "./helpers.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "permit-baseline-"));

describe("baseline file", () => {
  it("key normalizes whitespace in the expression", () => {
    const multiline = ["localStorage.setItem(", "  a,", "  1", ")"].join("\n");
    expect(baselineKey("src/a.js", "storage.local", multiline)).toBe(
      "src/a.js storage.local localStorage.setItem( a, 1 )",
    );
  });

  it("round-trips sorted, deduplicated entries", () => {
    const dir = tmp();
    const file = path.join(dir, ".permit-baseline.json");
    writeBaseline(file, [
      { file: "b.js", capability: "network.fetch", expression: "fetch(u)" },
      { file: "a.js", capability: "storage.local", expression: "localStorage" },
      { file: "a.js", capability: "storage.local", expression: "localStorage" },
    ]);
    const b = readBaseline(file);
    expect(b.entries).toEqual([
      { file: "a.js", capability: "storage.local", expression: "localStorage" },
      { file: "b.js", capability: "network.fetch", expression: "fetch(u)" },
    ]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).version).toBe(1);
  });

  it("a missing file is an empty baseline", () => {
    expect(readBaseline(path.join(tmp(), "nope.json")).entries).toEqual([]);
  });

  it("a malformed file is an error", () => {
    const file = path.join(tmp(), "bad.json");
    fs.writeFileSync(file, "{not json");
    expect(() => readBaseline(file)).toThrow(/baseline/);
  });
});

describe("permit --baseline", () => {
  const proj = path.join(__dirname, "fixtures", "proj");

  it("--update-baseline freezes current denials and exits 0", () => {
    const dir = tmp();
    fs.cpSync(proj, dir, { recursive: true });
    const file = path.join(dir, "b.json");
    const r = cli("--today", "2026-08-23", "--baseline", file, "--update-baseline", path.join(dir, "src"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 denied");
    expect(r.stderr).toContain("wrote 2 entries to");
    const b = readBaseline(file);
    expect(b.entries.map((e) => [e.file, e.capability])).toEqual([
      ["src/app.js", "storage.local"],
      ["src/legacy/old.js", "storage.cookie"],
    ]);
  });

  it("baselined denials no longer fail; new ones do", () => {
    const dir = tmp();
    const file = path.join(dir, "b.json");
    cli("--today", "2026-08-23", "--baseline", file, "--update-baseline", path.join(proj, "src"));
    const again = cli("--today", "2026-08-23", "--baseline", file, path.join(proj, "src"));
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("3 files, 0 denied, 0 unknown, 2 baselined");

    // A new violation appears.
    fs.writeFileSync(path.join(dir, "permit.policy"), 'policy "tmp"\n');
    fs.writeFileSync(path.join(dir, "new.js"), 'localStorage.setItem("x", 1);\n');
    const r = cli("--baseline", file, path.join(dir, "new.js"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("new.js:1:1: storage.local denied");
  });

  it("baseline paths are relative to the baseline file", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "permit.policy"), "");
    fs.writeFileSync(path.join(dir, "sub", "x.js"), "localStorage.x;\n");
    const file = path.join(dir, "sub", "b.json");
    cli("--baseline", file, "--update-baseline", path.join(dir, "sub"));
    expect(readBaseline(file).entries[0]?.file).toBe("x.js");
    expect(cli("--baseline", file, path.join(dir, "sub", "x.js")).code).toBe(0);
  });

  it("--update-baseline without --baseline is an error", () => {
    const r = cli("--update-baseline", path.join(proj, "src"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--update-baseline needs --baseline <file>");
  });
});
