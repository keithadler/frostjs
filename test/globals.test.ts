import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const caps = (src: string) => uses(src).map((u) => u.capability);

describe("globals: positives", () => {
  it("assignment through the global object", () => {
    expect(uses("window.myLib = lib")[0]).toMatchObject({
      capability: "globals.window",
      confidence: "certain",
      expression: "window.myLib = lib",
    });
    expect(caps("globalThis.__state = {}")).toEqual(["globals.window"]);
    expect(caps('window["jQuery"] = $')).toEqual(["globals.window"]);
    expect(caps("window.foo ??= 1; window.bar ||= 2")).toEqual(["globals.window", "globals.window"]);
    expect(uses("self.x = 1")[0]?.confidence).toBe("probable");
  });

  it("defineProperty on the global object", () => {
    expect(caps('Object.defineProperty(window, "x", { value: 1 })')).toEqual(["globals.window"]);
    expect(caps("Object.assign(globalThis, exports)")).toEqual(["globals.window"]);
  });

  it("built-in prototype mutation", () => {
    expect(uses("Array.prototype.last = function () {}")[0]).toMatchObject({
      capability: "globals.prototype",
      confidence: "certain",
    });
    expect(caps("String.prototype.trim = polyfill")).toEqual(["globals.prototype"]);
    expect(caps("Object.prototype.toJSON = f")).toEqual(["globals.prototype"]);
    expect(caps("Element.prototype.matches = Element.prototype.msMatchesSelector")).toEqual(["globals.prototype"]);
    expect(caps('Object.defineProperty(Array.prototype, "flat", d)')).toEqual(["globals.prototype"]);
    expect(caps("Object.defineProperties(Promise.prototype, d)")).toEqual(["globals.prototype"]);
    expect(caps("Object.assign(Date.prototype, ext)")).toEqual(["globals.prototype"]);
  });

  it("built-in static mutation", () => {
    expect(caps("Array.from = polyfill; Promise.allSettled = p; Math.clamp = f")).toEqual([
      "globals.prototype",
      "globals.prototype",
      "globals.prototype",
    ]);
    expect(caps("Object.defineProperty(Object, 'entries', d)")).toEqual(["globals.prototype"]);
  });
});

describe("globals: must stay quiet", () => {
  it("reading globals", () => {
    expect(caps("const x = window.foo; if (globalThis.bar) {}; Array.prototype.slice.call(a)")).toEqual([]);
  });

  it("event handlers and location", () => {
    expect(caps("window.onload = f; window.onerror = g; window.location = u")).toEqual(["navigation.location"]);
  });

  it("own prototypes and objects", () => {
    expect(caps("Foo.prototype.bar = 1; this.prototype.x = 2; MyClass.from = f")).toEqual([]);
    expect(caps("Object.defineProperty(obj, 'x', d); Object.assign(target, src)")).toEqual([]);
  });

  it("local window alias is not a use", () => {
    expect(uses("const window = {}; window.x = 1")).toEqual([]);
  });

  it("prototype of a local shadowing a builtin", () => {
    expect(uses("function Array() {}; Array.prototype.x = 1")).toEqual([]);
  });
});
