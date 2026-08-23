import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliIn } from "./helpers.js";
import { starterPolicy } from "../src/init.js";
import type { CapabilityUse } from "../src/extract/capability.js";

const use = (capability: string, file: string, target: string | null = null): CapabilityUse => ({
  capability,
  target,
  file,
  line: 1,
  column: 1,
  expression: "x",
  confidence: "certain",
  origin: "first-party",
  suppressed: false,
});

describe("starterPolicy", () => {
  it("names the policy, explains itself, and grants each capability with where it is used", () => {
    // A member code with a phrase (storage.local: local storage) is written as the phrase;
    // one without (codegen.eval) is written as the code, which the policy accepts.
    const text = starterPolicy(
      "shop",
      [use("storage.local", "src/cart.js"), use("storage.local", "src/prefs.js"), use("codegen.eval", "src/old.js")],
      "2026-08-23",
    );
    expect(text).toBe(
      [
        'policy "shop"',
        "-- Written by frostjs init on 2026-08-23 from what the code does today.",
        "-- Every line below is a grant. Delete the ones that should not be",
        "-- allowed and the build will start refusing them. Add an expiry",
        "-- (until YYYY-MM-DD) to anything that is meant to go away.",
        "",
        'may use codegen.eval in "src/old.js"   -- used in src/old.js',
        'may use local storage in "src/cart.js", "src/prefs.js"   -- used in src/cart.js, src/prefs.js',
        "",
      ].join("\n"),
    );
  });

  it("stops scoping past three files and says how many more", () => {
    const uses = ["a", "b", "c", "d", "e"].map((f) => use("storage.cookie", `src/${f}.js`));
    const text = starterPolicy("p", uses, "2026-08-23");
    expect(text).toContain("may use cookies   -- used in src/a.js, src/b.js, src/c.js and 2 more");
  });

  it("known destinations become may reach; an unreadable one becomes may use the network with a hint", () => {
    const known = starterPolicy(
      "p",
      [
        use("network.fetch", "src/api.js", "api.example.com"),
        use("network.websocket", "src/live.js", "ws.example.com"),
      ],
      "2026-08-23",
    );
    expect(known).toContain('may reach "api.example.com", "ws.example.com" in "src/api.js", "src/live.js"');
    const mixed = starterPolicy(
      "p",
      [use("network.fetch", "src/api.js", "api.example.com"), use("network.fetch", "src/dyn.js", null)],
      "2026-08-23",
    );
    expect(mixed).toContain(
      'may use the network in "src/api.js", "src/dyn.js"   -- 1 use whose destination cannot be read; narrow this to: may reach "api.example.com"',
    );
  });

  it("ignores possible and suppressed uses, and says so when nothing is left", () => {
    const text = starterPolicy(
      "p",
      [
        { ...use("storage.local", "a.js"), confidence: "possible" },
        { ...use("codegen.eval", "b.js"), suppressed: true },
      ],
      "2026-08-23",
    );
    expect(text).not.toContain("may ");
    expect(text).toContain("Nothing found");
  });
});

describe("frostjs init", () => {
  function project(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-init-"));
    fs.mkdirSync(path.join(dir, "src", "legacy"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src", "app.js"),
      'sessionStorage.setItem("a", 1);\nfetch("https://api.example.com/x");\n',
    );
    fs.writeFileSync(path.join(dir, "src", "legacy", "old.js"), "el.innerHTML = s;\ndocument.cookie = c;\n");
    fs.writeFileSync(path.join(dir, "src", "clean.js"), "export const n = 1;\n");
    return dir;
  }

  it("writes a policy the check then passes", () => {
    const dir = project();
    const init = cliIn(dir, "init", "--today", "2026-08-23", "src");
    expect(init.code).toBe(0);
    expect(init.stderr).toContain("wrote frostjs.policy with 4 grants from 3 files");
    const written = fs.readFileSync(path.join(dir, "frostjs.policy"), "utf8");
    expect(written).toBe(init.stdout);
    expect(written).toContain('may reach "api.example.com" in "src/app.js"');
    expect(written).toContain('may use cookies in "src/legacy/old.js"');
    expect(written).toContain('may use dom-escape.html in "src/legacy/old.js"');
    expect(written).toContain('may use session storage in "src/app.js"');

    const check = cliIn(dir, "src");
    expect(check.code).toBe(0);
    expect(check.stdout).toBe("3 files, 0 denied, 0 unknown\n");
  });

  it("a deleted grant starts refusing", () => {
    const dir = project();
    cliIn(dir, "init", "src");
    const p = path.join(dir, "frostjs.policy");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/^may use cookies.*\n/m, ""));
    const check = cliIn(dir, "src");
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("storage.cookie denied by default");
  });

  it("defaults to the current directory and refuses to overwrite", () => {
    const dir = project();
    expect(cliIn(dir, "init").code).toBe(0);
    const again = cliIn(dir, "init");
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("frostjs.policy already exists here");
  });

  it("help lists it", () => {
    expect(cliIn(project(), "--help").stdout).toContain("frostjs init");
  });
});
