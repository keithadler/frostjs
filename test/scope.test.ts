import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const conf = (src: string) => uses(src).map((u) => u.confidence);

describe("scope: locals shadowing globals are not reported", () => {
  it("function-local declaration, any order (var hoists)", () => {
    expect(uses("function f() { return caches.x; var caches; }")).toEqual([]);
    expect(uses("function f() { const localStorage = {}; localStorage.get(); }")).toEqual([]);
  });

  it("parameter", () => {
    expect(uses("function f(fetch) { fetch(u); }")).toEqual([]);
    expect(uses("const g = (localStorage) => localStorage.x;")).toEqual([]);
    expect(uses("function f({ fetch }) { fetch(u); }")).toEqual([]);
    expect(uses("function f(...caches) { caches.x; }")).toEqual([]);
  });

  it("import binding", () => {
    expect(uses("import fetch from 'node-fetch'; fetch(u);")).toEqual([]);
    expect(uses("import { Worker } from 'x'; new Worker(u);")).toEqual([]);
    expect(uses("import * as navigator from 'x'; navigator.userAgent;")).toEqual([]);
  });

  it("catch parameter, class name, function name", () => {
    expect(uses("try {} catch (fetch) { fetch(u); }")).toEqual([]);
    expect(uses("class WebSocket {}; new WebSocket(u);")).toEqual([]);
    expect(uses("function eval() {}; eval(s);")).toEqual([]);
    expect(uses("const f = function fetch() { fetch(u); };")).toEqual([]);
  });

  it("global object aliased locally", () => {
    expect(uses("var self = this; self.localStorage;")).toEqual([]);
    expect(uses("function f(window) { window.localStorage; }")).toEqual([]);
    expect(uses("const document = fake(); document.cookie;")).toEqual([]);
  });

  it("let in a for head, and in a block", () => {
    expect(uses("for (let fetch of fs) fetch(u);")).toEqual([]);
    expect(uses("{ let caches = 1; caches.x; }")).toEqual([]);
  });
});

describe("scope: the same name elsewhere does not shadow", () => {
  it("sibling function", () => {
    expect(conf("function a() { var caches; } function b() { caches.x; }")).toEqual(["certain"]);
  });

  it("inner declaration does not reach the outer use", () => {
    expect(conf("caches.x; function f() { const caches = 1; }")).toEqual(["certain"]);
    expect(conf("{ let fetch = 1; } fetch(u);")).toEqual(["certain"]);
  });

  it("block-scoped declaration in another block", () => {
    expect(conf("if (a) { const localStorage = 1; } else { localStorage.x; }")).toEqual(["certain"]);
  });

  it("object keys and member names never declare anything", () => {
    expect(conf("const o = { fetch: 1 }; o.fetch; fetch(u);")).toEqual(["certain"]);
  });

  it("a use before a later var in the same scope is still shadowed", () => {
    expect(uses("fetch(u); var fetch = 1;")).toEqual([]);
  });

  it("unrelated local with a different name", () => {
    expect(conf("const sessionStorage = 1; localStorage.x;")).toEqual(["certain"]);
  });
});

describe("scope: the grey areas stay possible", () => {
  it("inside a with statement nothing can be resolved", () => {
    expect(conf("with (obj) { localStorage.x; }")).toEqual(["possible"]);
  });

  it("module-level declaration after a use in the same scope", () => {
    expect(uses("localStorage.x; const localStorage = 1;")).toEqual([]);
  });
});

describe("constant folding", () => {
  it("window[k] where k is a const string", () => {
    const [u] = uses('const k = "localStorage"; window[k].setItem(a, b);');
    expect(u).toMatchObject({ capability: "storage.local", confidence: "probable" });
  });

  it("concatenated and template literal member names", () => {
    expect(uses('window["local" + "Storage"]')[0]).toMatchObject({
      capability: "storage.local",
      confidence: "probable",
    });
    expect(uses("window[`sessionStorage`]")[0]).toMatchObject({
      capability: "storage.session",
      confidence: "probable",
    });
  });

  it("a let, a reassigned const, or a non-literal does not fold", () => {
    expect(uses('let k = "localStorage"; window[k]')).toEqual([]);
    expect(uses("const k = name(); window[k]")).toEqual([]);
    expect(uses("window[k]")).toEqual([]);
  });

  it("folding follows scope", () => {
    expect(uses('const k = "localStorage"; function f(k) { return window[k]; }')).toEqual([]);
    expect(uses('function f() { const k = "caches"; return window[k]; }')[0]?.capability).toBe("storage.cache");
  });

  it("a const URL resolves as a target", () => {
    expect(uses('const BASE = "https://api.example.com/v1/"; fetch(BASE + "items")')[0]?.target).toBe(
      "api.example.com",
    );
    expect(uses('const P = "https://cdn.skypack.dev/x"; import(P)')[0]).toMatchObject({
      capability: "network.import",
      target: "cdn.skypack.dev",
    });
    expect(uses('let P = "https://cdn.skypack.dev/x"; import(P)')[0]?.target).toBe(null);
    expect(uses('const P = "./local.js"; import(P)')).toEqual([]);
  });

  it("a string-literal computed member stays certain", () => {
    expect(uses('window["localStorage"]')[0]?.confidence).toBe("certain");
  });
});
