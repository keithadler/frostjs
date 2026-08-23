import { describe, expect, it } from "vitest";
import path from "node:path";
import { compile, parsePolicy } from "../src/policy/index.js";
import { csp } from "../src/policy/csp.js";
import { summary } from "../src/report/summary.js";
import { cli, cliIn } from "./helpers.js";

const TODAY = "2026-08-23";
const policy = (text: string) => compile(parsePolicy(text, "permit.policy"), { today: TODAY });

describe("csp", () => {
  it("empty policy locks connections down", () => {
    expect(csp(policy(""), TODAY)).toBe("connect-src 'none'; script-src 'self'");
  });

  it("may reach becomes connect-src", () => {
    expect(csp(policy('may reach "api.example.com", "*.internal", "same-origin"'), TODAY)).toBe(
      // may reach grants the whole network family to those hosts, dynamic import included.
      "connect-src api.example.com *.internal 'self'; script-src 'self' api.example.com *.internal",
    );
  });

  it("may use the network is any destination", () => {
    expect(csp(policy("may use the network"), TODAY)).toContain("connect-src *");
  });

  it("code generation needs unsafe-eval", () => {
    expect(csp(policy("may use eval"), TODAY)).toContain("script-src 'self' 'unsafe-eval'");
    expect(csp(policy("may use code generation"), TODAY)).toContain("'unsafe-eval'");
    expect(csp(policy("may use storage"), TODAY)).not.toContain("unsafe-eval");
  });

  it("dynamic import and workers add hosts to script-src and worker-src", () => {
    const p = policy('may reach "cdn.example.com"\nmay use workers');
    expect(csp(p, TODAY)).toBe(
      "connect-src cdn.example.com; script-src 'self' cdn.example.com; worker-src 'self' cdn.example.com",
    );
  });

  it("expired grants do not widen the header; scoped ones do", () => {
    expect(csp(policy('may reach "old.example.com" until 2026-01-01'), TODAY)).toContain("connect-src 'none'");
    expect(csp(policy('may reach "x.example.com" in "src/legacy/*"'), TODAY)).toContain("connect-src x.example.com");
  });

  it("everything", () => {
    expect(csp(policy("may use everything"), TODAY)).toBe(
      "connect-src *; script-src 'self' 'unsafe-eval' *; worker-src 'self' *",
    );
  });
});

describe("summary", () => {
  it("reads as plain English", () => {
    const p = policy(
      [
        'policy "checkout-widget"',
        'may reach "api.example.com", "same-origin"',
        "may use session storage",
        'may use local storage in "src/legacy/*" until 2026-12-01 -- migrating',
        "forbid cookies -- consent banner owns these",
      ].join("\n"),
    );
    expect(summary(p, TODAY)).toBe(
      [
        'Policy "checkout-widget" (permit.policy)',
        "",
        "This code may:",
        "  - reach api.example.com, its own origin (line 2)",
        "  - use session storage (line 3)",
        "  - use local storage, only in src/legacy/*, until 2026-12-01 (line 4) - migrating",
        "",
        "It may not, even where a broader grant would allow it:",
        "  - use cookies (line 5) - consent banner owns these",
        "",
        "Everything else is denied. In particular this code may not use: code generation, html injection, identity, navigation, globals, workers.",
        "",
      ].join("\n"),
    );
  });

  it("empty policy", () => {
    const s = summary(policy(""), TODAY);
    expect(s).toContain("  - nothing; every capability is denied");
    expect(s).toContain("may not use: storage, the network, code generation");
  });

  it("marks expired grants and repeats warnings", () => {
    const s = summary(policy("may use storage until 2026-01-01\nmay use eval until 2026-08-30"), TODAY);
    expect(s).toContain("use storage, expired 2026-01-01");
    expect(s).toContain("Warning: permit.policy line 2");
  });
});

describe("permit csp / permit summary", () => {
  const proj = path.join(__dirname, "fixtures", "proj");

  it("csp prints the header and nothing else", () => {
    const r = cli("csp", "--policy", path.join(proj, "permit.policy"));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("connect-src 'none'; script-src 'self'\n");
    expect(r.stderr).toBe("");
  });

  it("summary prints the plain-English report", () => {
    const r = cli("summary", "--today", TODAY, "--policy", path.join(proj, "permit.policy"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Policy "proj"');
    expect(r.stdout).toContain("  - use cookies (line 4) - consent banner owns these");
    expect(r.stdout).toContain("Warning:");
  });

  it("both find the policy from the working directory", () => {
    const r = cliIn(proj, "csp");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("connect-src");
  });

  it("no policy is an error for these commands", () => {
    const r = cliIn(path.join(__dirname, "fixtures", "discover"), "csp");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no permit.policy found");
  });

  it("help lists the commands", () => {
    expect(cli("--help").stdout).toContain("permit csp");
    expect(cli("--help").stdout).toContain("permit summary");
  });
});
