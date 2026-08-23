import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Linter } from "eslint";
import plugin from "../src/eslint.js";

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-eslint-"));
  fs.writeFileSync(
    path.join(dir, "frostjs.policy"),
    ["may use session storage", "forbid cookies -- consent banner owns these", 'may reach "api.example.com"', ""].join(
      "\n",
    ),
  );
  return dir;
}

function lint(
  dir: string,
  file: string,
  code: string,
  options: Record<string, unknown> = {},
  sourceType: "module" | "script" = "module",
) {
  const linter = new Linter({ configType: "flat", cwd: dir });
  return linter.verify(
    code,
    [
      {
        files: ["**/*.js"],
        plugins: { frostjs: plugin as never },
        rules: { "frostjs/capability": ["error", { today: "2026-08-23", ...options }] },
        languageOptions: { ecmaVersion: 2022, sourceType },
      },
    ],
    { filename: path.join(dir, file) },
  );
}

describe("eslint plugin", () => {
  it("exposes the rule and a recommended config", () => {
    expect(plugin.rules.capability.meta.type).toBe("problem");
    expect((plugin.configs["recommended"] as { rules: Record<string, string> }).rules["frostjs/capability"]).toBe(
      "error",
    );
  });

  it("reports denials at the use's position with the policy line", () => {
    const dir = project();
    const msgs = lint(
      dir,
      "app.js",
      'sessionStorage.x;\nconst c = document.cookie;\n  localStorage.setItem("a", 1);\n',
    );
    expect(msgs.map((m) => [m.line, m.column, m.message])).toEqual([
      [2, 11, 'storage.cookie denied by "forbid cookies" (line 2): consent banner owns these'],
      [3, 3, "storage.local denied by default (no rule grants it)"],
    ]);
    expect(msgs.every((m) => m.ruleId === "frostjs/capability")).toBe(true);
  });

  it("network targets are named", () => {
    const dir = project();
    const msgs = lint(dir, "app.js", 'fetch("https://api.example.com/x"); fetch("https://evil.example/x");');
    expect(msgs.map((m) => m.message)).toEqual(["network.fetch to evil.example denied by default (no rule grants it)"]);
  });

  it("finds the nearest policy above the file and scopes globs to it", () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, "src", "legacy"), { recursive: true });
    fs.appendFileSync(path.join(dir, "frostjs.policy"), 'may use local storage in "src/legacy/*"\n');
    expect(lint(dir, "src/legacy/old.js", "localStorage.x;")).toEqual([]);
    expect(lint(dir, "src/new.js", "localStorage.x;").length).toBe(1);
  });

  it("frostjs: ignore and eslint-disable both silence a use", () => {
    const dir = project();
    expect(lint(dir, "a.js", "localStorage.x; // frostjs: ignore")).toEqual([]);
    expect(lint(dir, "a.js", "localStorage.x; // eslint-disable-line frostjs/capability")).toEqual([]);
  });

  it("unknown uses are reported only when asked", () => {
    const dir = project();
    const code = "with (o) { localStorage.x; }"; // with is script-only
    expect(lint(dir, "a.js", code, {}, "script")).toEqual([]);
    expect(lint(dir, "a.js", code, { reportUnknown: true }, "script").map((m) => m.message)).toEqual([
      "storage.local possible (not failing the build)",
    ]);
  });

  it("an explicit policy option wins over discovery", () => {
    const dir = project();
    const other = path.join(dir, "open.policy");
    fs.writeFileSync(other, "may use everything\n");
    expect(lint(dir, "a.js", "eval(s); localStorage.x;", { policy: other })).toEqual([]);
  });

  it("a broken policy is one report, not a crash", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, "frostjs.policy"), "allow storage\n");
    const msgs = lint(dir, "a.js", "localStorage.x;");
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.message).toContain("cannot read 'allow storage'");
  });

  it("no policy means deny everything, like the CLI", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-eslint-none-"));
    expect(lint(dir, "a.js", "localStorage.x;").length).toBe(1);
  });

  it("picks up a changed policy without restarting", () => {
    const dir = project();
    expect(lint(dir, "a.js", "localStorage.x;").length).toBe(1);
    const p = path.join(dir, "frostjs.policy");
    fs.writeFileSync(p, "may use local storage\n");
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(p, t, t);
    expect(lint(dir, "a.js", "localStorage.x;")).toEqual([]);
  });
});

describe("eslint plugin: ignore", () => {
  it("files the policy ignores get no reports", () => {
    const dir = project();
    fs.appendFileSync(path.join(dir, "frostjs.policy"), 'ignore "public/**"\n');
    fs.mkdirSync(path.join(dir, "public"));
    expect(lint(dir, "public/app.js", "eval(s);")).toEqual([]);
    expect(lint(dir, "src.js", "eval(s);").length).toBe(1);
  });
});
