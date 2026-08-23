import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { taint } from "../src/extract/taint.js";

const flows = (src: string) => taint(parseSource("t.js", src)).map((f) => `${f.source}->${f.sink}`);

describe("taint: untrusted source into a dangerous sink", () => {
  it("URL sources into code and markup sinks", () => {
    expect(flows("eval(location.hash.slice(1))")).toEqual(["location.hash->eval"]);
    expect(flows("el.innerHTML = location.search")).toEqual(["location.search->innerHTML"]);
    expect(flows("frame.srcdoc = window.location.href")).toEqual(["location.href->srcdoc"]);
    expect(flows("new Function(document.URL)")).toEqual(["document.URL->Function"]);
    expect(flows("document.write(document.cookie)")).toEqual(["document.cookie->document.write"]);
    expect(flows("importScripts(decodeURIComponent(location.search))")).toEqual(["location.search->importScripts"]);
    expect(flows("import(location.hash)")).toEqual(["location.hash->import()"]);
  });

  it("flows through variables, string ops, concat, JSON.parse and URLSearchParams", () => {
    expect(flows('var h = location.hash; var r = h.substring(1); el.innerHTML = "<i>" + r + "</i>";')).toEqual([
      "location.hash->innerHTML",
    ]);
    expect(flows('const q = new URLSearchParams(location.search).get("q"); el.innerHTML = q;')).toEqual([
      "location.search->innerHTML",
    ]);
    expect(flows("eval(JSON.parse(location.hash).cmd)")).toEqual(["location.hash->eval"]);
    expect(flows("el.outerHTML = `x${document.referrer}y`")).toEqual(["document.referrer->outerHTML"]);
  });

  it("open redirect and setAttribute handler", () => {
    expect(flows("location.href = location.hash.slice(1)")).toEqual(["location.hash->location (redirect)"]);
    expect(flows("location.assign(location.search)")).toEqual(["location.search->location (redirect)"]);
    expect(flows("window.open(document.URL)")).toEqual(["document.URL->window.open (redirect)"]);
    expect(flows('el.setAttribute("onclick", location.hash)')).toEqual(['location.hash->setAttribute("onclick")']);
  });

  it("postMessage data into a sink (window handler only)", () => {
    expect(flows('window.addEventListener("message", (e) => { eval(e.data); })')).toEqual(["postMessage data->eval"]);
    expect(flows("window.onmessage = (e) => { el.innerHTML = e.data.html; }")).toEqual(["postMessage data->innerHTML"]);
    expect(flows('self.addEventListener("message", (e) => { eval(e.data); })')).toEqual([]); // worker: creator, not attacker
  });

  it("flow through nested functions (closure)", () => {
    expect(flows('const u = location.hash; btn.addEventListener("click", () => eval(u));')).toEqual([
      "location.hash->eval",
    ]);
  });
});

describe("taint: must stay quiet", () => {
  it("an unknown call breaks the chain (sanitizers)", () => {
    expect(flows("el.innerHTML = DOMPurify.sanitize(location.hash)")).toEqual([]);
    expect(flows("el.innerHTML = escapeHtml(location.search)")).toEqual([]);
    expect(flows("eval(compile(location.hash))")).toEqual([]);
  });

  it("constants and non-source values", () => {
    expect(flows('eval("1+1"); el.innerHTML = "<b>ok</b>";')).toEqual([]);
    expect(flows("el.innerHTML = user.bio; eval(config.expr);")).toEqual([]);
    expect(flows('el.innerHTML = document.getElementById("x").value')).toEqual([]); // DOM value not modeled
  });

  it("a tainted value into a benign place", () => {
    expect(flows("console.log(location.hash); const x = location.search; return x.length;")).toEqual([]);
    expect(flows("fetch(location.href)")).toEqual([]); // fetch is a capability, not a taint sink here
  });

  it("a shadowed global is not a source", () => {
    expect(flows("function f(location) { eval(location.hash); }")).toEqual([]);
    expect(flows("const document = mock; document.write(document.cookie);")).toEqual([]);
  });

  it("reading a safe location member", () => {
    expect(flows("el.innerHTML = location.protocol")).toEqual([]);
  });
});

describe("taint: location sources are narrowed to attacker-influenced parts", () => {
  const flows2 = (src: string) => taint(parseSource("t.js", src)).map((f) => f.source);
  it("query, fragment, full URL and path are sources", () => {
    expect(flows2("el.innerHTML = location.search")).toEqual(["location.search"]);
    expect(flows2("el.innerHTML = location.hash")).toEqual(["location.hash"]);
    expect(flows2("el.innerHTML = location.href")).toEqual(["location.href"]);
    expect(flows2("el.innerHTML = location.pathname")).toEqual(["location.pathname"]);
  });
  it("the page's own identity is not a source", () => {
    expect(flows2("el.innerHTML = location.host")).toEqual([]);
    expect(flows2("el.innerHTML = location.hostname")).toEqual([]);
    expect(flows2("el.innerHTML = location.origin")).toEqual([]);
    expect(flows2("el.innerHTML = location.protocol")).toEqual([]);
  });
});
