import { describe, expect, it } from "vitest";
import { parsePolicy, PolicyError } from "../src/policy/parse.js";

const parse = (text: string) => parsePolicy(text, "permit.policy");
const rules = (text: string) => parse(text).rules;

describe("policy: lines and comments", () => {
  it("skips blank lines and comments", () => {
    const p = parse("\n-- a comment\n# another\n\nmay use storage\n");
    expect(p.rules.length).toBe(1);
    expect(p.rules[0]?.line).toBe(5);
  });

  it("keeps a trailing comment as the rule's hint", () => {
    const [r] = rules('forbid cookies -- consent banner owns these');
    expect(r?.hint).toBe("consent banner owns these");
    const [s] = rules("may use storage # fine");
    expect(s?.hint).toBe("fine");
  });

  it("does not treat -- inside quotes as a comment", () => {
    const [r] = rules('may use storage in "src/a--b/*"');
    expect(r?.paths).toEqual(["src/a--b/*"]);
    expect(r?.hint).toBe("");
  });

  it("keywords are case-insensitive", () => {
    const [r] = rules("MAY Use Local Storage");
    expect(r).toMatchObject({ verb: "may", capability: "storage.local" });
  });

  it("records the rule's own source text", () => {
    const [r] = rules('  may use cookies   -- hint');
    expect(r?.text).toBe("may use cookies");
  });
});

describe("policy: header", () => {
  it("optional policy name", () => {
    const p = parse('policy "checkout-widget"\nmay use storage');
    expect(p.name).toBe("checkout-widget");
    expect(p.rules.length).toBe(1);
  });

  it("defaults the name to the file name", () => {
    expect(parse("may use storage").name).toBe("permit.policy");
  });

  it("rejects a second policy line", () => {
    expect(() => parse('policy "a"\npolicy "b"')).toThrow(/line 2: only one policy line/);
  });
});

describe("policy: capability vocabulary", () => {
  it.each([
    ["may use storage", "storage"],
    ["may use local storage", "storage.local"],
    ["may use session storage", "storage.session"],
    ["may use cookies", "storage.cookie"],
    ["may use indexeddb", "storage.indexeddb"],
    ["may use the cache", "storage.cache"],
    ["may use caches", "storage.cache"],
    ["may use navigator storage", "storage.navigator"],
    ["may use the network", "network"],
    ["may use code generation", "codegen"],
    ["may use eval", "codegen"],
    ["may use html injection", "dom-escape"],
    ["may use identity", "identity"],
    ["may use fingerprinting", "identity"],
    ["may use navigation", "navigation"],
    ["may use globals", "globals"],
    ["may use workers", "worker"],
    ["may use everything", "*"],
  ])("%s -> %s", (line, code) => {
    expect(rules(line)[0]?.capability).toBe(code);
  });

  it("accepts a capability code directly", () => {
    expect(rules("may use storage.local")[0]?.capability).toBe("storage.local");
    expect(rules("forbid dom-escape")[0]?.capability).toBe("dom-escape");
  });

  it("forbid and forbid using are the same", () => {
    expect(rules("forbid cookies")[0]).toMatchObject({ verb: "forbid", capability: "storage.cookie" });
    expect(rules("forbid using cookies")[0]).toMatchObject({ verb: "forbid", capability: "storage.cookie" });
  });

  it("forbid everything else is accepted as a readability line", () => {
    const [r] = rules("forbid everything else");
    expect(r).toMatchObject({ verb: "forbid", capability: "*", paths: [], until: null });
  });
});

describe("policy: scoping and expiry", () => {
  it("in with one path", () => {
    expect(rules('may use cookies in "src/legacy/banner.js"')[0]?.paths).toEqual(["src/legacy/banner.js"]);
  });

  it("in with a list", () => {
    expect(rules('may use storage in "src/a/*", "src/b/**"')[0]?.paths).toEqual(["src/a/*", "src/b/**"]);
  });

  it("until a date", () => {
    const [r] = rules("may use storage until 2026-12-01");
    expect(r?.until).toBe("2026-12-01");
  });

  it("in and until together, either order", () => {
    const a = rules('may use storage in "src/*" until 2026-12-01')[0];
    const b = rules('may use storage until 2026-12-01 in "src/*"')[0];
    expect(a).toMatchObject({ paths: ["src/*"], until: "2026-12-01" });
    expect(b).toMatchObject({ paths: ["src/*"], until: "2026-12-01" });
  });

  it("string escapes in paths", () => {
    expect(rules('may use storage in "a\\"b"')[0]?.paths).toEqual(['a"b']);
  });
});

