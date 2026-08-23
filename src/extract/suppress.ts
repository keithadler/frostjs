/**
 * Inline suppression:
 *
 *   // frostjs: ignore                      suppress every capability on this line
 *   // frostjs: ignore[storage.local, net]  suppress the listed codes or families
 *
 * A comment applies to uses on its own line, or, when the comment is alone on
 * its line, to uses starting on the next line.
 */
import type { ParsedFile } from "./ast.js";
import { positionAt } from "./ast.js";

export interface Suppression {
  /** A bare `frostjs: ignore`: every capability on the line. */
  all: boolean;
  /** Codes or families listed in brackets. */
  codes: string[];
}

const MARKER = /^\s*frostjs:\s*ignore(?:\[([^\]]*)\])?\s*$/;

/** Line number -> suppression in force for uses starting on that line. */
export function suppressions(parsed: ParsedFile): Map<number, Suppression> {
  const out = new Map<number, Suppression>();
  for (const c of parsed.comments) {
    const m = MARKER.exec(c.value);
    if (!m) continue;
    const spec: Suppression = m[1] === undefined ? { all: true, codes: [] } : { all: false, codes: splitCodes(m[1]) };
    const { line } = positionAt(parsed.lines, c.start);
    // Does anything other than whitespace precede the comment on its line?
    const lineStart = parsed.lines[line - 1]!;
    const alone = parsed.source.slice(lineStart, c.start).trim() === "";
    const endLine = positionAt(parsed.lines, c.end).line;
    const rest = parsed.source.slice(c.end, parsed.lines[endLine] ?? parsed.source.length).trim();
    out.set(line, merge(out.get(line), spec));
    if (alone && rest === "") out.set(endLine + 1, merge(out.get(endLine + 1), spec));
  }
  return out;
}

function splitCodes(s: string): string[] {
  return s
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function merge(a: Suppression | undefined, b: Suppression): Suppression {
  if (!a) return b;
  return { all: a.all || b.all, codes: [...a.codes, ...b.codes] };
}

/** True when the suppression covers the capability: exactly, or by its family (`storage` covers `storage.local`). */
export function isSuppressed(s: Suppression | undefined, capability: string): boolean {
  if (!s) return false;
  if (s.all) return true;
  return s.codes.some((c) => c === capability || capability.startsWith(c + "."));
}
