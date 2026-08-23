import { describe, expect, it } from "vitest";
import { explainCapability } from "../src/capabilities.js";
import { MEMBER_CODES, FAMILIES } from "../src/policy/vocabulary.js";
import { cliIn } from "./helpers.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("explainCapability", () => {
  it("explains a member code with its trigger and grant lines", () => {
    const t = explainCapability("dom-escape.handler")!;
    expect(t).toContain("dom-escape.handler");
    expect(t).toContain("triggered by:");
    expect(t).toContain("family: dom-escape");
    expect(t).toContain("may use dom-escape.handler");
    expect(t).toContain("may use html injection");
  });

  it("resolves a phrase", () => {
    expect(explainCapability("local storage")).toContain("storage.local");
    expect(explainCapability("cookies")).toContain("storage.cookie");
  });

  it("explains a family with its members", () => {
    const t = explainCapability("storage")!;
    expect(t).toContain("members: storage.local");
    expect(t).toContain("may use storage");
  });

  it("returns null for a non-capability", () => {
    expect(explainCapability("teleport")).toBe(null);
    expect(explainCapability("everything")).toBe(null);
  });

  it("explains every code and family the tool knows", () => {
    for (const c of [...MEMBER_CODES, ...FAMILIES]) expect(explainCapability(c), c).not.toBe(null);
  });
});

describe("frostjs explain", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-explain-"));
  it("prints an explanation and exits 0", () => {
    const r = cliIn(dir, "explain", "storage.local");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("triggered by: localStorage");
  });
  it("accepts a multi-word phrase", () => {
    expect(cliIn(dir, "explain", "local", "storage").stdout).toContain("storage.local");
  });
  it("exits 2 on an unknown term and on no term", () => {
    expect(cliIn(dir, "explain", "teleport").code).toBe(2);
    expect(cliIn(dir, "explain").code).toBe(2);
    expect(cliIn(dir, "explain", "teleport").stderr).toContain("is not a capability");
  });
});
