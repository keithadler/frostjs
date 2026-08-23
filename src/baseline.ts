/**
 * Baseline snapshots, ported from exact. A baseline freezes the violations
 * a codebase already has so that only new ones fail the build. Entries are
 * keyed on (file, capability, expression text), never on line numbers, so
 * unrelated edits do not invalidate them. Paths are relative to the
 * baseline file's directory.
 */
import fs from "node:fs";
import path from "node:path";

export interface BaselineEntry {
  file: string;
  capability: string;
  expression: string;
}

export interface Baseline {
  version: 1;
  entries: BaselineEntry[];
}

export function normalizeExpression(expression: string): string {
  return expression.replace(/\s+/g, " ").trim();
}

export function baselineKey(file: string, capability: string, expression: string): string {
  return `${file.split(path.sep).join("/")} ${capability} ${normalizeExpression(expression)}`;
}

export function readBaseline(file: string): Baseline {
  if (!fs.existsSync(file)) return { version: 1, entries: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`baseline ${file} is not valid JSON: ${(e as Error).message}`);
  }
  const b = raw as Partial<Baseline>;
  if (b.version !== 1 || !Array.isArray(b.entries)) throw new Error(`baseline ${file} has an unknown format`);
  return { version: 1, entries: dedupe(b.entries) };
}

export function writeBaseline(file: string, entries: readonly BaselineEntry[]): number {
  const out: Baseline = { version: 1, entries: dedupe(entries) };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  return out.entries.length;
}

function dedupe(entries: readonly BaselineEntry[]): BaselineEntry[] {
  const seen = new Map<string, BaselineEntry>();
  for (const e of entries) {
    const n = { file: e.file, capability: e.capability, expression: normalizeExpression(e.expression) };
    seen.set(baselineKey(n.file, n.capability, n.expression), n);
  }
  return [...seen.values()].sort((a, b) =>
    a.file === b.file
      ? a.capability === b.capability
        ? a.expression.localeCompare(b.expression)
        : a.capability.localeCompare(b.capability)
      : a.file.localeCompare(b.file),
  );
}

/** The set of keys a baseline covers. */
export function baselineKeys(b: Baseline): Set<string> {
  return new Set(b.entries.map((e) => baselineKey(e.file, e.capability, e.expression)));
}
