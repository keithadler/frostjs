import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const caps = (src: string) => uses(src).map((u) => u.capability);

describe("codegen: positives", () => {
  it("eval, direct and indirect", () => {
    expect(uses('eval("1+1")')[0]).toMatchObject({
      capability: "codegen.eval",
      confidence: "certain",
      expression: 'eval("1+1")',
    });
    expect(caps("window.eval(s)")).toEqual(["codegen.eval"]);
    expect(caps("(0, eval)(s)")).toEqual(["codegen.eval"]);
    expect(caps("const e = eval;")).toEqual(["codegen.eval"]);
    expect(caps("globalThis.eval(s)")).toEqual(["codegen.eval"]);
  });

  it("Function constructor, called or constructed", () => {
    expect(caps('new Function("a", "return a")')).toEqual(["codegen.function"]);
    expect(caps('Function("return this")()')).toEqual(["codegen.function"]);
    expect(caps('new window.Function("x")')).toEqual(["codegen.function"]);
  });

  it("timers with string code", () => {
    expect(uses('setTimeout("doIt()", 10)')[0]).toMatchObject({ capability: "codegen.timer", confidence: "certain" });
    expect(caps('setInterval("tick()", 1000)')).toEqual(["codegen.timer"]);
    expect(caps('window.setTimeout("x()", 0)')).toEqual(["codegen.timer"]);
    expect(caps("setTimeout(`run(${i})`, 0)")).toEqual(["codegen.timer"]);
    expect(caps('setTimeout("a" + b, 0)')).toEqual(["codegen.timer"]);
  });

  it("document.write", () => {
    expect(caps('document.write("<b>x</b>")')).toEqual(["codegen.write"]);
    expect(caps("document.writeln(s)")).toEqual(["codegen.write"]);
    expect(caps("window.document.write(s)")).toEqual(["codegen.write"]);
  });
});

describe("codegen: must stay quiet", () => {
  it("Function as a value, not a constructor call", () => {
    expect(caps("x instanceof Function")).toEqual([]);
    expect(caps("Function.prototype.call.bind(f)")).toEqual([]);
    expect(caps("typeof Function")).toEqual([]);
    expect(caps("const F = Function;")).toEqual([]);
  });

  it("timers with callbacks", () => {
    expect(caps("setTimeout(fn, 0); setTimeout(() => x(), 0); setTimeout(function () {}, 0)")).toEqual([]);
    expect(caps("setInterval(tick, 10); setTimeout(cb)")).toEqual([]);
    expect(caps("setTimeout(handler.bind(this), 0)")).toEqual([]);
  });

  it("eval and write on other objects", () => {
    expect(caps("vm.eval(s); ctx.eval(s); this.eval(s)")).toEqual([]);
    expect(caps("stream.write(s); fs.writeln(s); doc.write(s)")).toEqual([]);
  });

  it("declarations and keys", () => {
    expect(caps("function eval() {}; const o = { eval: 1, write: 2 }")).toEqual([]);
  });

  it("a timer whose first argument is an identifier is not reported", () => {
    // It is probably a function. Confidence tiers may revisit this in Phase D.
    expect(caps("setTimeout(code, 0)")).toEqual([]);
  });
});