describe("policy: errors are precise", () => {
  const err = (text: string): PolicyError => {
    try {
      parse(text);
    } catch (e) {
      if (e instanceof PolicyError) return e;
      throw e;
    }
    throw new Error("expected a PolicyError");
  };

  it("unknown line", () => {
    const e = err("allow storage");
    expect(e.file).toBe("permit.policy");
    expect(e.line).toBe(1);
    expect(e.message).toContain("permit.policy line 1: cannot read 'allow storage'");
    expect(e.message).toContain("try: may use storage");
  });

  it("unknown capability", () => {
    const e = err("may use teleportation");
    expect(e.line).toBe(1);
    expect(e.message).toContain("unknown capability 'teleportation'");
    expect(e.message).toContain("storage");
  });

  it("missing paths after in", () => {
    const e = err("may use storage in");
    expect(e.message).toContain("line 1: 'in' needs one or more quoted paths");
    expect(e.message).toContain('try: may use storage in "src/*"');
  });

  it("unquoted path", () => {
    const e = err("may use storage in src/*");
    expect(e.message).toContain("'in' needs one or more quoted paths");
  });

  it("unterminated string", () => {
    const e = err('may use storage in "src/*');
    expect(e.message).toContain("line 1: unterminated string");
  });

  it("bad date", () => {
    expect(err("may use storage until tomorrow").message).toContain("'until' needs a date like 2026-12-01");
    expect(err("may use storage until 2026-13-40").message).toContain("2026-13-40 is not a real date");
  });

  it("trailing junk", () => {
    const e = err('may use storage in "src/*" please');
    expect(e.message).toContain("line 1: unexpected 'please' after the rule");
  });

  it("policy line needs a quoted name", () => {
    expect(err("policy checkout").message).toContain("try: policy \"checkout\"");
  });

  it("stops at the first bad line", () => {
    const e = err("may use storage\nbogus\nmore bogus");
    expect(e.line).toBe(2);
  });
});

describe("policy: error precision (step 8)", () => {
  const err = (text: string): PolicyError => {
    try {
      parse(text);
    } catch (e) {
      if (e instanceof PolicyError) return e;
      throw e;
    }
    throw new Error("expected a PolicyError");
  };

  it("shows the source line with a caret at the column", () => {
    const e = err("may use storage\nmay use storage in src/*");
    expect(e.line).toBe(2);
    expect(e.column).toBe(20);
    expect(e.message).toBe(
      "permit.policy line 2: 'in' needs one or more quoted paths\n" +
        "  may use storage in src/*\n" +
        "                     ^\n" +
        '  try: may use storage in "src/*"',
    );
  });

  it("points at the unknown verb, keeping the line as written", () => {
    const e = err("  allow cookies");
    expect(e.column).toBe(3);
    expect(e.message).toContain("\n    allow cookies\n    ^\n");
  });

  it("rejects a code that names a family but not a real member", () => {
    expect(err("may use storage.locl").message).toContain("unknown capability 'storage.locl'");
    expect(err("may use network.teleport").message).toContain("unknown capability");
  });

  it("points at the unknown capability", () => {
    const e = err("may use teleportation");
    expect(e.column).toBe(9);
  });

  it("points at the bad date", () => {
    expect(err("may use storage until soon").column).toBe(23);
  });

  it("points at the trailing junk", () => {
    expect(err('may use storage in "src/*" please').column).toBe(28);
  });

  it("points at the unterminated string", () => {
    expect(err('may use storage in "src').column).toBe(20);
  });

  it("suggests a near miss for a capability", () => {
    expect(err("may use cookie").message).toContain("did you mean 'cookies'?");
    expect(err("may use localstorage").message).toContain("did you mean 'local storage'?");
    expect(err("may use sesion storage").message).toContain("did you mean 'session storage'?");
    expect(err("may use storage.locl").message).toContain("did you mean 'storage.local'?");
  });

  it("does not suggest when nothing is close", () => {
    expect(err("may use teleportation").message).not.toContain("did you mean");
  });

  it("until on a forbid is an error", () => {
    const e = err("forbid cookies until 2026-12-01");
    expect(e.message).toContain("'until' only applies to 'may' rules; a forbid does not expire");
    expect(e.column).toBe(16);
  });

  it("absolute paths are an error", () => {
    const e = err('may use storage in "/srv/app/src/*"');
    expect(e.message).toContain("paths are relative to the policy file, not absolute");
    expect(e.column).toBe(20);
  });

  it("a second until or in is an error", () => {
    expect(err("may use storage until 2026-01-01 until 2026-02-01").message).toContain("'until' given twice");
    expect(err('may use storage in "a" in "b"').message).toContain("'in' given twice");
  });

  it("an empty path is an error", () => {
    expect(err('may use storage in ""').message).toContain("empty path");
  });

  it("in with a trailing comma", () => {
    expect(err('may use storage in "a",').message).toContain("expected another quoted path after the comma");
  });

  it("does not crash on a comment-only policy", () => {
    expect(parse("-- nothing here").rules).toEqual([]);
  });
});
