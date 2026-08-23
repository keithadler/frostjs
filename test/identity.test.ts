import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const uses = (src: string) => extract(parseSource("t.js", src));
const caps = (src: string) => uses(src).map((u) => u.capability);

describe("identity: positives", () => {
  it.each([
    ["navigator.userAgent", "identity.device"],
    ["navigator.platform", "identity.device"],
    ["navigator.vendor", "identity.device"],
    ["navigator.appVersion", "identity.device"],
    ["navigator.hardwareConcurrency", "identity.device"],
    ["navigator.deviceMemory", "identity.device"],
    ["navigator.plugins", "identity.device"],
    ["navigator.mimeTypes", "identity.device"],
    ["navigator.userAgentData", "identity.device"],
    ["navigator.geolocation", "identity.geolocation"],
    ["navigator.mediaDevices", "identity.media"],
    ["navigator.getUserMedia", "identity.media"],
    ["navigator.clipboard", "identity.clipboard"],
    ["navigator.credentials", "identity.credentials"],
    ["navigator.permissions", "identity.permissions"],
    ["window.navigator.userAgent", "identity.device"],
    ['navigator["userAgent"]', "identity.device"],
  ])("%s -> %s", (src, cap) => {
    expect(caps(src)).toEqual([cap]);
  });

  it("records the whole chain", () => {
    expect(uses("navigator.geolocation.getCurrentPosition(cb)")[0]).toMatchObject({
      capability: "identity.geolocation",
      confidence: "certain",
      expression: "navigator.geolocation.getCurrentPosition(cb)",
    });
    expect(uses("navigator.clipboard.writeText(s)")[0]?.expression).toBe("navigator.clipboard.writeText(s)");
  });

  it("execCommand copy/paste is clipboard", () => {
    expect(caps('document.execCommand("copy")')).toEqual(["identity.clipboard"]);
    expect(caps('document.execCommand("paste")')).toEqual(["identity.clipboard"]);
    expect(caps('document.execCommand("bold")')).toEqual([]);
  });

  it("self.navigator is probable", () => {
    expect(uses("self.navigator.userAgent")[0]?.confidence).toBe("probable");
  });
});

describe("identity: must stay quiet", () => {
  it("harmless navigator properties", () => {
    expect(caps("navigator.onLine; navigator.language; navigator.languages; navigator.serviceWorker")).toEqual([]);
    expect(caps("navigator.cookieEnabled; navigator.maxTouchPoints")).toEqual([]);
  });

  it("other objects named like navigator members", () => {
    expect(caps("req.headers.userAgent; ua.platform; app.clipboard.copy()")).toEqual([]);
    expect(caps("this.navigator.userAgent")).toEqual([]);
  });

  it("keys and declarations", () => {
    expect(caps("const o = { userAgent: 1 }; function geolocation() {}")).toEqual([]);
    expect(caps("const { userAgent } = req")).toEqual([]);
  });
});

describe("identity: destructuring", () => {
  it("reads through an object pattern", () => {
    expect(uses("const { userAgent } = navigator")[0]).toMatchObject({
      capability: "identity.device",
      expression: "{ userAgent } = navigator",
    });
    expect(caps("const { clipboard: cb } = window.navigator")).toEqual(["identity.clipboard"]);
    expect(caps("({ geolocation } = navigator)")).toEqual(["identity.geolocation"]);
    expect(caps("const { onLine } = navigator")).toEqual([]);
  });

  it("shadowed navigator is not a use", () => {
    expect(uses("const navigator = fake(); navigator.userAgent")).toEqual([]);
  });
});
