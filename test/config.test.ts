import { describe, expect, it } from "vitest";
import path from "node:path";
import { findPolicyFile, commonAncestor } from "../src/policy/config.js";

const fx = path.join(__dirname, "fixtures");

describe("commonAncestor", () => {
  it("of one file is its directory", () => {
    expect(commonAncestor([path.join(fx, "proj", "src", "app.js")])).toBe(path.join(fx, "proj", "src"));
  });
  it("of one directory is itself", () => {
    expect(commonAncestor([path.join(fx, "proj")])).toBe(path.join(fx, "proj"));
  });
  it("of siblings is the parent", () => {
    expect(commonAncestor([path.join(fx, "proj", "src"), path.join(fx, "proj", "tenant")])).toBe(path.join(fx, "proj"));
  });
});

describe("findPolicyFile", () => {
  it("finds frostjs.policy in the start directory", () => {
    expect(findPolicyFile(path.join(fx, "proj"))).toBe(path.join(fx, "proj", "frostjs.policy"));
  });
  it("walks up", () => {
    expect(findPolicyFile(path.join(fx, "proj", "src", "legacy"))).toBe(path.join(fx, "proj", "frostjs.policy"));
  });
  it("nearest wins", () => {
    expect(findPolicyFile(path.join(fx, "proj", "tenant"))).toBe(path.join(fx, "proj", "tenant", "frostjs.policy"));
  });
  it("stops at the given root", () => {
    expect(findPolicyFile(path.join(fx, "proj", "src"), path.join(fx, "proj", "src"))).toBe(null);
  });
});
