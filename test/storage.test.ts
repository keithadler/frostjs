import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";
import type { CapabilityUse } from "../src/extract/capability.js";

function uses(src: string): CapabilityUse[] {
  return extract(parseSource("t.js", src));
}
function caps(src: string): string[] {
  return uses(src).map((u) => u.capability);
}

describe("storage: positives", () => {
  it("localStorage method call", () => {
    const [u] = uses('localStorage.setItem("a", 1);');
    expect(u).toMatchObject({
      capability: "storage.local",
      file: "t.js",
      line: 1,
      column: 1,
      expression: 'localStorage.setItem("a", 1)',
      confidence: "certain",
      origin: "first-party",
      target: null,
    });
  });

  it("bare localStorage reference", () => {
    expect(caps("const s = localStorage;")).toEqual(["storage.local"]);
  });

  it("sessionStorage", () => {
    expect(caps('sessionStorage.getItem("k")')).toEqual(["storage.session"]);
  });

  it("via window, globalThis, self", () => {
    expect(caps("window.localStorage.clear()")).toEqual(["storage.local"]);
    expect(caps("globalThis.sessionStorage")).toEqual(["storage.session"]);
    expect(caps("self.localStorage")).toEqual(["storage.local"]);
  });

  it("via string-literal computed member", () => {
    expect(caps('window["localStorage"]')).toEqual(["storage.local"]);
  });

  it("indexedDB, caches, navigator.storage", () => {
    expect(caps('indexedDB.open("db")')).toEqual(["storage.indexeddb"]);
    expect(caps('window.indexedDB.open("db")')).toEqual(["storage.indexeddb"]);
    expect(caps('caches.open("v1")')).toEqual(["storage.cache"]);
    expect(caps("navigator.storage.estimate()")).toEqual(["storage.navigator"]);
    expect(caps("window.navigator.storage")).toEqual(["storage.navigator"]);
  });

  it("document.cookie read and write", () => {
    expect(caps("const c = document.cookie;")).toEqual(["storage.cookie"]);
    expect(caps('document.cookie = "a=1";')).toEqual(["storage.cookie"]);
    expect(caps("window.document.cookie")).toEqual(["storage.cookie"]);
  });

  it("reports each use separately with correct positions", () => {
    const src = "foo();\n  localStorage.a;\nsessionStorage.b;";
    const u = uses(src);
    expect(u.map((x) => [x.capability, x.line, x.column])).toEqual([
      ["storage.local", 2, 3],
      ["storage.session", 3, 1],
    ]);
  });

  it("records the enclosing call chain as the expression", () => {
    const [u] = uses("window.localStorage.getItem('k').trim();");
    expect(u?.expression).toBe("window.localStorage.getItem('k').trim()");
  });

  it("works inside nested functions and expressions", () => {
    const src = "function f() { return [1].map(() => localStorage.length); }";
    expect(caps(src)).toEqual(["storage.local"]);
  });
});

describe("storage: must stay quiet", () => {
  it("property on a non-global object", () => {
    expect(caps("store.localStorage.get()")).toEqual([]);
    expect(caps("this.localStorage = 1")).toEqual([]);
  });

  it("object keys and destructuring patterns", () => {
    expect(caps("const o = { localStorage: 1 };")).toEqual([]);
    expect(caps("const { localStorage } = o;")).toEqual([]);
  });

  it("declarations and parameters", () => {
    expect(caps("function localStorage() {}")).toEqual([]);
    expect(caps("function f(localStorage) {}")).toEqual([]);
    expect(caps("let localStorage;")).toEqual([]);
    expect(caps("class A { localStorage() {} }")).toEqual([]);
  });

  it("strings, comments and unrelated names", () => {
    expect(caps('const s = "localStorage";')).toEqual([]);
    expect(caps("// localStorage.setItem\nfoo();")).toEqual([]);
    expect(caps("myLocalStorage.get()")).toEqual([]);
    expect(caps("document.cookieStore")).toEqual([]);
  });

  it("non-literal computed member is not certain and not emitted yet", () => {
    // Constant folding and the `possible` tier arrive in Phase D.
    expect(caps("window[k]")).toEqual([]);
  });

  it("labels and import names", () => {
    expect(caps("import { localStorage } from './shim.js';")).toEqual([]);
  });
});

describe("storage: prototype names and shadowing", () => {
  it("does not match Object.prototype names", () => {
    expect(caps("x.constructor; toString(1); hasOwnProperty.call(o, k); window.constructor")).toEqual([]);
  });

  it("downgrades to possible when the file declares the global's name", () => {
    const u = uses("function f() { const caches = {}; return caches.a; }");
    expect(u.map((x) => [x.capability, x.confidence])).toEqual([["storage.cache", "possible"]]);
  });

  it("downgrades when the global object itself is declared", () => {
    const u = uses("var self = this; self.localStorage;");
    expect(u.map((x) => x.confidence)).toEqual(["possible"]);
    const w = uses("const window = {}; window.localStorage;");
    expect(w.map((x) => x.confidence)).toEqual(["possible"]);
    const d = uses("import document from './doc.js'; document.cookie;");
    expect(d.map((x) => x.confidence)).toEqual(["possible"]);
  });

  it("stays certain when an unrelated name is declared", () => {
    const u = uses("const sessionStorage = 1; localStorage.x;");
    expect(u.map((x) => x.confidence)).toEqual(["certain"]);
  });

  it("optional chaining", () => {
    expect(caps("window?.localStorage?.getItem('k')")).toEqual(["storage.local"]);
    expect(uses("localStorage?.getItem('k')")[0]?.expression).toBe("localStorage?.getItem('k')");
  });

  it("typeof feature detection is still a use", () => {
    expect(caps("typeof localStorage !== 'undefined'")).toEqual(["storage.local"]);
  });
});
