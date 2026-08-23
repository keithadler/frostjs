/**
 * Adapter over oxc-parser. Everything downstream imports AST types and the
 * parse entry points from here, never from oxc-parser directly, so a change
 * in oxc's AST shape is absorbed in one file.
 */
import fs from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import type { Program, Node } from "oxc-parser";

export type { Program, Node };

export interface ParseError {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface Comment {
  type: "Line" | "Block";
  value: string;
  start: number;
  end: number;
}

export interface ParsedFile {
  file: string;
  source: string;
  program: Program;
  comments: Comment[];
  errors: ParseError[];
  lines: LineIndex;
}

/** Offsets of the first character of each line. */
export type LineIndex = readonly number[];

export function lineIndex(source: string): LineIndex {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** Map a character offset to a 1-based line and column. */
export function positionAt(lines: LineIndex, offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lines[lo]! + 1 };
}

export function parseSource(file: string, source: string): ParsedFile {
  const ext = path.extname(file);
  const result = parseSync(file, source, {
    sourceType:
      ext === ".mjs" || ext === ".mts" ? "module" : ext === ".cjs" || ext === ".cts" ? "script" : "unambiguous",
  });
  const lines = lineIndex(source);
  const errors: ParseError[] = result.errors.map((e) => {
    const offset = e.labels?.[0]?.start ?? 0;
    const pos = positionAt(lines, offset);
    return { file, line: pos.line, column: pos.column, message: e.message };
  });
  return { file, source, program: result.program, comments: result.comments as Comment[], errors, lines };
}

export function parseFile(file: string): ParsedFile {
  return parseSource(file, fs.readFileSync(file, "utf8"));
}
