import { describe, expect, it } from "vitest";
import path from "node:path";
import { cli, cliIn } from "./helpers.js";
import { VERSION } from "../src/version.js";

describe("frostjs --version", () => {
  it("prints the package version and exits 0", () => {
    const r = cli("--version");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`frostjs ${VERSION}\n`);
    expect(r.stderr).toBe("");
  });

  it("accepts -V", () => {
    expect(cli("-V").stdout).toBe(`frostjs ${VERSION}\n`);
  });

  it("version matches package.json", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("frostjs --help", () => {
  it("prints usage and exits 0", () => {
    const r = cli("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage: frostjs");
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

describe("frostjs <paths> (step 2: discover and parse)", () => {
  const root = path.join(__dirname, "fixtures", "discover");

  it("parses discovered files and reports a count", () => {
    const r = cli(root);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("frostjs: no frostjs.policy found; denying everything\n");
    expect(r.stdout).toContain("4 files");
  });

  it("reports syntax errors with file:line:column and exits 2", () => {
    const broken = path.join(__dirname, "fixtures", "broken.js");
    const r = cli(broken);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/\ntest\/fixtures\/broken\.js:1:7: syntax error: Unexpected token/);
  });

  it("exits 2 on a missing path", () => {
    const r = cli(path.join(root, "nope"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("path not found");
  });

  it("honors --exclude", () => {
    const r = cli("--exclude", "nested", root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("3 files");
  });

  it("errors when no paths are given", () => {
    const r = cli();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no paths given");
  });
});

describe("frostjs <paths> (step 4: deny-all gate)", () => {
  const fx = path.join(__dirname, "fixtures", "deny");

  it("acceptance: localStorage.setItem fails the build and names the line", () => {
    const f = path.join(fx, "violation.js");
    const r = cli(f);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      `test/fixtures/deny/violation.js:2:3: storage.local denied by default (no rule grants it): localStorage.setItem("a", 1)`,
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
    expect(r.stdout).toContain("test/fixtures/deny/shadowed.js:2:3: storage.cache possible: caches.x");
  });

  it("--min-confidence possible makes an unknown fail", () => {
    const r = cli("--min-confidence", "possible", path.join(fx, "shadowed.js"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("storage.cache denied");
  });

  it("--min-confidence rejects other words", () => {
    const r = cli("--min-confidence", "high", path.join(fx, "clean.js"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--min-confidence must be certain, probable or possible");
  });

  it("--exit-zero reports but never fails", () => {
    const r = cli("--exit-zero", path.join(fx, "violation.js"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("1 denied");
  });
});

describe("frostjs <paths> (step 7: policy discovery)", () => {
  const proj = path.join(__dirname, "fixtures", "proj");

  it("finds frostjs.policy above the inputs and applies it", () => {
    const r = cli("--today", "2026-08-23", path.join(proj, "src"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      'test/fixtures/proj/src/app.js:2:1: storage.local denied by default (no rule grants it): localStorage.setItem("not-here", 1)',
    );
    expect(r.stdout).toContain(
      'test/fixtures/proj/src/legacy/old.js:2:1: storage.cookie denied by "forbid cookies" (line 4): consent banner owns these: document.cookie',
    );
    expect(r.stdout).not.toContain("fine-here");
    expect(r.stdout).not.toContain('"ok"');
    expect(r.stdout).toContain("3 files, 2 denied, 0 unknown");
  });

  it("warns about a grant that is about to expire", () => {
    const r = cli("--today", "2026-08-23", path.join(proj, "src", "sw.js"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      'warning: test/fixtures/proj/frostjs.policy line 5: "may use the cache until 2026-08-30" expires in 7 days',
    );
  });

  it("an expired grant denies with its own message", () => {
    const r = cli("--today", "2026-09-01", path.join(proj, "src", "sw.js"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      'storage.cache denied (grant expired 2026-08-30) by "may use the cache until 2026-08-30" (line 5): service worker experiment: caches.open("v1")',
    );
  });

  it("nearest policy wins for a nested directory", () => {
    const r = cli(path.join(proj, "tenant"));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("1 file, 0 denied, 0 unknown\n");
  });

  it("--policy overrides discovery and scopes paths to the policy's directory", () => {
    const r = cli("--policy", path.join(proj, "tenant", "frostjs.policy"), path.join(proj, "src"));
    expect(r.code).toBe(0);
  });

  it("no policy found means deny everything, with a note on stderr", () => {
    const r = cli(path.join(__dirname, "fixtures", "deny", "clean.js"));
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("no frostjs.policy found");
  });

  it("a policy that does not parse exits 2 with file and line", () => {
    const r = cli(path.join(__dirname, "fixtures", "bad"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("test/fixtures/bad/frostjs.policy line 2: cannot read 'allow cookies'");
    expect(r.stderr).toContain("try: may use cookies");
  });

  it("--policy pointing at a missing file exits 2", () => {
    const r = cli("--policy", path.join(proj, "nope.policy"), path.join(proj, "src"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("cannot read policy");
  });

  it("--today must be a date", () => {
    const r = cli("--today", "yesterday", path.join(proj, "src"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--today must be a date like 2026-12-01");
  });
});

describe("frostjs <paths> (step 19: inline suppression)", () => {
  it("suppressed uses do not fail and are counted", () => {
    const r = cli(path.join(__dirname, "fixtures", "suppress"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("suppressed.js:6:1: storage.session denied");
    expect(r.stdout).not.toContain("storage.local denied");
    expect(r.stdout).toContain("1 file, 1 denied, 0 unknown, 2 suppressed");
  });
});

describe("frostjs <paths> (policy ignore)", () => {
  it("ignored files are neither analyzed nor counted", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-ignore-"));
    fs.mkdirSync(path.join(dir, "public"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), 'ignore "public/*.min.js"\n');
    fs.writeFileSync(path.join(dir, "public", "app.min.js"), "eval(x);\n");
    fs.writeFileSync(path.join(dir, "app.js"), "localStorage.x;\n");
    const r = cliIn(dir, ".");
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain("app.min.js");
    expect(r.stdout).toContain("1 file, 1 denied");
  });
});

describe("frostjs check (HTML attributes)", () => {
  const fx = path.join(__dirname, "fixtures", "html");
  it("flags inline handlers, javascript: URLs, remote src and srcdoc in HTML", () => {
    const r = cli(path.join(fx, "page.html"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("page.html:4:11: network.resource to cdn.evil.example denied");
    expect(r.stdout).toContain("dom-escape.handler denied");
    expect(r.stdout).toContain("codegen.eval denied");
    expect(r.stdout).toContain("srcdoc");
    expect(r.stdout).not.toContain("logo.png"); // same-origin img stays quiet
  });
});

describe("frostjs check --unused", () => {
  const project = (policy: string, code: string) => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-unused-"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), policy);
    fs.writeFileSync(path.join(dir, "a.js"), code);
    return dir;
  };

  it("lists grants that matched nothing, on stderr, without changing the exit code", () => {
    const dir = project(
      'policy "t"\nmay use local storage\nmay use session storage\nmay reach "api.example.com"\n',
      'localStorage.setItem("a", 1);\n',
    );
    const r = cli("--unused", dir);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("2 grants matched nothing");
    expect(r.stderr).toContain("line 3: may use session storage");
    expect(r.stderr).toContain('line 4: may reach "api.example.com"');
    expect(r.stderr).not.toContain("local storage"); // it matched
  });

  it("flags a redundant specific grant shadowed by a family grant", () => {
    const dir = project('policy "t"\nmay use storage\nmay use local storage\n', "localStorage.x;\n");
    const r = cli("--unused", dir);
    expect(r.stderr).toContain("line 3: may use local storage"); // family on line 2 decides
    expect(r.stderr).not.toContain("line 2");
  });

  it("says so when every grant is used, and stays off stdout (json stays valid)", () => {
    const dir = project('policy "t"\nmay use local storage\n', "localStorage.x;\n");
    const r = cli("--unused", "--format", "json", dir);
    expect(r.stderr).toContain("every grant matched at least one use");
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});
