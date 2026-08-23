import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const caps = (src: string) => uses(src).map((u) => u.capability);

describe("dom-escape: positives", () => {
  it("innerHTML and outerHTML assignment", () => {
    expect(uses("el.innerHTML = html")[0]).toMatchObject({
      capability: "dom-escape.html",
      confidence: "certain",
      expression: "el.innerHTML = html",
    });
    expect(caps("this.outerHTML = s")).toEqual(["dom-escape.html"]);
    expect(caps("node.innerHTML += more")).toEqual(["dom-escape.html"]);
    expect(caps("document.body.innerHTML = s")).toEqual(["dom-escape.html"]);
    expect(caps('el["innerHTML"] = s')).toEqual(["dom-escape.html"]);
  });

  it("insertAdjacentHTML", () => {
    expect(caps('el.insertAdjacentHTML("beforeend", s)')).toEqual(["dom-escape.html"]);
  });

  it("srcdoc assignment", () => {
    expect(caps("frame.srcdoc = html")).toEqual(["dom-escape.html"]);
  });

  it("script and iframe creation", () => {
    expect(uses('document.createElement("script")')[0]).toMatchObject({
      capability: "dom-escape.script",
      confidence: "certain",
    });
    expect(caps('document.createElement("SCRIPT")')).toEqual(["dom-escape.script"]);
    expect(caps('document.createElement("iframe")')).toEqual(["dom-escape.iframe"]);
    expect(caps('window.document.createElement("script")')).toEqual(["dom-escape.script"]);
  });

  it("Range.createContextualFragment and DOMParser are html parsing sinks", () => {
    expect(caps("range.createContextualFragment(s)")).toEqual(["dom-escape.html"]);
  });

  it("multiple in one file keep their positions", () => {
    const u = uses("a.innerHTML = 1;\n  b.outerHTML = 2;");
    expect(u.map((x) => [x.line, x.column])).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });
});

describe("dom-escape: must stay quiet", () => {
  it("reading innerHTML is not injection", () => {
    expect(caps("const s = el.innerHTML; if (a.innerHTML === b.innerHTML) {}")).toEqual([]);
    expect(caps("log(el.outerHTML)")).toEqual([]);
  });

  it("other elements", () => {
    expect(caps('document.createElement("div"); document.createElement("a"); document.createElement(tag)')).toEqual([]);
    expect(caps('document.createElementNS(ns, "svg")')).toEqual([]);
  });

  it("textContent and friends", () => {
    expect(caps("el.textContent = s; el.innerText = s; el.title = s")).toEqual([]);
  });

  it("keys and strings", () => {
    expect(caps('const o = { innerHTML: s }; "innerHTML"; obj.innerHTML.length')).toEqual([]);
  });

  it("defineProperty-style descriptors with innerHTML as a key", () => {
    expect(caps('Object.defineProperty(p, "innerHTML", { set(v) {} })')).toEqual([]);
  });

  it("destructuring from an element", () => {
    expect(caps("const { innerHTML } = el;")).toEqual([]);
  });
});
