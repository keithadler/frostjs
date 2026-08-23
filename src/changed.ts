/**
 * Changed-lines-only mode. Asks git which lines of which files differ from
 * a ref, so a PR check can fail only on uses the PR introduced or touched.
 * Untracked files count as entirely changed. Parsing the unified diff with
 * zero context keeps it to the hunk headers.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface LineRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/** Canonical absolute file path (see canonical) -> changed line ranges on the new side, or "all" for an untracked file. */
export type ChangedLines = Map<string, LineRange[] | "all">;

/**
 * One spelling for a path, so git's output and the caller's paths agree:
 * symlinks resolved (macOS temp dirs), Windows short names expanded
 * (RUNNER~1), drive letter case settled. Falls back to path.resolve when
 * the path does not exist.
 */
function canonical(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The git repository containing `cwd`, or null outside one. */
function repoRoot(cwd: string): string | null {
  try {
    return git(["rev-parse", "--show-toplevel"], cwd).trim();
  } catch {
    return null;
  }
}

/**
 * Lines changed since `ref` in the repository containing `cwd`. Throws
 * outside a repository or when git cannot diff against the ref.
 */
export function changedLines(ref: string, cwd: string): ChangedLines {
  // The ref comes from the command line, often from a CI variable. It must
  // never be read as a git option: `--output=<file>` would write a file.
  if (ref === "" || ref.startsWith("-")) throw new Error(`--changed-since needs a git ref, not '${ref}'`);
  const top = repoRoot(cwd);
  if (top === null) throw new Error("--changed-since needs a git repository");
  const root = canonical(top);
  const out: ChangedLines = new Map();

  let diff: string;
  try {
    diff = git(["diff", "-U0", "--no-color", "--no-ext-diff", "--end-of-options", ref, "--"], root);
  } catch (e) {
    const msg = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
    throw new Error(`git diff against ${ref} failed: ${msg.split("\n")[0]}`);
  }
  let current: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const name = line.slice(4).trim();
      current = name === "/dev/null" ? null : canonical(path.resolve(root, name.replace(/^b\//, "")));
      if (current !== null && !out.has(current)) out.set(current, []);
    } else if (line.startsWith("@@") && current !== null) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count === 0) continue; // pure deletion
      const ranges = out.get(current);
      if (Array.isArray(ranges)) ranges.push({ start, end: start + count - 1 });
    }
  }

  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root).split("\0").filter(Boolean);
  for (const f of untracked) out.set(canonical(path.resolve(root, f)), "all");
  return out;
}

/** True when the line of `file` (any spelling of its absolute path) was added or modified. */
export function isChanged(changed: ChangedLines, file: string, line: number): boolean {
  const ranges = changed.get(canonical(file));
  if (ranges === undefined) return false;
  if (ranges === "all") return true;
  return ranges.some((r) => line >= r.start && line <= r.end);
}
