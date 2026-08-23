import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliIn } from "./helpers.js";
import { readRegistry, integrityOfFile, guessPackage } from "../src/registry.js";
import { parsePolicy } from "../src/policy/parse.js";

/** A project with one vendored library that stores and phones home. */
function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "permit-vendor-"));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "permit.policy"),
    ['policy "vendor-test"', 'vendored "lib/*.js"', "may use local storage", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "lib", "widget.min.js"),
    'localStorage.setItem("w",1);fetch("https://telemetry.example/x");document.cookie="a=1";\n',
  );
  fs.writeFileSync(path.join(dir, "src", "app.js"), 'sessionStorage.setItem("a", 1);\n');
  return dir;
}

describe("policy: vendored", () => {
  it("parses a list of globs", () => {
    const p = parsePolicy('vendored "lib/*.js", "static/vendor/**"', "permit.policy");
    expect(p.vendored).toEqual(["lib/*.js", "static/vendor/**"]);
    expect(p.rules).toEqual([]);
  });

  it("needs quoted globs", () => {
    expect(() => parsePolicy("vendored lib/*.js", "permit.policy")).toThrow(
      /'vendored' needs one or more quoted paths/,
    );
  });
});

describe("registry helpers", () => {
  it("integrity is an SRI value", () => {
    const dir = project();
    expect(integrityOfFile(path.join(dir, "lib", "widget.min.js"))).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
  });

  it("guessPackage finds the nearest package.json, else the base name", () => {
    const dir = project();
    expect(guessPackage(path.join(dir, "lib", "widget.min.js"), dir)).toEqual({
      package: "widget.min.js",
      version: "unknown",
    });
    fs.writeFileSync(path.join(dir, "lib", "package.json"), JSON.stringify({ name: "widget", version: "2.1.0" }));
    expect(guessPackage(path.join(dir, "lib", "widget.min.js"), dir)).toEqual({ package: "widget", version: "2.1.0" });
  });
});

describe("vendored files in the gate", () => {
  it("an unregistered vendored file fails the build and names the command", () => {
    const dir = project();
    const r = cliIn(dir, ".");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "lib/widget.min.js:1:1: vendored file is not in the registry; review it with: permit vendor add lib/widget.min.js",
    );
    // First-party code is still analyzed normally.
    expect(r.stdout).toContain("src/app.js:1:1: storage.session denied");
    expect(r.stdout).toContain("2 files, 2 denied");
  });

  it("permit vendor add records the capability set for review", () => {
    const dir = project();
    const r = cliIn(dir, "vendor", "add", "lib/widget.min.js");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("lib/widget.min.js (widget.min.js@unknown): 3 capability uses");
    expect(r.stdout).toContain("  network.fetch to telemetry.example");
    expect(r.stdout).toContain("  storage.cookie");
    expect(r.stdout).toContain("  storage.local");
    expect(r.stdout).toContain("added to .permit/registry.json");
    const reg = readRegistry(path.join(dir, ".permit", "registry.json"));
    expect(reg.entries.length).toBe(1);
    expect(reg.entries[0]).toMatchObject({
      package: "widget.min.js",
      file: "lib/widget.min.js",
      uses: [
        { capability: "network.fetch", target: "telemetry.example" },
        { capability: "storage.cookie", target: null },
        { capability: "storage.local", target: null },
      ],
    });
  });

  it("a registered file's capabilities are checked against the policy", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "lib/widget.min.js");
    const r = cliIn(dir, "lib");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      'lib/widget.min.js:1:1: network.fetch to telemetry.example denied by "deny everything": widget.min.js@unknown (vendored)',
    );
    expect(r.stdout).toContain("storage.cookie denied");
    expect(r.stdout).not.toContain("storage.local denied");
    expect(r.stdout).toContain("1 file, 2 denied");
  });

  it("a policy that grants what the vendored file uses passes", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "lib/widget.min.js");
    fs.appendFileSync(
      path.join(dir, "permit.policy"),
      'may reach "telemetry.example" in "lib/*"\nmay use cookies in "lib/*"\n',
    );
    expect(cliIn(dir, "lib").code).toBe(0);
  });

  it("a modified file no longer matches and is unregistered again", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "lib/widget.min.js");
    fs.appendFileSync(path.join(dir, "lib", "widget.min.js"), "eval(x);\n");
    const r = cliIn(dir, "lib");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("vendored file is not in the registry");
  });

  it("vendor add on a file the policy does not mark vendored still works, with a note", () => {
    const dir = project();
    const r = cliIn(dir, "vendor", "add", "src/app.js");
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("src/app.js is not covered by a 'vendored' line in the policy");
  });

  it("vendor add without paths is a usage error", () => {
    const r = cliIn(project(), "vendor", "add");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("permit vendor add needs one or more files");
  });
});
