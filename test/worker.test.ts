import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const caps = (src: string) => uses(src).map((u) => u.capability);

describe("worker: positives", () => {
  it("Worker and SharedWorker with targets", () => {
    expect(uses('new Worker("https://cdn.example.com/w.js")')[0]).toMatchObject({
      capability: "worker.dedicated",
      target: "cdn.example.com",
      confidence: "certain",
    });
    expect(uses('new Worker("./w.js", { type: "module" })')[0]?.target).toBe("same-origin");
    expect(uses('new SharedWorker("/shared.js")')[0]).toMatchObject({
      capability: "worker.shared",
      target: "same-origin",
    });
    expect(uses("new Worker(new URL('./w.js', import.meta.url))")[0]?.target).toBe(null);
    expect(caps("new window.Worker(u)")).toEqual(["worker.dedicated"]);
  });

  it("service worker registration", () => {
    expect(uses('navigator.serviceWorker.register("/sw.js")')[0]).toMatchObject({
      capability: "worker.service",
      target: "same-origin",
      expression: 'navigator.serviceWorker.register("/sw.js")',
    });
    expect(caps("window.navigator.serviceWorker.register(u)")).toEqual(["worker.service"]);
  });

  it("worklets", () => {
    expect(caps('CSS.paintWorklet.addModule("/p.js")')).toEqual(["worker.worklet"]);
    expect(caps('ctx.audioWorklet.addModule("/a.js")')).toEqual(["worker.worklet"]);
  });

  it("a bare Worker reference is a use", () => {
    expect(caps("const W = Worker;")).toEqual(["worker.dedicated"]);
  });
});

describe("worker: must stay quiet", () => {
  it("reading serviceWorker state, other registers", () => {
    expect(caps("navigator.serviceWorker.controller; navigator.serviceWorker.ready.then(f)")).toEqual([]);
    expect(caps("app.register(u); plugin.serviceWorker.register(u)")).toEqual([]);
  });

  it("typeof feature checks still count, but other objects do not", () => {
    expect(caps("typeof Worker !== 'undefined'")).toEqual(["worker.dedicated"]);
    expect(caps("new lib.Worker(u); pool.Worker")).toEqual([]);
  });

  it("declarations and keys", () => {
    expect(caps("class Worker {}; const o = { Worker: 1 }")).toEqual([]);
  });

  it("shadowed Worker is not a use", () => {
    expect(uses("import Worker from './w?worker'; new Worker()")).toEqual([]);
  });
});
