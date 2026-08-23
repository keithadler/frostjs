import { describe, expect, it } from "vitest";
import { htmlAttributeUses } from "../src/extract/html.js";

const uses = (html: string) =>
  htmlAttributeUses("t.html", html).map((u) => `${u.capability}${u.target ? " " + u.target : ""}`);

describe("htmlAttributeUses", () => {
  it("inline event handlers are a handler-from-markup sink", () => {
    expect(uses('<button onclick="f()">x</button>')).toEqual(["dom-escape.handler"]);
    expect(uses('<div onmouseover="g()" onload="h()">')).toEqual(["dom-escape.handler", "dom-escape.handler"]);
  });

  it("javascript: URLs are code", () => {
    expect(uses('<a href="javascript:steal()">x</a>')).toEqual(["codegen.eval"]);
  });

  it("a remote src/href is a resource load with a target", () => {
    expect(uses('<script src="https://cdn.evil.example/x.js"></script>')).toEqual([
      "network.resource cdn.evil.example",
    ]);
    expect(uses('<img src="https://images.example.com/a.png">')).toEqual(["network.resource images.example.com"]);
    expect(uses('<link rel="stylesheet" href="//fonts.example.com/f.css">')).toEqual([
      "network.resource fonts.example.com",
    ]);
  });

  it("iframe srcdoc is html injection", () => {
    expect(uses('<iframe srcdoc="<b>x</b>"></iframe>')).toEqual(["dom-escape.html"]);
  });

  it("stays quiet on same-origin, relative, data and ordinary attributes", () => {
    expect(uses('<img src="/logo.png"><script src="./app.js"></script>')).toEqual([]);
    expect(uses('<img src="data:image/png;base64,AAAA">')).toEqual([]);
    expect(uses('<div class="x" id="y" data-onclick="z">text</div>')).toEqual([]);
    expect(uses("<a href=\"#top\">x</a><a href='?p=2'>y</a>")).toEqual([]);
  });

  it("reports positions in the HTML file", () => {
    const u = htmlAttributeUses("t.html", 'ok\n<button onclick="f()">');
    expect(u[0]).toMatchObject({ line: 2, capability: "dom-escape.handler", expression: 'onclick="f()"' });
  });
});
