import fs from "node:fs";
import path from "node:path";

/** Extensions discovered by default. TS/JSX arrive in Phase G. */
export const EXTENSIONS: ReadonlySet<string> = new Set([".js", ".mjs"]);

/** Directory names skipped wherever they appear in the tree. */
export const DEFAULT_EXCLUDES: readonly string[] = ["node_modules", "dist", "build", "coverage", ".git"];

export interface DiscoverOptions {
  /** Extra directory names to skip, added to DEFAULT_EXCLUDES. */
  exclude?: readonly string[];
  /** Directory names to walk even though DEFAULT_EXCLUDES would skip them (vendored globs into node_modules). */
  include?: readonly string[];
}

/**
 * Walk the given paths and return absolute file paths to analyze, sorted and
 * deduplicated. A path that names a file directly is always included, even
 * if it sits under an excluded directory - the user asked for it by name.
 */
export function discover(inputs: readonly string[], opts: DiscoverOptions = {}): string[] {
  const excluded = new Set([...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])]);
  for (const name of opts.include ?? []) excluded.delete(name);
  const found = new Set<string>();

  for (const input of inputs) {
    const abs = path.resolve(input);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new Error(`path not found: ${input}`);
    }
    if (stat.isFile()) {
      found.add(abs);
    } else if (stat.isDirectory()) {
      walk(abs, excluded, found);
    }
  }

  return [...found].sort();
}

function walk(dir: string, excluded: ReadonlySet<string>, out: Set<string>): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) walk(full, excluded, out);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      out.add(full);
    }
  }
}
