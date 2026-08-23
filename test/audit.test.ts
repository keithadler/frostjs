import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { audit, formatAudit, groupByFile, isDynamicCodegen, literalHostsIn } from "../src/audit.js";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";
import { cliIn } from "./helpers.js";

const usesOf = (file: string, src: string) => extract(parseSource(file, src)).map((u) => ({ ...u, file }));

describe("isDynamicCodegen", () => {
  const cg = (src: string) => usesOf("a.js", src).filter(isDynamicCodegen).length;
  it("counts non-constant input", () => {
    expect(cg("eval(data.script)")).toBe(1);
    expect(cg("new Function(src)")).toBe(1);
    expect(cg('new Function("a", body)')).toBe(1);
    expect(cg('setTimeout("x(" + y + ")", 0)')).toBe(1);
  });
  it("ignores the global-this idiom, constants, bare references, and document.write", () => {
    expect(cg('Function("return this")()')).toBe(0);
    expect(cg('new Function("return this")')).toBe(0);
    expect(cg('eval("1+1")')).toBe(0);
    expect(cg("typeof eval")).toBe(0);
    expect(cg("document.write(s)")).toBe(0);
  });
});

describe("literalHostsIn", () => {
  it("finds hosts in quoted URLs and drops documentation hosts", () => {
    const text =
      'injectScript("https://cdn.jsdelivr.net/npm/peerjs"); // see https://developer.mozilla.org/x\nconst u = `https://api.example.net/v1`; "http://github.com/a"';
    expect(literalHostsIn(text)).toEqual(["api.example.net", "cdn.jsdelivr.net"]);
  });
});

describe("audit", () => {
  const ecsyLike = [
    'function inject(src) { var s = document.createElement("script"); s.src = src; }',
    'inject("https://cdn.jsdelivr.net/npm/peerjs@0.3.20/dist/peer.min.js");',
    'if (new URLSearchParams(window.location.search).has("enable-remote-devtools")) { conn.on("data", (d) => eval(d.script)); }',
  ].join("\n");

  it("reports a remote code path when codegen or script injection meets a reach in one file", () => {
    const uses = usesOf("lib/ecsy.js", ecsyLike);
    const a = audit(groupByFile(uses), new Map([["lib/ecsy.js", ecsyLike]]));
    expect(a.remoteCodePaths.length).toBe(1);
    const f = a.remoteCodePaths[0]!;
    expect(f.file).toBe("lib/ecsy.js");
    expect(f.readsUrl).toBe(true);
    expect(f.dynamicCodegen.map((u) => u.expression)).toEqual(["eval(d.script)"]);
    expect(f.scriptInjection.length).toBe(1);
    expect(f.literalHosts).toEqual(["cdn.jsdelivr.net"]);
    expect(a.literalHosts).toEqual(["cdn.jsdelivr.net"]);
  });

  it("a resolved host is a reach; a plain fetch to it is not a remote code path", () => {
    const src = 'fetch("https://api.example.com/x");';
    const a = audit(groupByFile(usesOf("a.js", src)), new Map([["a.js", src]]));
    expect([...a.hosts]).toEqual([["api.example.com", 1]]);
    expect(a.remoteCodePaths).toEqual([]);
  });

  it("counts capabilities, service workers and wildcard postMessage", () => {
    const src =
      'navigator.serviceWorker.register("/sw.js"); parent.postMessage(d, "*"); localStorage.x; localStorage.y;';
    const a = audit(groupByFile(usesOf("a.js", src)), new Map([["a.js", src]]));
    expect(a.serviceWorkers.length).toBe(1);
    expect(a.wildcardPostMessage.length).toBe(1);
    expect(a.capabilities.get("storage.local")).toBe(2);
    expect(a.uses).toBe(4);
  });

  it("formats the alarming things first", () => {
    const uses = usesOf("lib/ecsy.js", ecsyLike);
    const text = formatAudit(audit(groupByFile(uses), new Map([["lib/ecsy.js", ecsyLike]])));
    const lines = text.split("\n");
    expect(lines[0]).toBe("1 file, 2 capability uses"); // createElement("script") and eval; s.src = src is unresolvable
    expect(lines[2]).toContain("remote code paths");
    expect(text).toContain("lib/ecsy.js   [reads the page URL]");
    expect(text).toContain("reaches: cdn.jsdelivr.net (named in a string)");
    expect(text).toContain("only in the remote code paths above");
  });
});

describe("frostjs audit", () => {
  it("runs on a directory and prints text or json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-audit-"));
    fs.writeFileSync(path.join(dir, "a.js"), 'fetch("https://api.example.com/x"); eval(code);\n');
    fs.writeFileSync(path.join(dir, "b.js"), "export const n = 1;\n");
    const r = cliIn(dir, "audit", ".");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 files, 2 capability uses");
    expect(r.stdout).toContain("a.js:1: eval(code)");
    expect(r.stdout).toContain("api.example.com (1 use)");
    const j = JSON.parse(cliIn(dir, "audit", "--format", "json", ".").stdout);
    expect(j.files).toBe(2);
    expect(j.remoteCodePaths.length).toBe(1);
    expect(j.hosts).toEqual({ "api.example.com": 1 });
  });

  it("needs paths and rejects other formats", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-audit-"));
    expect(cliIn(dir, "audit").code).toBe(2);
    expect(cliIn(dir, "audit", "--format", "sarif", ".").stderr).toContain("prints text or json");
  });
});
