import { describe, expect, it } from "vitest";
import path from "node:path";
import { discover } from "../src/discover/index.js";

const root = path.join(__dirname, "fixtures", "discover");
const rel = (files: string[]) =>
  files.map((f) => path.relative(root, f).split(path.sep).join("/")).sort();

describe("discover", () => {
  it("finds .js and .mjs recursively, sorted", () => {
    const files = discover([root]);
    expect(rel(files)).toEqual(["src/a.js", "src/b.mjs", "src/nested/c.js"]);
  });

  it("skips node_modules and dist by default", () => {
    const files = rel(discover([root]));
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith("dist/"))).toBe(false);
  });

  it("ignores non-JS files, including .ts for now", () => {
    const files = rel(discover([root]));
    expect(files).not.toContain("src/readme.md");
    expect(files).not.toContain("src/notyet.ts");
  });

  it("accepts a single file path even if it would be excluded by name", () => {
    const f = path.join(root, "dist", "bundle.js");
    expect(discover([f])).toEqual([f]);
  });

  it("honours extra excludes", () => {
    const files = rel(discover([root], { exclude: ["nested"] }));
    expect(files).toEqual(["src/a.js", "src/b.mjs"]);
  });

  it("dedupes overlapping inputs", () => {
    const files = discover([root, path.join(root, "src")]);
    expect(files.length).toBe(3);
  });

  it("throws on a missing path", () => {
    expect(() => discover([path.join(root, "nope")])).toThrow(/not found/);
  });
});
