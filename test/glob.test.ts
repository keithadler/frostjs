import { describe, expect, it } from "vitest";
import { matchesGlob } from "../src/policy/glob.js";

describe("matchesGlob", () => {
  it("exact path", () => {
    expect(matchesGlob("src/a.js", "src/a.js")).toBe(true);
    expect(matchesGlob("src/a.js", "src/b.js")).toBe(false);
  });

  it("* stays within a segment", () => {
    expect(matchesGlob("src/*", "src/a.js")).toBe(true);
    expect(matchesGlob("src/*", "src/deep/a.js")).toBe(false);
    expect(matchesGlob("src/*.js", "src/a.js")).toBe(true);
    expect(matchesGlob("src/*.js", "src/a.ts")).toBe(false);
  });

  it("** crosses segments, including zero", () => {
    expect(matchesGlob("src/**", "src/a.js")).toBe(true);
    expect(matchesGlob("src/**", "src/deep/er/a.js")).toBe(true);
    expect(matchesGlob("src/**/a.js", "src/a.js")).toBe(true);
    expect(matchesGlob("src/**/a.js", "src/x/y/a.js")).toBe(true);
    expect(matchesGlob("**/legacy/*", "src/legacy/a.js")).toBe(true);
  });

  it("? matches one character", () => {
    expect(matchesGlob("src/?.js", "src/a.js")).toBe(true);
    expect(matchesGlob("src/?.js", "src/ab.js")).toBe(false);
  });

  it("a pattern without a slash matches the basename at any depth", () => {
    expect(matchesGlob("*.min.js", "vendor/x/jquery.min.js")).toBe(true);
    expect(matchesGlob("banner.js", "src/legacy/banner.js")).toBe(true);
    expect(matchesGlob("banner.js", "src/legacy/banner.js.map")).toBe(false);
  });

  it("a plain directory path matches everything beneath it", () => {
    expect(matchesGlob("src/legacy", "src/legacy/a.js")).toBe(true);
    expect(matchesGlob("src/legacy", "src/legacy/deep/a.js")).toBe(true);
    expect(matchesGlob("src/legacy", "src/legacyx/a.js")).toBe(false);
  });

  it("regex metacharacters are literal", () => {
    expect(matchesGlob("src/a.b.js", "src/aXb.js")).toBe(false);
    expect(matchesGlob("src/(x)/a.js", "src/(x)/a.js")).toBe(true);
  });

  it("leading ./ is ignored on both sides", () => {
    expect(matchesGlob("./src/*", "src/a.js")).toBe(true);
    expect(matchesGlob("src/*", "./src/a.js")).toBe(true);
  });
});
