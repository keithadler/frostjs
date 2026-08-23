import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changedLines, isChanged } from "../src/changed.js";
import { cli } from "./helpers.js";

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "permit-git-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "permit.policy"), 'policy "t"\n');
  fs.writeFileSync(
    path.join(dir, "a.js"),
    ["const a = 1;", 'localStorage.setItem("old", 1);', "const b = 2;", ""].join("\n"),
  );
  g("add", ".");
  g("commit", "-q", "-m", "base");
  return dir;
}

describe("changedLines", () => {
  it("reports added and modified lines on the new side, and untracked files as all", () => {
    const dir = repo();
    fs.writeFileSync(
      path.join(dir, "a.js"),
      ["const a = 1;", 'localStorage.setItem("old", 1);', "fetch(u);", "fetch(v);", "const b = 2;", ""].join("\n"),
    );
    fs.writeFileSync(path.join(dir, "new.js"), "eval(s);\n");
    const c = changedLines("HEAD", dir);
    const a = fs.realpathSync(path.join(dir, "a.js"));
    expect(isChanged(c, a, 3)).toBe(true);
    expect(isChanged(c, a, 4)).toBe(true);
    expect(isChanged(c, a, 2)).toBe(false);
    expect(isChanged(c, fs.realpathSync(path.join(dir, "new.js")), 1)).toBe(true);
    expect(isChanged(c, path.join(dir, "permit.policy"), 1)).toBe(false);
  });

  it("a ref that looks like an option is refused before git sees it", () => {
    const dir = repo();
    const marker = path.join(dir, "injected");
    expect(() => changedLines(`--output=${marker}`, dir)).toThrow(/needs a git ref, not '--output=/);
    expect(fs.existsSync(marker)).toBe(false);
    expect(() => changedLines("", dir)).toThrow(/needs a git ref/);
    expect(() => changedLines("-", dir)).toThrow(/needs a git ref/);
  });

  it("a bad ref is a clear error", () => {
    expect(() => changedLines("no-such-ref", repo())).toThrow(/git diff against no-such-ref failed/);
  });

  it("outside a repository is a clear error", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "permit-nogit-"));
    expect(() => changedLines("HEAD", dir)).toThrow(/needs a git repository/);
  });
});

describe("permit --changed-since", () => {
  it("fails only on uses in changed lines", () => {
    const dir = repo();
    fs.writeFileSync(
      path.join(dir, "a.js"),
      ["const a = 1;", 'localStorage.setItem("old", 1);', "fetch(u);", "const b = 2;", ""].join("\n"),
    );
    const r = cli("--changed-since", "HEAD", path.join(dir, "a.js"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("a.js:3:1: network.fetch denied");
    expect(r.stdout).not.toContain("storage.local denied");
    expect(r.stdout).toContain("1 file, 1 denied, 0 unknown, 1 unchanged");
  });

  it("nothing changed means exit 0 even with old violations", () => {
    const dir = repo();
    const r = cli("--changed-since", "HEAD", path.join(dir, "a.js"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("0 denied, 0 unknown, 1 unchanged");
  });

  it("an option-shaped ref exits 2 and writes nothing", () => {
    const dir = repo();
    const marker = path.join(dir, "injected");
    const r = cli(`--changed-since=--output=${marker}`, path.join(dir, "a.js"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("needs a git ref");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("a bad ref exits 2", () => {
    const dir = repo();
    const r = cli("--changed-since", "nope", path.join(dir, "a.js"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("git diff against nope failed");
  });
});
