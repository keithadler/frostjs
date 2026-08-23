import { describe, expect, it } from "vitest";
import path from "node:path";
import { cli, cliIn } from "./helpers.js";
import { VERSION } from "../src/version.js";

const proj = path.join(__dirname, "fixtures", "proj");
const run = (format: string) => cli("--today", "2026-08-23", "--format", format, path.join(proj, "src"));

describe("--format json", () => {
  it("is a versioned document with decisions and a summary", () => {
    const r = run("json");
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.stdout);
    expect(doc.schema).toBe(1);
    expect(doc.frostjs).toBe(VERSION);
    expect(doc.policy).toEqual({ file: "test/fixtures/proj/frostjs.policy", name: "proj" });
    expect(doc.files).toBe(3);
    expect(doc.summary).toMatchObject({ allowed: 3, denied: 2, unknown: 0 });
    expect(doc.warnings[0]).toContain("expires in 7 days");
    const denied = doc.decisions.filter((d: { verdict: string }) => d.verdict === "denied");
    expect(denied).toEqual([
      {
        file: "test/fixtures/proj/src/app.js",
        line: 2,
        column: 1,
        capability: "storage.local",
        target: null,
        expression: 'localStorage.setItem("not-here", 1)',
        confidence: "certain",
        verdict: "denied",
        reason: "not granted",
        rule: null,
      },
      {
        file: "test/fixtures/proj/src/legacy/old.js",
        line: 2,
        column: 1,
        capability: "storage.cookie",
        target: null,
        expression: "document.cookie",
        confidence: "certain",
        verdict: "denied",
        reason: "forbidden",
        rule: { line: 4, text: "forbid cookies", hint: "consent banner owns these" },
      },
    ]);
  });

  it("prints nothing else on stdout", () => {
    expect(() => JSON.parse(run("json").stdout)).not.toThrow();
  });
});

describe("--format sarif", () => {
  it("is SARIF 2.1.0 with one rule per capability", () => {
    const r = run("sarif");
    expect(r.code).toBe(1);
    const log = JSON.parse(r.stdout);
    expect(log.version).toBe("2.1.0");
    const runObj = log.runs[0];
    expect(runObj.tool.driver.name).toBe("frostjs");
    expect(runObj.tool.driver.rules.map((x: { id: string }) => x.id)).toEqual(["storage.cookie", "storage.local"]);
    expect(runObj.results.length).toBe(2);
    const first = runObj.results[0];
    expect(first.ruleId).toBe("storage.local");
    expect(first.level).toBe("error");
    expect(first.locations[0].physicalLocation.artifactLocation.uri).toBe("test/fixtures/proj/src/app.js");
    expect(first.locations[0].physicalLocation.region).toEqual({ startLine: 2, startColumn: 1 });
    expect(first.message.text).toContain("storage.local denied by default (no rule grants it)");
  });

  it("baselined results carry baselineState unchanged", () => {
    // Build a baseline in a temp copy, then read SARIF against it.
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-sarif-"));
    fs.cpSync(proj, dir, { recursive: true });
    const bl = path.join(dir, "b.json");
    cli("--today", "2026-08-23", "--baseline", bl, "--update-baseline", path.join(dir, "src"));
    const r = cli("--today", "2026-08-23", "--baseline", bl, "--format", "sarif", path.join(dir, "src"));
    expect(r.code).toBe(0);
    const results = JSON.parse(r.stdout).runs[0].results;
    expect(results.every((x: { baselineState: string }) => x.baselineState === "unchanged")).toBe(true);
  });
});

describe("--format github", () => {
  it("emits workflow commands, then the text report", () => {
    const r = run("github");
    expect(r.code).toBe(1);
    const lines = r.stdout.split("\n");
    expect(lines[0]).toBe(
      '::error file=test/fixtures/proj/src/app.js,line=2,col=1,title=frostjs%3A storage.local denied::storage.local denied by default (no rule grants it): localStorage.setItem("not-here", 1)',
    );
    expect(lines[1]).toContain(
      "::error file=test/fixtures/proj/src/legacy/old.js,line=2,col=1,title=frostjs%3A storage.cookie denied::",
    );
    expect(lines[1]).toContain("consent banner owns these");
    expect(lines[2]).toContain("::warning title=frostjs%3A grant expiring::");
    expect(r.stdout).toContain("\n3 files, 2 denied, 0 unknown\n");
  });

  it("escapes newlines and percent signs in messages", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-gh-"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), "");
    fs.writeFileSync(path.join(dir, "a.js"), 'fetch(\n  "https://x.example/100%"\n);\n');
    const r = cli("--format", "github", path.join(dir, "a.js"));
    const first = r.stdout.split("\n")[0]!;
    expect(first).toContain("%0A");
    expect(first).toContain("100%25");
    expect(first).not.toMatch(/[^%]%[^0-9A-F]/);
  });
});

describe("--format", () => {
  it("rejects html outside frostjs sri", () => {
    const r = cli("--format", "html", path.join(proj, "src"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--format html is only for frostjs sri");
  });

  it("rejects unknown formats", () => {
    const r = cli("--format", "xml", path.join(proj, "src"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--format must be one of text, json, sarif, github, html");
  });
});

describe("--format sarif fingerprints", () => {
  it("carries a stable partialFingerprint that ignores line number", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-fp-"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), 'policy "t"\n');
    fs.writeFileSync(path.join(dir, "a.js"), 'localStorage.setItem("x", 1);\n');
    const fp1 = JSON.parse(cliIn(dir, "--format", "sarif", ".").stdout).runs[0].results[0].partialFingerprints[
      "frostjs/v1"
    ];
    expect(fp1).toMatch(/^[0-9a-f]{16}$/);
    // Move the use down two lines: same fingerprint, different startLine.
    fs.writeFileSync(path.join(dir, "a.js"), '\n\nlocalStorage.setItem("x", 1);\n');
    const r2 = JSON.parse(cliIn(dir, "--format", "sarif", ".").stdout).runs[0].results[0];
    expect(r2.locations[0].physicalLocation.region.startLine).toBe(3);
    expect(r2.partialFingerprints["frostjs/v1"]).toBe(fp1);
  });
});
