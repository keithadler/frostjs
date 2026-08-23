/** Finding and loading the policy file. */
import fs from "node:fs";
import path from "node:path";
import { compile, type Policy } from "./compile.js";
import { parsePolicy, type ParsedPolicy, type Rule } from "./parse.js";

export const POLICY_FILENAME = "frostjs.policy";

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
 * Walk up from `start` looking for frostjs.policy. `stopAt`, when given, is the
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

/** Today as YYYY-MM-DD, the form every expiry check uses. */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Read and compile a policy file. Throws PolicyError when it cannot be
 * read as a policy, or a plain Error when the file cannot be read at all.
 * `shownAs` is the name used in messages, typically relative to the cwd.
 */
export function compilePolicyFile(policyFile: string, today: string, shownAs: string = policyFile): Policy {
  return compile(loadMerged(path.resolve(policyFile), shownAs, new Set()), { today });
}

/** A glob interpreted relative to `from`, expressed relative to `to`, forward slashes. */
function rebase(from: string, to: string, glob: string): string {
  return path.relative(to, path.resolve(from, glob)).split(path.sep).join("/") || ".";
}

/**
 * Read and parse a policy, then merge in every policy it `extends`. Base
 * rules come first; base path globs, `vendored` and `ignore` are rebased
 * from the base's directory to this policy's, so a base can live anywhere
 * and its scoping still means what it says. `taint` is the union; the name
 * is this policy's. Cycles and missing targets are errors.
 */
function loadMerged(policyFile: string, shownAs: string, seen: Set<string>): ParsedPolicy {
  if (seen.has(policyFile)) throw new Error(`${shownAs}: policy extends itself (cycle)`);
  seen.add(policyFile);
  let source: string;
  try {
    source = fs.readFileSync(policyFile, "utf8");
  } catch (e) {
    throw new Error(`cannot read policy ${shownAs}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  const parsed = parsePolicy(source, shownAs);
  if (parsed.extends.length === 0) return parsed;

  const dir = path.dirname(policyFile);
  const baseRules: Rule[] = [];
  const baseVendored: string[] = [];
  const baseIgnore: string[] = [];
  let baseTaint = false;
  for (const ext of parsed.extends) {
    const baseFile = path.resolve(dir, ext.path);
    if (!fs.existsSync(baseFile)) throw new Error(`${shownAs} line ${ext.line}: extends target not found: ${ext.path}`);
    const base = loadMerged(baseFile, ext.path, new Set(seen));
    const baseDir = path.dirname(baseFile);
    for (const r of base.rules) baseRules.push({ ...r, paths: r.paths.map((g) => rebase(baseDir, dir, g)) });
    for (const g of base.vendored) baseVendored.push(rebase(baseDir, dir, g));
    for (const g of base.ignore) baseIgnore.push(rebase(baseDir, dir, g));
    baseTaint = baseTaint || base.taint;
  }
  return {
    file: parsed.file,
    name: parsed.name,
    rules: [...baseRules, ...parsed.rules],
    vendored: [...baseVendored, ...parsed.vendored],
    ignore: [...baseIgnore, ...parsed.ignore],
    taint: baseTaint || parsed.taint,
    extends: [],
  };
}
