import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const proj = path.join(root, "test", "fixtures", "proj");

function action(env: Record<string, string>) {
  return spawnSync("bash", [path.join(root, "scripts", "action.sh")], {
    cwd: proj,
    env: { ...process.env, FROSTJS_BIN: path.join(root, "dist", "cli", "main.js"), ...env },
    encoding: "utf8",
  });
}

describe("GitHub Action", () => {
  it("action.yml passes every input through env, never into the script body", () => {
    const yml = fs.readFileSync(path.join(root, "action.yml"), "utf8");
    expect(yml).toContain("FROSTJS_PATHS: ${{ inputs.paths }}");
    expect(yml).toContain("FROSTJS_ARGS: ${{ inputs.args }}");
    expect(yml).toContain("FROSTJS_FAIL_ON_FINDINGS: ${{ inputs.fail-on-findings }}");
    // The run lines must not mention inputs at all.
    const runLines = yml.split("\n").filter((l) => l.trim().startsWith("run:"));
    expect(runLines.length).toBeGreaterThan(0);
    for (const l of runLines) expect(l).not.toContain("inputs.");
  });

  it("runs frostjs with the github format and fails on findings", () => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore" });
    const r = action({ FROSTJS_PATHS: "src", FROSTJS_ARGS: "--today 2026-08-23" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("::error file=src/app.js,line=2,col=1");
    expect(r.stdout).toContain("3 files, 2 denied");
  });

  it("fail-on-findings=false reports but exits 0", () => {
    const r = action({ FROSTJS_PATHS: "src", FROSTJS_ARGS: "--today 2026-08-23", FROSTJS_FAIL_ON_FINDINGS: "false" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("2 denied");
  });

  it("a malicious-looking input is an argument, not a command", () => {
    const r = action({ FROSTJS_PATHS: "src; echo INJECTED", FROSTJS_ARGS: "--today 2026-08-23" });
    expect(r.stdout + r.stderr).not.toContain("INJECTED");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("path not found: src;");
  });
});

describe("pre-commit hook", () => {
  it("declares the frostjs entry for JavaScript files", () => {
    const y = fs.readFileSync(path.join(root, ".pre-commit-hooks.yaml"), "utf8");
    expect(y).toContain("id: frostjs");
    expect(y).toContain("entry: frostjs");
    expect(y).toContain("language: node");
  });
});
