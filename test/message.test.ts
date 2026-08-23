import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const caps = (src: string) => extract(parseSource("t.js", src)).map((u) => u.capability);

describe("navigation.message-receive: a message listener without an origin check", () => {
  it("addEventListener reading data but not origin", () => {
    expect(caps('window.addEventListener("message", (e) => { handle(e.data); })')).toEqual([
      "navigation.message-receive",
    ]);
    expect(caps('addEventListener("message", function (evt) { run(evt.data.cmd); })')).toEqual([]); // bare is ambiguous
    // self is the worker idiom, where an origin check does not apply:
    expect(caps('self.addEventListener("message", (m) => { post(m.data); })')).toEqual([]);
    expect(caps("self.onmessage = (e) => use(e.data)")).toEqual([]);
  });

  it("onmessage assignment", () => {
    expect(caps("window.onmessage = (e) => { use(e.data); }")).toEqual(["navigation.message-receive"]);
  });

  it("quiet when the handler checks origin", () => {
    expect(
      caps('window.addEventListener("message", (e) => { if (e.origin !== ORIGIN) return; handle(e.data); })'),
    ).toEqual([]);
    expect(
      caps('window.addEventListener("message", (e) => { const ok = e.origin === ORIGIN; if (ok) use(e.data); })'),
    ).toEqual([]);
  });

  it("quiet when the handler does not read data (e.g. a ping)", () => {
    expect(caps('window.addEventListener("message", () => { refresh(); })')).toEqual([]);
    expect(caps('window.addEventListener("message", (e) => { count++; })')).toEqual([]);
  });

  it("other events and other targets are not this", () => {
    expect(caps('window.addEventListener("click", (e) => { use(e.data); })')).toEqual([]);
    expect(caps('worker.addEventListener("message", (e) => { use(e.data); })')).toEqual([]);
    expect(caps("el.onmessage = (e) => use(e.data)")).toEqual([]);
  });

  it("origin checked via destructuring is currently still flagged (documented limit)", () => {
    // A shallow heuristic: it looks for e.origin, not `const { origin } = e`.
    expect(caps('window.addEventListener("message", ({ data, origin }) => { if (origin) use(data); })')).toEqual([]);
  });
});
