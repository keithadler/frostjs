/**
 * `permit registry sync`: keep the vendored-code registry in step with the
 * tree after a dependency bump.
 *
 * For every vendored file whose hash is unknown, find the previous entry
 * for the same package. If the new version uses exactly the capability set
 * the old one did, re-admit it automatically and note the bump. If it uses
 * anything new, refuse, print the difference, and point at vendor add: a
 * bump that quietly adds a network destination is the threat this tool
 * exists to catch. Entries whose file is gone are pruned. The lockfile's
 * hash is recorded so the next run can say whether anything moved.
 */
import fs from "node:fs";
import path from "node:path";
import { discover } from "./discover/index.js";
import { parseFile } from "./extract/ast.js";
import { extract } from "./extract/index.js";
import { matchesGlob } from "./policy/glob.js";
import {
  guessPackage,
  integrityOfFile,
  lookup,
  type Registry,
  type RegistryEntry,
  type RegistryUse,
} from "./registry.js";

export const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"];

export interface SyncResult {
  registry: Registry;
  /** Printable lines, in order. */
  lines: string[];
  /** True when something needs a person: a new package, or a bump with new capabilities. */
  needsReview: boolean;
}

export function findLockfile(dir: string): string | null {
  for (const name of LOCKFILES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Directory names a vendored glob reaches into that discovery would otherwise skip. */
export function includesFor(vendored: readonly string[]): string[] {
  const out = new Set<string>();
  for (const g of vendored) {
    const first = g.replace(/^\.\//, "").split("/")[0];
    if (first && !/[*?]/.test(first)) out.add(first);
  }
  return [...out];
}

export function usesOf(file: string): RegistryUse[] | null {
  const parsed = parseFile(file);
  if (parsed.errors.length > 0) return null;
  const seen = new Map<string, RegistryUse>();
  for (const u of extract(parsed)) {
    if (u.confidence === "possible") continue;
    seen.set(`${u.capability}\0${u.target ?? ""}`, { capability: u.capability, target: u.target });
  }
  return [...seen.values()].sort((a, b) =>
    a.capability === b.capability
      ? (a.target ?? "").localeCompare(b.target ?? "")
      : a.capability.localeCompare(b.capability),
  );
}

const key = (u: RegistryUse): string => `${u.capability}${u.target !== null ? ` to ${u.target}` : ""}`;

export function sync(registry: Registry, policyDir: string, vendored: readonly string[], today: string): SyncResult {
  const lines: string[] = [];
  let needsReview = false;
  let entries = [...registry.entries];

  const lockfile = findLockfile(policyDir);
  let lock: Registry["lockfile"];
  if (lockfile === null) {
    lines.push("warning: no lockfile found beside the policy; there is nothing to pin dependency versions to");
  } else {
    lock = { path: path.basename(lockfile), integrity: integrityOfFile(lockfile) };
    if (registry.lockfile && registry.lockfile.integrity === lock.integrity)
      lines.push(`${lock.path} unchanged since last sync`);
    else if (registry.lockfile) lines.push(`${lock.path} changed since last sync`);
  }

  const roots = includesFor(vendored)
    .map((d) => path.join(policyDir, d))
    .filter((d) => fs.existsSync(d));
  const files = roots.length ? discover([policyDir], { include: includesFor(vendored) }) : discover([policyDir]);
  const present = new Set<string>();
  for (const file of files) {
    const rel = path.relative(policyDir, file).split(path.sep).join("/");
    if (!vendored.some((g) => matchesGlob(g, rel))) continue;
    const integrity = integrityOfFile(file);
    present.add(integrity);
    if (lookup({ version: 1, entries }, integrity) !== null) continue;

    const pkg = guessPackage(file, policyDir);
    const previous = entries.filter((e) => e.package === pkg.package).sort((a, b) => b.added.localeCompare(a.added))[0];
    const uses = usesOf(file);
    if (uses === null) {
      lines.push(`${rel}: does not parse; not added`);
      needsReview = true;
      continue;
    }
    if (!previous) {
      lines.push(
        `${rel} (${pkg.package}@${pkg.version}): new package, not in the registry; review it with: permit vendor add ${rel}`,
      );
      needsReview = true;
      continue;
    }
    const before = new Set(previous.uses.map(key));
    const after = new Set(uses.map(key));
    const added = [...after].filter((k) => !before.has(k));
    const removed = [...before].filter((k) => !after.has(k));
    if (added.length === 0) {
      const entry: RegistryEntry = {
        integrity,
        package: pkg.package,
        version: pkg.version,
        file: rel,
        uses,
        added: today,
      };
      entries.push(entry);
      present.add(integrity);
      const note = removed.length ? `; no longer uses ${removed.join(", ")}` : "";
      lines.push(
        `${rel}: ${pkg.package} ${previous.version} -> ${pkg.version}, capabilities unchanged, re-admitted${note}`,
      );
    } else {
      needsReview = true;
      lines.push(`${rel}: ${pkg.package} ${previous.version} -> ${pkg.version} adds ${added.join(", ")}; NOT admitted`);
      lines.push(`  review it with: permit vendor add ${rel}`);
    }
  }

  // Prune entries whose file is gone and whose hash is nowhere in the tree.
  const kept: RegistryEntry[] = [];
  for (const e of entries) {
    const exists = fs.existsSync(path.join(policyDir, e.file));
    if (exists || present.has(e.integrity)) kept.push(e);
    else lines.push(`${e.file}: gone, ${e.package}@${e.version} removed from the registry`);
  }
  entries = kept;

  return { registry: { version: 1, ...(lock ? { lockfile: lock } : {}), entries }, lines, needsReview };
}
