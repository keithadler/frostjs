import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliIn } from "./helpers.js";
import { integrityOfFile } from "../src/registry.js";

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-sri-"));
  fs.mkdirSync(path.join(dir, "vendor"));
  fs.writeFileSync(path.join(dir, "frostjs.policy"), 'vendored "vendor/*.js"\nmay use local storage\n');
  fs.writeFileSync(path.join(dir, "vendor", "a.js"), 'localStorage.setItem("a",1);\n');
  fs.writeFileSync(path.join(dir, "vendor", "b.js"), "const b = 2;\n");
  return dir;
}

describe("frostjs sri", () => {
  it("prints path and integrity for every registered vendored file", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "vendor/a.js", "vendor/b.js");
    const r = cliIn(dir, "sri");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      `vendor/a.js ${integrityOfFile(path.join(dir, "vendor", "a.js"))}\n` +
        `vendor/b.js ${integrityOfFile(path.join(dir, "vendor", "b.js"))}\n`,
    );
  });

  it("--format html prints script tags", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "vendor/a.js");
    const r = cliIn(dir, "sri", "--format", "html", "vendor/a.js");
    expect(r.stdout).toBe(
      `<script src="vendor/a.js" integrity="${integrityOfFile(path.join(dir, "vendor", "a.js"))}" crossorigin="anonymous"></script>\n`,
    );
  });

  it("--format json prints a map", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "vendor/a.js");
    const r = cliIn(dir, "sri", "--format", "json", "vendor/a.js");
    expect(JSON.parse(r.stdout)).toEqual({ "vendor/a.js": integrityOfFile(path.join(dir, "vendor", "a.js")) });
  });

  it("an unregistered vendored file is refused: the browser would be enforcing a hash nobody reviewed", () => {
    const dir = project();
    cliIn(dir, "vendor", "add", "vendor/a.js");
    const r = cliIn(dir, "sri");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("vendor/a.js sha384-");
    expect(r.stderr).toContain("vendor/b.js: not in the registry; review it with: frostjs vendor add vendor/b.js");
  });

  it("non-vendored files are ignored", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, "app.js"), "const x = 1;\n");
    cliIn(dir, "vendor", "add", "vendor/a.js", "vendor/b.js");
    const r = cliIn(dir, "sri", ".");
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("app.js");
  });
});
