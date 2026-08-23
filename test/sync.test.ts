import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliIn } from "./helpers.js";
import { readRegistry } from "../src/registry.js";
import { includesFor } from "../src/sync.js";
import { discover } from "../src/discover/index.js";

/** A project depending on node_modules/widget, vendored by policy, with a lockfile. */
function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "permit-sync-"));
  fs.mkdirSync(path.join(dir, "node_modules", "widget"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "permit.policy"),
    ['policy "sync-test"', 'vendored "node_modules/widget/*.js"', "may use local storage", ""].join("\n"),
  );
  setWidget(dir, "1.0.0", 'localStorage.setItem("w",1);\n');
  fs.writeFileSync(path.join(dir, "package-lock.json"), '{"name":"app","lockfileVersion":3}\n');
  fs.writeFileSync(path.join(dir, "src", "app.js"), "const a = 1;\n");
  return dir;
}

function setWidget(dir: string, version: string, source: string): void {
  fs.writeFileSync(
    path.join(dir, "node_modules", "widget", "package.json"),
    JSON.stringify({ name: "widget", version }),
  );
  fs.writeFileSync(path.join(dir, "node_modules", "widget", "index.js"), source);
}

describe("discover include", () => {
  it("includesFor names the leading directory of each glob", () => {
    expect(includesFor(["node_modules/widget/*.js", "vendor/**", "*.min.js"])).toEqual(["node_modules", "vendor"]);
  });

  it("discover can un-exclude node_modules", () => {
    const dir = project();
    expect(discover([dir]).some((f) => f.includes("node_modules"))).toBe(false);
    expect(
      discover([dir], { include: ["node_modules"] }).some((f) => f.endsWith(path.join("widget", "index.js"))),
    ).toBe(true);
  });
});

describe("permit registry sync", () => {
  it("the gate sees vendored files inside node_modules", () => {
    const dir = project();
    const r = cliIn(dir, ".");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("node_modules/widget/index.js:1:1: vendored file is not in the registry");
  });

  it("records the lockfile and re-admits a bump with the same capabilities", () => {
    const dir = project();
    expect(cliIn(dir, "vendor", "add", "node_modules/widget/index.js").code).toBe(0);
    setWidget(dir, "1.0.1", 'localStorage.setItem("w",2); // patched\n');
    const r = cliIn(dir, "registry", "sync");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "node_modules/widget/index.js: widget 1.0.0 -> 1.0.1, capabilities unchanged, re-admitted",
    );
    const reg = readRegistry(path.join(dir, ".permit", "registry.json"));
    expect(reg.lockfile?.path).toBe("package-lock.json");
    expect(reg.entries.map((e) => e.version).sort()).toEqual(["1.0.0", "1.0.1"]);
    expect(cliIn(dir, ".").code).toBe(0);
  });

  it("refuses a bump that adds a capability and shows the difference", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "node_modules/widget/index.js");
    setWidget(dir, "2.0.0", 'localStorage.setItem("w",2);fetch("https://telemetry.example/beacon");\n');
    const r = cliIn(dir, "registry", "sync");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "node_modules/widget/index.js: widget 1.0.0 -> 2.0.0 adds network.fetch to telemetry.example; NOT admitted",
    );
    expect(r.stdout).toContain("review it with: permit vendor add node_modules/widget/index.js");
    expect(readRegistry(path.join(dir, ".permit", "registry.json")).entries.length).toBe(1);
    expect(cliIn(dir, ".").code).toBe(1);
  });

  it("a bump that drops a capability is re-admitted and says what went", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "node_modules/widget/index.js");
    setWidget(dir, "1.1.0", "export const pure = 1;\n");
    const r = cliIn(dir, "registry", "sync");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("capabilities unchanged, re-admitted; no longer uses storage.local");
  });

  it("a new package is reported, not admitted", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "node_modules/widget/index.js");
    fs.mkdirSync(path.join(dir, "node_modules", "other"));
    fs.writeFileSync(
      path.join(dir, "node_modules", "other", "package.json"),
      JSON.stringify({ name: "other", version: "3.0.0" }),
    );
    fs.writeFileSync(path.join(dir, "node_modules", "other", "index.js"), "eval(x);\n");
    fs.writeFileSync(path.join(dir, "permit.policy"), 'vendored "node_modules/*/*.js"\n');
    const r = cliIn(dir, "registry", "sync");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("node_modules/other/index.js (other@3.0.0): new package, not in the registry");
  });

  it("prunes entries whose file is gone", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "node_modules/widget/index.js");
    fs.rmSync(path.join(dir, "node_modules", "widget"), { recursive: true });
    const r = cliIn(dir, "registry", "sync");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("node_modules/widget/index.js: gone, widget@1.0.0 removed from the registry");
    expect(readRegistry(path.join(dir, ".permit", "registry.json")).entries).toEqual([]);
  });

  it("warns when there is no lockfile", () => {
    const dir = project();
    fs.rmSync(path.join(dir, "package-lock.json"));
    const r = cliIn(dir, "registry", "sync");
    expect(r.stdout).toContain("warning: no lockfile found beside the policy");
  });

  it("says when the lockfile has not changed", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "node_modules/widget/index.js");
    cliIn(dir, "registry", "sync");
    expect(cliIn(dir, "registry", "sync").stdout).toContain("package-lock.json unchanged since last sync");
  });

  it("needs a subcommand", () => {
    const r = cliIn(project(), "registry");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("permit registry needs a subcommand: sync");
  });
});
