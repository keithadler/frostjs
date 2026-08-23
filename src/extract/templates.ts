/**
 * Framework single-file components: Vue (.vue) and Svelte (.svelte). Each
 * has a `<script>` block that is JavaScript or TypeScript, and a template
 * whose one capability surface frostjs can read statically is the innerHTML
 * escape hatch: Vue's `v-html`, Svelte's `{@html ...}`. Template bindings
 * like `@click` or `:src` reference component scope, not values frostjs
 * tracks, so they are left alone. As with HTML, a tolerant regex reads the
 * markup; adversarial markup is out of the threat model.
 */
import path from "node:path";
import { parseSync } from "oxc-parser";
import { lineIndex, positionAt, type Comment, type ParsedFile } from "./ast.js";
import { mask } from "./html.js";
import type { CapabilityUse } from "./capability.js";

export interface TemplateExtract {
  /** Each `<script>` block, parsed as its own ParsedFile positioned in the file. */
  scripts: ParsedFile[];
  /** Capability uses read from the template markup. */
  uses: CapabilityUse[];
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const IS_TS = /\blang\s*=\s*["']?(ts|typescript)["']?/i;

/** True for a framework single-file component discovery analyzes. */
export function isTemplate(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ext === ".vue" || ext === ".svelte";
}

/** Parse every `<script>` block, masking everything outside it so positions stay in the file. */
function parseScripts(file: string, source: string, lines: readonly number[]): ParsedFile[] {
  const out: ParsedFile[] = [];
  for (const m of source.matchAll(SCRIPT)) {
    const content = m[2] ?? "";
    if (content.trim() === "") continue;
    const open = m.index! + m[0].indexOf(">") + 1;
    const masked = mask(source, open, open + content.length);
    const lang = IS_TS.test(m[1] ?? "") ? "ts" : "js";
    const result = parseSync(path.basename(file) + `.${lang}`, masked, { lang, sourceType: "module" });
    const errors = result.errors.map((e) => {
      const pos = positionAt(lines, e.labels?.[0]?.start ?? open);
      return { file, line: pos.line, column: pos.column, message: e.message };
    });
    out.push({
      file,
      source: masked,
      program: result.program,
      comments: result.comments as Comment[],
      errors,
      lines: [...lines],
    });
  }
  return out;
}

/** An innerHTML-escape-hatch use at an offset in the file. */
function htmlUse(file: string, lines: readonly number[], offset: number, expression: string): CapabilityUse {
  const pos = positionAt(lines, offset);
  return {
    capability: "dom-escape.html",
    target: null,
    file,
    line: pos.line,
    column: pos.column,
    expression: expression.replace(/\s+/g, " ").slice(0, 80),
    confidence: "certain",
    origin: "inline-html",
    suppressed: false,
  };
}

/** Vue: `<script>`/`<script setup>` blocks, and `v-html` in the template. */
export function parseVue(file: string, source: string): TemplateExtract {
  const lines = lineIndex(source);
  const uses: CapabilityUse[] = [];
  for (const a of source.matchAll(/\bv-html\s*=\s*("[^"]*"|'[^']*')/gi)) {
    uses.push(htmlUse(file, lines, a.index!, a[0]));
  }
  return { scripts: parseScripts(file, source, lines), uses };
}

/** Svelte: the `<script>` block, and `{@html ...}` in the markup. */
export function parseSvelte(file: string, source: string): TemplateExtract {
  const lines = lineIndex(source);
  const uses: CapabilityUse[] = [];
  for (const a of source.matchAll(/\{@html\b([\s\S]*?)\}/gi)) {
    uses.push(htmlUse(file, lines, a.index!, a[0]));
  }
  return { scripts: parseScripts(file, source, lines), uses };
}

/** Extract from a template file, dispatching by extension. */
export function parseTemplate(file: string, source: string): TemplateExtract {
  return path.extname(file).toLowerCase() === ".svelte" ? parseSvelte(file, source) : parseVue(file, source);
}
