import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const caps = (src: string) => extract(parseSource("t.js", src)).map((u) => u.capability);
const uses = (src: string) => extract(parseSource("t.js", src));

describe("network.webrtc / network.webtransport", () => {
  it("RTCPeerConnection, bare and prefixed", () => {
    expect(caps("new RTCPeerConnection(config)")).toEqual(["network.webrtc"]);
    expect(caps("const pc = RTCPeerConnection;")).toEqual(["network.webrtc"]);
    expect(caps("new webkitRTCPeerConnection(c); new mozRTCPeerConnection(c)")).toEqual([
      "network.webrtc",
      "network.webrtc",
    ]);
    expect(caps("window.RTCPeerConnection")).toEqual(["network.webrtc"]);
  });
  it("WebTransport carries its URL target", () => {
    expect(uses('new WebTransport("https://relay.example/wt")')[0]).toMatchObject({
      capability: "network.webtransport",
      target: "relay.example",
    });
  });
  it("other objects stay quiet", () => {
    expect(caps("lib.RTCPeerConnection(); const RTCPeerConnection = X; new RTCPeerConnection()")).toEqual([]);
  });
});

describe("device.payment", () => {
  it("PaymentRequest, bare and via window", () => {
    expect(caps("new PaymentRequest(methods, details)")).toEqual(["device.payment"]);
    expect(caps("PaymentRequest.prototype")).toEqual(["device.payment"]);
    expect(caps("window.PaymentRequest")).toEqual(["device.payment"]);
  });
  it("Notification still works and is separate", () => {
    expect(caps('new Notification("hi")')).toEqual(["device.notification"]);
  });
  it("shadowed / other object stays quiet", () => {
    expect(caps("const PaymentRequest = Fake; new PaymentRequest(); lib.PaymentRequest()")).toEqual([]);
  });
});
