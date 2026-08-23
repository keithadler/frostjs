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
import type { CapabilityUse } from "./capability.js";
import { resolveTarget, SAME_ORIGIN } from "./target.js";

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

const TAG = /<([a-zA-Z][-a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
/** Attributes whose value is a URL that loads or navigates. */
const URL_ATTRS: ReadonlySet<string> = new Set(["src", "href", "data", "poster", "formaction", "xlink:href"]);

/**
 * Capability uses that live in HTML attributes rather than script content:
 * inline `on*` event handlers (a handler from markup), `javascript:` URLs,
 * an `<iframe srcdoc>`, and a `src`/`href` pointing at another host (a
 * remote resource load, `<script src="https://...">` most of all). Element
 * type is not checked - the attribute is what matters. Positions refer to
 * the HTML file. The same tolerant regex as the script scanner; adversarial
 * markup is out of the threat model.
 */
export function htmlAttributeUses(file: string, source: string): CapabilityUse[] {
  const lines = lineIndex(source);
  const out: CapabilityUse[] = [];
  const at = (offset: number): { line: number; column: number } => positionAt(lines, offset);
  for (const tag of source.matchAll(TAG)) {
    const attrs = tag[2] ?? "";
    const attrsStart = tag.index! + 1 + tag[1]!.length;
    for (const a of attrs.matchAll(ATTR)) {
      const name = a[1]!.toLowerCase();
      const value = (a[2] ?? a[3] ?? a[4] ?? "").trim();
      if (value === "") continue;
      const start = attrsStart + a.index!;
      const expr = source.slice(start, start + a[0].length);
      const add = (capability: string, target: string | null): void => {
        const p = at(start);
        out.push({
          capability,
          target,
          file,
          line: p.line,
          column: p.column,
          expression: expr,
          confidence: "certain",
          origin: "inline-html",
          suppressed: false,
        });
      };
      if (/^on[a-z]+$/.test(name)) {
        add("dom-escape.handler", null);
      } else if (name === "srcdoc") {
        add("dom-escape.html", null);
      } else if (URL_ATTRS.has(name)) {
        const t = resolveTarget(value);
        if (t === "javascript:") add("codegen.eval", null);
        else if (t !== null && t !== SAME_ORIGIN && t !== "data:" && t !== "blob:") add("network.resource", t);
      }
    }
  }
  return out;
}
