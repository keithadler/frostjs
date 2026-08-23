import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/policy/parse.js";
import { compile } from "../src/policy/compile.js";
import type { CapabilityUse } from "../src/extract/capability.js";

const TODAY = "2026-08-23";

const policy = (text: string, today = TODAY) => compile(parsePolicy(text, "permit.policy"), { today });

const use = (capability: string, file = "src/app.js"): CapabilityUse => ({
  capability,
  target: null,
  file,
  line: 1,
  column: 1,
  expression: "x",
  confidence: "certain",
  origin: "first-party",
});

describe("compile: grants", () => {
  it("empty policy grants nothing", () => {
    const p = policy("");
    const e = p.evaluate(use("storage.local"));
    expect(e).toMatchObject({ verdict: "denied", reason: "not granted", rule: null });
  });

  it("exact code", () => {
    const p = policy("may use local storage");
    expect(p.evaluate(use("storage.local")).verdict).toBe("allowed");
    expect(p.evaluate(use("storage.session")).verdict).toBe("denied");
  });

  it("family grants every member", () => {
    const p = policy("may use storage");
    expect(p.evaluate(use("storage.local")).verdict).toBe("allowed");
    expect(p.evaluate(use("storage.cookie")).verdict).toBe("allowed");
    expect(p.evaluate(use("network.fetch")).verdict).toBe("denied");
  });

  it("family prefix does not match a different family with the same prefix", () => {
    const p = policy("may use storage");
    expect(p.evaluate(use("storagex.thing")).verdict).toBe("denied");
  });

  it("everything", () => {
    expect(policy("may use everything").evaluate(use("codegen.eval")).verdict).toBe("allowed");
  });

  it("names the granting rule", () => {
    const e = policy("may use cookies -- consent").evaluate(use("storage.cookie"));
    expect(e.rule?.text).toBe("may use cookies");
    expect(e.rule?.line).toBe(1);
    expect(e.rule?.hint).toBe("consent");
  });
});

describe("compile: path scoping", () => {
  it("grant applies only inside its paths", () => {
    const p = policy('may use cookies in "src/legacy/*"');
    expect(p.evaluate(use("storage.cookie", "src/legacy/banner.js")).verdict).toBe("allowed");
    expect(p.evaluate(use("storage.cookie", "src/app.js")).verdict).toBe("denied");
  });

  it("any of several paths", () => {
    const p = policy('may use cookies in "a/*", "b/**"');
    expect(p.evaluate(use("storage.cookie", "b/x/y.js")).verdict).toBe("allowed");
    expect(p.evaluate(use("storage.cookie", "c/y.js")).verdict).toBe("denied");
  });

  it("forbid can be scoped too", () => {
    const p = policy('may use storage\nforbid cookies in "src/public/*"');
    expect(p.evaluate(use("storage.cookie", "src/public/a.js")).verdict).toBe("denied");
    expect(p.evaluate(use("storage.cookie", "src/admin/a.js")).verdict).toBe("allowed");
  });
});

describe("compile: forbid wins", () => {
  it("over a broader grant regardless of order", () => {
    const a = policy("may use storage\nforbid cookies");
    const b = policy("forbid cookies\nmay use storage");
    for (const p of [a, b]) {
      const e = p.evaluate(use("storage.cookie"));
      expect(e).toMatchObject({ verdict: "denied", reason: "forbidden" });
      expect(e.rule?.text).toBe("forbid cookies");
      expect(p.evaluate(use("storage.local")).verdict).toBe("allowed");
    }
  });

  it("forbid everything else is a no-op", () => {
    const p = policy("may use storage\nforbid everything else");
    expect(p.evaluate(use("storage.local")).verdict).toBe("allowed");
    expect(p.evaluate(use("network.fetch"))).toMatchObject({ verdict: "denied", reason: "not granted" });
  });
});

