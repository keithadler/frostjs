import fs from "node:fs";
import path from "node:path";

export const POLICY_FILENAME = "permit.policy";

/** The deepest directory containing every input (a file counts as its directory). */
export function commonAncestor(inputs: readonly string[]): string {
  const dirs = inputs.map((p) => {
    const abs = path.resolve(p);
    let isDir = false;
    try {
      isDir = fs.statSync(abs).isDirectory();
    } catch {
      // A missing path is reported by discover(); treat it as a file here.
    }
    return isDir ? abs : path.dirname(abs);
  });
  if (dirs.length === 0) return process.cwd();
  let common = dirs[0]!.split(path.sep);
  for (const d of dirs.slice(1)) {
    const parts = d.split(path.sep);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join(path.sep) || path.sep;
}

/**
 * Walk up from `start` looking for permit.policy. `stopAt`, when given, is the
 * last directory searched. Returns the absolute path or null.
 */
export function findPolicyFile(start: string, stopAt?: string): string | null {
  let dir = path.resolve(start);
  const stop = stopAt ? path.resolve(stopAt) : null;
  for (;;) {
    const candidate = path.join(dir, POLICY_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
