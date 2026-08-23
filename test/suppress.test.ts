import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";
import { suppressions, isSuppressed } from "../src/extract/suppress.js";

const uses = (src: string) => extract(parseSource("t.js", src));

describe("suppression comments", () => {
  it("parses bare and bracketed forms, line and block", () => {
    const p = parseSource(
      "t.js",
      "// permit: ignore\nx;\n/* permit: ignore[storage.local, network] */\ny; // permit:ignore[codegen.eval]\n",
    );
    const s = suppressions(p);
    expect(s.get(1)).toEqual({ all: true, codes: [] });
    expect(s.get(3)).toEqual({ all: false, codes: ["storage.local", "network"] });
    // Line 3's comment stands alone, so it also covers line 4 and merges with line 4's own.
    expect(s.get(4)).toEqual({ all: false, codes: ["storage.local", "network", "codegen.eval"] });
  });

  it("ignores unrelated comments", () => {
    const p = parseSource("t.js", "// permit the user\n// eslint-disable-next-line\nx;");
    expect(suppressions(p).size).toBe(0);
  });

  it("isSuppressed matches by code or family", () => {
    expect(isSuppressed({ all: false, codes: ["storage"] }, "storage.local")).toBe(true);
    expect(isSuppressed({ all: false, codes: ["storage.local"] }, "storage.session")).toBe(false);
    expect(isSuppressed({ all: true, codes: [] }, "anything.at.all")).toBe(true);
  });
});

describe("suppressed uses", () => {
  it("same-line trailing comment", () => {
    const [u] = uses('localStorage.setItem("a", 1); // permit: ignore[storage.local]');
    expect(u?.suppressed).toBe(true);
  });

  it("comment on the line above", () => {
    const [u] = uses('// permit: ignore\nlocalStorage.setItem("a", 1);');
    expect(u?.suppressed).toBe(true);
  });

  it("a comment two lines above does not apply", () => {
    const [u] = uses('// permit: ignore\n\nlocalStorage.setItem("a", 1);');
    expect(u?.suppressed).toBe(false);
  });

  it("the line above must be only a comment", () => {
    const u = uses("foo(); // permit: ignore\nlocalStorage.x;");
    expect(u[0]?.suppressed).toBe(false);
  });

  it("wrong capability does not suppress", () => {
    const [u] = uses("localStorage.x; // permit: ignore[network]");
    expect(u?.suppressed).toBe(false);
  });

  it("family suppresses its members", () => {
    const [u] = uses("localStorage.x; // permit: ignore[storage]");
    expect(u?.suppressed).toBe(true);
  });

  it("a multi-line expression is keyed on its first line", () => {
    const [u] = uses("// permit: ignore\nfetch(\n  url\n);");
    expect(u?.suppressed).toBe(true);
  });
});
