import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const caps = (src: string) => uses(src).map((u) => u.capability);

describe("navigation: positives", () => {
  it("location assignment forms", () => {
    expect(uses('location.href = "https://x.example/p"')[0]).toMatchObject({
      capability: "navigation.location",
      target: "x.example",
      confidence: "certain",
      expression: 'location.href = "https://x.example/p"',
    });
    expect(caps("location = url")).toEqual(["navigation.location"]);
    expect(caps("window.location = url")).toEqual(["navigation.location"]);
    expect(caps("window.location.href = url")).toEqual(["navigation.location"]);
    expect(caps("document.location = url")).toEqual(["navigation.location"]);
    expect(caps("document.location.href = url")).toEqual(["navigation.location"]);
    expect(caps('location.search = "?a=1"')).toEqual(["navigation.location"]);
    expect(caps("location.pathname = p")).toEqual(["navigation.location"]);
  });

  it("location methods", () => {
    expect(uses('location.assign("/next")')[0]).toMatchObject({
      capability: "navigation.location",
      target: "same-origin",
    });
    expect(caps("location.replace(u)")).toEqual(["navigation.location"]);
    expect(caps("window.location.reload()")).toEqual(["navigation.location"]);
  });

  it("window.open", () => {
    expect(uses('window.open("https://ads.example/", "_blank")')[0]).toMatchObject({
      capability: "navigation.open",
      target: "ads.example",
    });
    expect(caps("globalThis.open(u)")).toEqual(["navigation.open"]);
  });

  it("history", () => {
    expect(caps("history.pushState(s, '', u)")).toEqual(["navigation.history"]);
    expect(caps("window.history.replaceState(s, '', u)")).toEqual(["navigation.history"]);
    expect(caps("history.back(); history.go(-1)")).toEqual(["navigation.history", "navigation.history"]);
  });

  it("postMessage to another window", () => {
    expect(uses('parent.postMessage(data, "*")')[0]).toMatchObject({
      capability: "navigation.postmessage",
      target: "*",
    });
    expect(uses('window.parent.postMessage(data, "https://host.example")')[0]?.target).toBe("host.example");
    expect(caps("top.postMessage(d, origin)")).toEqual(["navigation.postmessage"]);
    expect(caps("opener.postMessage(d, o)")).toEqual(["navigation.postmessage"]);
    expect(caps("frame.contentWindow.postMessage(d, o)")).toEqual(["navigation.postmessage"]);
    expect(caps('anything.postMessage(d, "*")')).toEqual(["navigation.postmessage"]);
    expect(caps("win.postMessage(d, { targetOrigin: '*' })")).toEqual(["navigation.postmessage"]);
  });
});

describe("navigation: must stay quiet", () => {
  it("reading location", () => {
    expect(caps("const u = location.href; if (location.hash) {}; log(window.location.search)")).toEqual([]);
    expect(caps("location.hash = '#top'")).toEqual([]);
  });

  it("worker and port postMessage", () => {
    expect(caps("worker.postMessage(data); port.postMessage(data, [buf]); self.postMessage(r)")).toEqual([]);
  });

  it("bare open and other objects", () => {
    expect(caps("open(path, 'r'); fs.open(p); dialog.open()")).toEqual([]);
    expect(caps("router.history.push(u); this.location = x; state.location.href = y")).toEqual([]);
  });

  it("keys, declarations, strings", () => {
    expect(caps("const o = { location: 1, history: [] }; let location; 'location'")).toEqual([]);
  });

  it("shadowed location", () => {
    expect(uses("const location = useLocation(); location.href = x")[0]?.confidence).toBe("possible");
  });
});
