import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CODE_TRIGGER, FAMILY_SUMMARY, capabilitiesMarkdown, capabilityDocs } from "../src/capabilities.js";
import { FAMILIES, MEMBER_CODES } from "../src/policy/vocabulary.js";
import { cliIn } from "./helpers.js";

describe("capability taxonomy cannot drift", () => {
  it("every emitted member code has a description, and every description is a real code", () => {
    for (const code of MEMBER_CODES) expect(CODE_TRIGGER[code], `missing description for ${code}`).toBeTruthy();
    for (const code of Object.keys(CODE_TRIGGER)) expect(MEMBER_CODES, `stale description ${code}`).toContain(code);
  });

  it("every family has a summary", () => {
    for (const fam of FAMILIES) expect(FAMILY_SUMMARY[fam], `missing summary for ${fam}`).toBeTruthy();
    for (const fam of Object.keys(FAMILY_SUMMARY)) expect(FAMILIES, `stale summary ${fam}`).toContain(fam);
  });

  it("capabilityDocs covers every family and member exactly once", () => {
    const docs = capabilityDocs();
    expect(docs.map((d) => d.family)).toEqual([...FAMILIES]);
    expect(docs.flatMap((d) => d.members.map((m) => m.code)).sort()).toEqual([...MEMBER_CODES].sort());
  });

  it("docs/CAPABILITIES.md is up to date (regenerate with: frostjs capabilities --format md > docs/CAPABILITIES.md)", () => {
    const onDisk = fs.readFileSync(path.join(__dirname, "..", "docs", "CAPABILITIES.md"), "utf8");
    expect(onDisk).toBe(capabilitiesMarkdown());
  });
});

describe("frostjs capabilities", () => {
  it("prints text, json and md", () => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "frostjs-caps-"));
    expect(cliIn(dir, "capabilities").stdout).toContain("storage.local");
    const j = JSON.parse(cliIn(dir, "capabilities", "--format", "json").stdout);
    expect(j.families.length).toBe(FAMILIES.length);
    expect(cliIn(dir, "capabilities", "--format", "md").stdout).toContain("# Capabilities");
  });
});
