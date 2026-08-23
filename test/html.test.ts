import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scriptBlocks, mask, parseHtml } from "../src/extract/html.js";
import { extract } from "../src/extract/index.js";
import { discover } from "../src/discover/index.js";
import { cliIn } from "./helpers.js";

const page = [
  "<!doctype html>",
  "<html><head>",
  '  <script src="/vendor/lib.js"></script>',
  '  <script type="application/json">{"a": 1}</script>',
  "  <script>",
  '    localStorage.setItem("seen", 1);',
  "  </script>",
  "</head><body>",
  '  <SCRIPT TYPE="module">',
  "    import x from './x.js';",
  "    fetch(`https://api.example.com/${x}`);",
  "  </SCRIPT>",
  '  <script type="text/template"><p>{{ localStorage }}</p></script>',
  "</body></html>",
  "",
].join("\n");

describe("scriptBlocks", () => {
  it("finds inline JavaScript blocks only", () => {
    const blocks = scriptBlocks(page);
    expect(blocks.length).toBe(2);
    expect(page.slice(blocks[0]!.start, blocks[0]!.end)).toContain("localStorage.setItem");
    expect(blocks[0]!.module).toBe(false);
    expect(page.slice(blocks[1]!.start, blocks[1]!.end)).toContain("fetch(");
    expect(blocks[1]!.module).toBe(true);
  });

  it("skips empty blocks and unusual quoting", () => {
    expect(
      scriptBlocks("<script></script><script type='text/javascript'>a()</script><script type=module>b()</script>")
        .length,
    ).toBe(2);
  });
});

describe("mask", () => {
  it("keeps length and newlines", () => {
    const m = mask("ab\ncd\nef", 3, 5);
    expect(m).toBe("  \ncd\n  ");
    expect(m.length).toBe(8);
  });
});

describe("parseHtml and extract", () => {
  it("positions are in the HTML file", () => {
    const parsed = parseHtml("index.html", page);
    expect(parsed.length).toBe(2);
    expect(parsed.every((p) => p.errors.length === 0)).toBe(true);
    const uses = parsed.flatMap((p) => extract(p, { origin: "inline-html" }));
    expect(uses.map((u) => [u.capability, u.line, u.column, u.origin])).toEqual([
      ["storage.local", 6, 5, "inline-html"],
      ["network.fetch", 11, 5, "inline-html"],
    ]);
    expect(uses[0]?.expression).toBe('localStorage.setItem("seen", 1)');
    expect(uses[1]?.target).toBe("api.example.com");
  });

  it("a syntax error is reported at its HTML line", () => {
    const parsed = parseHtml("x.html", "<p>\n<script>\nconst = ;\n</script>");
    expect(parsed[0]?.errors[0]).toMatchObject({ file: "x.html", line: 3, column: 7 });
  });

  it("suppression comments work inside a block", () => {
    const parsed = parseHtml("x.html", "<script>\n// frostjs: ignore\nlocalStorage.x;\n</script>");
    expect(extract(parsed[0]!)[0]?.suppressed).toBe(true);
  });
});

describe("HTML in the CLI", () => {
  it("discovers .html and .htm", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-html-"));
    fs.writeFileSync(path.join(dir, "a.html"), "<p>");
    fs.writeFileSync(path.join(dir, "b.htm"), "<p>");
    fs.writeFileSync(path.join(dir, "c.css"), "p{}");
    expect(discover([dir]).map((f) => path.basename(f))).toEqual(["a.html", "b.htm"]);
  });

  it("checks inline scripts against the policy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-html-"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), "may use local storage\n");
    fs.writeFileSync(path.join(dir, "index.html"), page);
    const r = cliIn(dir, "index.html");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "index.html:11:5: network.fetch to api.example.com denied by default (no rule grants it): fetch(`https://api.example.com/${x}`)",
    );
    expect(r.stdout).not.toContain("storage.local denied");
    expect(r.stdout).toContain("1 file, 1 denied");
  });

  it("a page with no scripts is clean", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-html-"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), "");
    fs.writeFileSync(path.join(dir, "plain.html"), "<p>hello</p>");
    expect(cliIn(dir, "plain.html")).toMatchObject({ code: 0, stdout: "1 file, 0 denied, 0 unknown\n" });
  });
});
