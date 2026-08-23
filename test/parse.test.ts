import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseSource, parseFile, lineIndex, positionAt } from "../src/extract/ast.js";

describe("parseSource", () => {
  it("returns a Program for valid JS", () => {
    const r = parseSource("a.js", "const a = 1;");
    expect(r.errors).toEqual([]);
    expect(r.program.type).toBe("Program");
    expect(r.program.body.length).toBe(1);
  });

  it("reports syntax errors with line and column", () => {
    const r = parseSource("b.js", "\nconst = ;");
    expect(r.errors.length).toBeGreaterThan(0);
    const e = r.errors[0]!;
    expect(e.file).toBe("b.js");
    expect(e.line).toBe(2);
    expect(e.column).toBe(7);
    expect(e.message).toMatch(/Unexpected token/);
  });

  it("treats .mjs as a module", () => {
    const r = parseSource("m.mjs", "export const x = 1;");
    expect(r.errors).toEqual([]);
  });

  it("tolerates CommonJS in .js", () => {
    const r = parseSource("c.js", "module.exports = require('x');");
    expect(r.errors).toEqual([]);
  });
});

describe("parseFile", () => {
  it("reads and parses from disk", () => {
    const f = path.join(__dirname, "fixtures", "discover", "src", "a.js");
    const r = parseFile(f);
    expect(r.errors).toEqual([]);
    expect(r.source).toContain("console.log");
  });
});

describe("positionAt", () => {
  it("maps byte offsets to 1-based line and column", () => {
    const src = "ab\ncd\n\nefg";
    const idx = lineIndex(src);
    expect(positionAt(idx, 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt(idx, 2)).toEqual({ line: 1, column: 3 });
    expect(positionAt(idx, 3)).toEqual({ line: 2, column: 1 });
    expect(positionAt(idx, 7)).toEqual({ line: 4, column: 1 });
    expect(positionAt(idx, 9)).toEqual({ line: 4, column: 3 });
  });
});