describe("compile: expiry", () => {
  it("grant holds until its date inclusive", () => {
    const p = policy("may use storage until 2026-08-23");
    expect(p.evaluate(use("storage.local")).verdict).toBe("allowed");
  });

  it("expired grant denies with a distinct reason and names the rule", () => {
    const p = policy("may use storage until 2026-08-22 -- migration");
    const e = p.evaluate(use("storage.local"));
    expect(e).toMatchObject({ verdict: "denied", reason: "expired" });
    expect(e.rule?.until).toBe("2026-08-22");
    expect(e.rule?.hint).toBe("migration");
  });

  it("another live grant still allows", () => {
    const p = policy("may use storage until 2026-01-01\nmay use local storage");
    expect(p.evaluate(use("storage.local")).verdict).toBe("allowed");
  });

  it("warns inside the 14-day window, not outside it", () => {
    expect(policy("may use storage until 2026-09-06").warnings).toEqual([
      'permit.policy line 1: "may use storage until 2026-09-06" expires in 14 days',
    ]);
    expect(policy("may use storage until 2026-08-24").warnings[0]).toContain("expires in 1 day");
    expect(policy("may use storage until 2026-08-23").warnings[0]).toContain("expires today");
    expect(policy("may use storage until 2026-09-07").warnings).toEqual([]);
    expect(policy("may use storage until 2026-08-01").warnings).toEqual([]);
  });

  it("window is configurable", () => {
    const p = compile(parsePolicy("may use storage until 2026-09-20", "p"), { today: TODAY, warnDays: 30 });
    expect(p.warnings.length).toBe(1);
  });
});

describe("compile: name", () => {
  it("carries the policy name", () => {
    expect(policy('policy "widget"').name).toBe("widget");
  });
});

describe("compile: network hosts", () => {
  const net = (target: string | null, file = "src/app.js"): CapabilityUse => ({
    ...use("network.fetch", file),
    target,
  });

  it("may reach allows only the named hosts", () => {
    const p = policy('may reach "api.example.com", "*.internal"');
    expect(p.evaluate(net("api.example.com")).verdict).toBe("allowed");
    expect(p.evaluate(net("db.internal")).verdict).toBe("allowed");
    expect(p.evaluate(net("API.EXAMPLE.COM")).verdict).toBe("allowed");
    expect(p.evaluate(net("evil.example.com"))).toMatchObject({ verdict: "denied", reason: "not granted" });
  });

  it("a destination that cannot be read is not allowed by a host list", () => {
    const p = policy('may reach "api.example.com"');
    const e = p.evaluate(net(null));
    expect(e).toMatchObject({ verdict: "denied", reason: "unknown destination" });
    expect(e.rule?.text).toBe('may reach "api.example.com"');
  });

  it("may use the network allows any destination, known or not", () => {
    const p = policy("may use the network");
    expect(p.evaluate(net(null)).verdict).toBe("allowed");
    expect(p.evaluate(net("anything.example")).verdict).toBe("allowed");
  });

  it("same-origin is a host name in the policy", () => {
    const p = policy('may reach "same-origin"');
    expect(p.evaluate(net("same-origin")).verdict).toBe("allowed");
    expect(p.evaluate(net("api.example.com")).verdict).toBe("denied");
  });

  it("forbid reaching wins over a blanket grant", () => {
    const p = policy('may use the network\nforbid reaching "*.telemetry.example" -- no reporting');
    const e = p.evaluate(net("x.telemetry.example"));
    expect(e).toMatchObject({ verdict: "denied", reason: "forbidden" });
    expect(p.evaluate(net("api.example.com")).verdict).toBe("allowed");
  });

  it("forbid reaching does not fire on an unknown destination", () => {
    // A forbid names what you fear; it cannot match what it cannot read. The allow side handles unknowns.
    const p = policy('may use the network\nforbid reaching "*.telemetry.example"');
    expect(p.evaluate(net(null)).verdict).toBe("allowed");
  });

  it("host patterns: * spans labels, match is whole-host", () => {
    const p = policy('may reach "*.example.com"');
    expect(p.evaluate(net("a.b.example.com")).verdict).toBe("allowed");
    expect(p.evaluate(net("example.com")).verdict).toBe("denied");
    expect(p.evaluate(net("xexample.com")).verdict).toBe("denied");
  });

  it("applies to every member of the network family", () => {
    const p = policy('may reach "ws.example.com"');
    expect(p.evaluate({ ...net("ws.example.com"), capability: "network.websocket" }).verdict).toBe("allowed");
  });
});
