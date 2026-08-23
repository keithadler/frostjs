import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";
import { resolveTarget } from "../src/extract/target.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const caps = (src: string) => uses(src).map((u) => u.capability);
const one = (src: string) => {
  const u = uses(src);
  expect(u.length).toBe(1);
  return u[0]!;
};

describe("network: positives", () => {
  it("fetch", () => {
    expect(one('fetch("https://api.example.com/v1")')).toMatchObject({
      capability: "network.fetch",
      target: "api.example.com",
      confidence: "certain",
      expression: 'fetch("https://api.example.com/v1")',
    });
    expect(one("window.fetch(u)")).toMatchObject({ capability: "network.fetch", target: null });
    expect(one("globalThis.fetch(u)").capability).toBe("network.fetch");
    expect(one("self.fetch(u)").confidence).toBe("probable");
  });

  it("XMLHttpRequest", () => {
    expect(one("new XMLHttpRequest()")).toMatchObject({ capability: "network.xhr", target: null });
    expect(one("new window.XMLHttpRequest()").capability).toBe("network.xhr");
    expect(one("const X = XMLHttpRequest;").capability).toBe("network.xhr");
  });

  it("WebSocket and EventSource take their target from the first argument", () => {
    expect(one('new WebSocket("wss://live.example.com/feed")')).toMatchObject({
      capability: "network.websocket",
      target: "live.example.com",
    });
    expect(one('new EventSource("/events")')).toMatchObject({
      capability: "network.eventsource",
      target: "same-origin",
    });
  });

  it("sendBeacon", () => {
    expect(one('navigator.sendBeacon("https://t.example.com/c", data)')).toMatchObject({
      capability: "network.beacon",
      target: "t.example.com",
    });
    expect(one("window.navigator.sendBeacon(u)").capability).toBe("network.beacon");
  });

  it("dynamic import", () => {
    expect(one('import("https://cdn.example.com/mod.js")')).toMatchObject({
      capability: "network.import",
      target: "cdn.example.com",
      expression: 'import("https://cdn.example.com/mod.js")',
    });
    expect(one("import(name)").target).toBe(null);
    expect(one("import(`https://cdn.example.com/${name}.js`)").target).toBe("cdn.example.com");
  });

  it("dynamic import of a relative path or bare specifier is not a network use", () => {
    expect(caps('import("./chunk.js"); import("../x.js"); import("/abs.js")')).toEqual([]);
    expect(caps('import("lodash"); import("@scope/pkg"); import("node:fs"); import("file:///x.js")')).toEqual([]);
  });

  it("a reference without a call is still a use", () => {
    expect(caps("const f = fetch;")).toEqual(["network.fetch"]);
    expect(caps("if (typeof fetch === 'function') {}")).toEqual(["network.fetch"]);
  });
});

describe("network: targets", () => {
  it.each([
    ['"https://api.example.com/x?y=1"', "api.example.com"],
    ['"http://API.Example.com"', "api.example.com"],
    ['"https://user:pw@h.example.com:8443/p"', "h.example.com"],
    ['"wss://ws.example.com"', "ws.example.com"],
    ['"//cdn.example.com/lib.js"', "cdn.example.com"],
    ['"/api/items"', "same-origin"],
    ['"api/items"', "same-origin"],
    ['"./mod.js"', "same-origin"],
    ['"?page=2"', "same-origin"],
    ['"data:text/plain,hi"', "data:"],
    ['"blob:https://x.example.com/uuid"', "blob:"],
    ["`https://api.example.com/${id}`", "api.example.com"],
    ['"https://api.example.com/items/" + id', "api.example.com"],
    ['"https://api.example.com" + path', null], // authority not closed: path could be ".evil.com"
    ['"https://api.example.com/" + path', "api.example.com"],
    ['"https://" + host + "/x"', null],
    ["`https://${host}/x`", null],
    ["url", null],
    ["BASE + '/x'", null],
    ['"https://api.example.com/" + a + b', "api.example.com"],
  ])("%s -> %s", (arg, target) => {
    expect(one(`fetch(${arg})`).target).toBe(target);
  });

  it("resolveTarget on a URL object is unknown", () => {
    expect(one('fetch(new URL("https://x.example.com"))').target).toBe(null);
  });

  it("resolveTarget is exported and handles a plain string", () => {
    expect(resolveTarget("https://a.example.com/p")).toBe("a.example.com");
  });
});

describe("network: must stay quiet", () => {
  it("methods on other objects", () => {
    expect(caps("api.fetch(u); this.fetch(u); client.sendBeacon(u)")).toEqual([]);
    expect(caps("new api.WebSocket(u); new lib.XMLHttpRequest()")).toEqual([]);
  });

  it("static imports and import.meta", () => {
    expect(caps('import x from "https://cdn.example.com/x.js"; import.meta.url;')).toEqual([]);
  });

  it("declarations, keys, strings", () => {
    expect(caps("function fetch() {}; const o = { fetch: 1 }; 'fetch'")).toEqual([]);
    expect(caps("class WebSocket {}")).toEqual([]);
  });

  it("shadowed is not a use", () => {
    expect(uses("const fetch = require('node-fetch'); fetch(u);")).toEqual([]);
  });
});
