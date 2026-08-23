import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseVue, parseSvelte, isTemplate } from "../src/extract/templates.js";
import { htmlAttributeUses } from "../src/extract/html.js";
import { extract } from "../src/extract/index.js";
import { isTemplate as discoverIsTemplate } from "../src/discover/index.js";
import { cliIn } from "./helpers.js";

const scriptCaps = (ex: { scripts: import("../src/extract/ast.js").ParsedFile[] }) =>
  ex.scripts.flatMap((s) => extract(s)).map((u) => u.capability);

describe("isTemplate", () => {
  it("recognizes .vue and .svelte", () => {
    expect(isTemplate("A.vue")).toBe(true);
    expect(isTemplate("B.svelte")).toBe(true);
    expect(isTemplate("c.js")).toBe(false);
    expect(discoverIsTemplate("A.vue")).toBe(true);
  });
});

describe("Vue", () => {
  it("v-html is an innerHTML sink at its position", () => {
    const v = parseVue("A.vue", '<template>\n  <div v-html="x"></div>\n</template>');
    expect(v.uses.map((u) => [u.capability, u.line, u.column])).toEqual([["dom-escape.html", 2, 8]]);
  });
  it("parses <script setup lang=ts> and ignores @click / :src bindings", () => {
    const v = parseVue(
      "A.vue",
      '<template><button @click="f" :src="u">x</button></template>\n<script setup lang="ts">localStorage.x; fetch("https://api.example.com/z");</script>',
    );
    expect(v.uses).toEqual([]);
    expect(scriptCaps(v)).toEqual(["storage.local", "network.fetch"]);
  });
  it("single-quoted v-html", () => {
    expect(parseVue("A.vue", "<div v-html='y' />").uses.length).toBe(1);
  });
});

describe("Svelte", () => {
  it("{@html} is an innerHTML sink", () => {
    const s = parseSvelte("B.svelte", "<p>{@html body}</p>");
    expect(s.uses.map((u) => u.capability)).toEqual(["dom-escape.html"]);
  });
  it("parses the <script> block", () => {
    const s = parseSvelte("B.svelte", '<script lang="ts">document.cookie = "a=1";</script>\n<i>hi</i>');
    expect(scriptCaps(s)).toEqual(["storage.cookie"]);
    expect(s.uses).toEqual([]);
  });
});

describe("Angular [innerHTML]", () => {
  it("is an innerHTML sink in an HTML template", () => {
    expect(htmlAttributeUses("c.html", '<div [innerHTML]="html"></div>').map((u) => u.capability)).toEqual([
      "dom-escape.html",
    ]);
    expect(htmlAttributeUses("c.html", '<div [innerHTML]=""></div>')).toEqual([]);
  });
});

describe("frostjs check on framework files", () => {
  it("discovers and analyzes .vue and .svelte", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frostjs-tpl-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "frostjs.policy"), 'policy "t"\n');
    fs.writeFileSync(
      path.join(dir, "src", "A.vue"),
      '<template><div v-html="h" /></template>\n<script>localStorage.x;</script>',
    );
    fs.writeFileSync(path.join(dir, "src", "B.svelte"), "<p>{@html b}</p>");
    const r = cliIn(dir, "src");
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/A\.vue:1:\d+: dom-escape\.html denied/);
    expect(r.stdout).toContain("storage.local denied");
    expect(r.stdout).toContain("B.svelte:1:4: dom-escape.html denied");
  });
});
