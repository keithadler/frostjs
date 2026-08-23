/**
 * Inline <script> blocks in HTML. Each block is parsed as JavaScript with
 * everything outside it masked to whitespace (newlines kept), so every
 * offset, line and column already refers to the HTML file and expression
 * text slices straight out of it. No HTML parser: a regular expression
 * finds script elements, which is adequate for the markup people write by
 * hand and wrong only for markup designed to confuse it, which the threat
 * model already excludes.
 */
import path from "node:path";
import { parseSync } from "oxc-parser";
import { lineIndex, positionAt, type Comment, type ParsedFile } from "./ast.js";

export interface ScriptBlock {
  /** Offset of the first character of the block's content. */
  start: number;
  /** Offset just past the last character of the content. */
  end: number;
  module: boolean;
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Script types that carry JavaScript. Anything else (json, importmap, templates) is data. */
const JS_TYPES: ReadonlySet<string> = new Set([
  "",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
  "module",
  "text/jsx",
  "text/babel",
]);

/** Offsets of every inline JavaScript block: no `src`, a JavaScript (or no) `type`, and some content. */
export function scriptBlocks(html: string): ScriptBlock[] {
  const out: ScriptBlock[] = [];
  for (const m of html.matchAll(SCRIPT)) {
    const attrs = new Map<string, string>();
    for (const a of (m[1] ?? "").matchAll(ATTR)) {
      attrs.set(a[1]!.toLowerCase(), (a[2] ?? a[3] ?? a[4] ?? "").trim().toLowerCase());
    }
    if (attrs.has("src")) continue;
    const type = attrs.get("type") ?? "";
    if (!JS_TYPES.has(type)) continue;
    const content = m[2] ?? "";
    if (content.trim() === "") continue;
    const open = m.index! + m[0].indexOf(">") + 1;
    out.push({ start: open, end: open + content.length, module: type === "module" });
  }
  return out;
}

/** Replace every character outside [start, end) with a space, keeping newlines. */
export function mask(source: string, start: number, end: number): string {
  const before = source.slice(0, start).replace(/[^\n]/g, " ");
  const after = source.slice(end).replace(/[^\n]/g, " ");
  return before + source.slice(start, end) + after;
}

/** Parse each inline script block of an HTML file as its own ParsedFile positioned in the HTML. */
export function parseHtml(file: string, source: string): ParsedFile[] {
  const lines = lineIndex(source);
  return scriptBlocks(source).map((block) => {
    const masked = mask(source, block.start, block.end);
    const result = parseSync(path.basename(file) + ".js", masked, {
      lang: "js",
      sourceType: block.module ? "module" : "unambiguous",
    });
    const errors = result.errors.map((e) => {
      const pos = positionAt(lines, e.labels?.[0]?.start ?? block.start);
      return { file, line: pos.line, column: pos.column, message: e.message };
    });
    return { file, source: masked, program: result.program, comments: result.comments as Comment[], errors, lines };
  });
}
