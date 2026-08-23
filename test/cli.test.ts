import { describe, expect, it } from "vitest";
import path from "node:path";
import { cli } from "./helpers.js";
import { VERSION } from "../src/version.js";

describe("permit --version", () => {
  it("prints the package version and exits 0", () => {
    const r = cli("--version");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`permit ${VERSION}\n`);
    expect(r.stderr).toBe("");
  });

  it("accepts -V", () => {
    expect(cli("-V").stdout).toBe(`permit ${VERSION}\n`);
  });

  it("version matches package.json", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("permit --help", () => {
  it("prints usage and exits 0", () => {
    const r = cli("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage: permit");
    expect(r.stdout).toContain("--version");
  });
});

describe("unknown options", () => {
  it("exits 2 with a message", () => {
    const r = cli("--bogus");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown option: --bogus");
  });
});

describe("permit <paths> (step 2: discover and parse)", () => {
  const root = path.join(__dirname, "fixtures", "discover");

  it("parses discovered files and reports a count", () => {
    const r = cli(root);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("3 files");
  });

  it("reports syntax errors with file:line:column and exits 2", () => {
    const broken = path.join(__dirname, "fixtures", "broken.js");
    const r = cli(broken);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^test\/fixtures\/broken\.js:1:7: syntax error: Unexpected token/);
  });

  it("exits 2 on a missing path", () => {
    const r = cli(path.join(root, "nope"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("path not found");
  });

  it("honours --exclude", () => {
    const r = cli("--exclude", "nested", root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 files");
  });

  it("errors when no paths are given", () => {
    const r = cli();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no paths given");
  });
});

describe("permit <paths> (step 4: deny-all gate)", () => {
  const fx = path.join(__dirname, "fixtures", "deny");

  it("acceptance: localStorage.setItem fails the build and names the line", () => {
    const f = path.join(fx, "violation.js");
    const r = cli(f);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      `test/fixtures/deny/violation.js:2:3: storage.local denied by "deny everything": localStorage.setItem("a", 1)`,
    );
    expect(r.stdout).toContain("1 file, 1 denied, 0 unknown");
  });

  it("clean file exits 0", () => {
    const r = cli(path.join(fx, "clean.js"));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("1 file, 0 denied, 0 unknown\n");
  });

  it("possible-only uses do not fail the build", () => {
    const r = cli(path.join(fx, "shadowed.js"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("unknown (not failing the build):");
    expect(r.stdout).toContain("storage.cache possible: caches.x");
  });

  it("--exit-zero reports but never fails", () => {
    const r = cli("--exit-zero", path.join(fx, "violation.js"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("1 denied");
  });
});
