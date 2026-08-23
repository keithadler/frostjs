import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";
import { discover } from "../src/discover/index.js";
import { cliIn } from "./helpers.js";

const ts = (src: string) => extract(parseSource("t.ts", src));
const tsx = (src: string) => extract(parseSource("t.tsx", src));
const capsTs = (src: string) => ts(src).map((u) => u.capability);
const capsTsx = (src: string) => tsx(src).map((u) => u.capability);

describe("TypeScript: type positions are never references", () => {
  it("annotations, typeof queries, generics, interfaces, aliases", () => {
    expect(capsTs("let f: typeof fetch;")).toEqual([]);
    expect(capsTs("function g(x: typeof localStorage, y: Storage): Promise<Response> { return null!; }")).toEqual([]);
    expect(capsTs("interface I { fetch: typeof fetch; w: Worker }")).toEqual([]);
    expect(capsTs("type T = typeof navigator.userAgent;")).toEqual([]);
    expect(capsTs("let x = y as typeof localStorage;")).toEqual([]);
    expect(capsTs("let x = <typeof fetch>y;")).toEqual([]);
  });

  it("declare statements describe globals; they neither use nor shadow them", () => {
    expect(capsTs("declare const localStorage: Storage;")).toEqual([]);
    expect(capsTs("declare function fetch(u: string): Promise<Response>;")).toEqual([]);
    expect(capsTs('declare module "x" { const fetch: number; }')).toEqual([]);
    expect(capsTs("declare global { interface Window { fetch: any } }")).toEqual([]);
    // And after such a declaration the real global is still the global.
    expect(ts("declare const localStorage: Storage;\nlocalStorage.setItem('a', 1);")[0]?.confidence).toBe("certain");
  });

  it("import type and export type", () => {
    expect(capsTs("import type { Worker } from './w';\nnew Worker(u);")[0]).toBe("worker.dedicated");
    expect(capsTs("import { type Worker, other } from './w';\nnew Worker(u);")).toEqual(["worker.dedicated"]);
    expect(capsTs("export type { fetch } from './f';")).toEqual([]);
  });
});

describe("TypeScript: value positions still count", () => {
  it("as, satisfies, non-null, instantiation wrappers are unwrapped", () => {
    expect(capsTs("(localStorage as Storage).setItem('a', 1);")).toEqual(["storage.local"]);
    expect(capsTs("(fetch satisfies Function)(u);")).toEqual(["network.fetch"]);
    expect(capsTs("navigator.clipboard!.writeText(s);")).toEqual(["identity.clipboard"]);
    expect(ts('fetch(("https://api.example.com/x" as string) + id)')[0]?.target).toBe("api.example.com");
  });

  it("parameter properties bind; enum names bind; namespace bodies are code", () => {
    expect(capsTs("class C { constructor(private fetch: number) { this.fetch; } }")).toEqual([]);
    expect(capsTs("class C { constructor(private x: number) { fetch(u); } }")).toEqual(["network.fetch"]);
    expect(capsTs("enum E { A = 1 }; const e = E.A; localStorage.x;")).toEqual(["storage.local"]);
    expect(capsTs("namespace N { export const q = fetch; }")).toEqual(["network.fetch"]);
  });

  it("decorators are expressions", () => {
    expect(capsTs("@dec(localStorage) class D {}")).toEqual(["storage.local"]);
  });

  it("abstract and overload signatures have no body", () => {
    expect(capsTs("abstract class A { abstract fetch(): void; }")).toEqual([]);
    expect(capsTs("function f(a: string): void;\nfunction f(a: any) { eval(a); }")).toEqual(["codegen.eval"]);
  });
});

describe("JSX", () => {
  it("dangerouslySetInnerHTML is html injection", () => {
    const [u] = tsx("const el = <div dangerouslySetInnerHTML={{ __html: s }} />;");
    expect(u).toMatchObject({
      capability: "dom-escape.html",
      confidence: "certain",
      expression: "dangerouslySetInnerHTML={{ __html: s }}",
      line: 1,
      column: 17,
    });
  });

  it("script and iframe elements, srcdoc attribute", () => {
    expect(capsTsx("const s = <script src={u} />;")).toEqual(["dom-escape.script"]);
    expect(capsTsx("const f = <iframe src={u} />;")).toEqual(["dom-escape.iframe"]);
    expect(capsTsx("const f = <iframe srcdoc={html} />;")).toEqual(["dom-escape.iframe", "dom-escape.html"]);
  });

  it("component names and ordinary attributes are quiet", () => {
    expect(capsTsx("const a = <Worker onClick={f} fetch={g}><Script /></Worker>;")).toEqual([]);
    expect(capsTsx("const a = <Foo.Bar {...props} />;")).toEqual([]);
  });

  it("expressions inside JSX are code", () => {
    expect(capsTsx("const a = <div title={localStorage.getItem('t')}>{navigator.userAgent}</div>;")).toEqual([
      "storage.local",
      "identity.device",
    ]);
  });

  it(".jsx files parse too", () => {
    expect(extract(parseSource("a.jsx", "const a = <p dangerouslySetInnerHTML={h} />;")).length).toBe(1);
  });
});

describe("discovery of TypeScript", () => {
  it("finds .ts .tsx .jsx .mts .cts and skips declaration files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-ts-"));
    for (const f of ["a.ts", "b.tsx", "c.jsx", "d.mts", "e.cts", "f.d.ts", "g.d.mts", "h.js"]) {
      fs.writeFileSync(path.join(dir, f), "export {};\n");
    }
    expect(discover([dir]).map((f) => path.basename(f))).toEqual(["a.ts", "b.tsx", "c.jsx", "d.mts", "e.cts", "h.js"]);
  });

  it("the CLI checks a TypeScript project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-ts-"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), "may use session storage\n");
    fs.writeFileSync(
      path.join(dir, "app.tsx"),
      "export const A = () => <p dangerouslySetInnerHTML={{ __html: h }} />;\n",
    );
    fs.writeFileSync(path.join(dir, "store.ts"), "export const s: Storage = sessionStorage;\n");
    const r = cliIn(dir, ".");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "app.tsx:1:27: dom-escape.html denied by default (no rule grants it): dangerouslySetInnerHTML={{ __html: h }}",
    );
    expect(r.stdout).toContain("2 files, 1 denied");
  });
});
