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
import { parseFile, type ParsedFile } from "./extract/ast.js";
import { extract } from "./extract/index.js";
import { matchesGlob } from "./policy/index.js";
import { describeUse } from "./report/text.js";
import {
  guessPackage,
  integrityOfFile,
  lookup,
  type Registry,
  type RegistryEntry,
  type RegistryUse,
} from "./registry.js";

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"];

export interface SyncResult {
  /** The reconciled registry. `sync` does not write it; the caller does. */
  registry: Registry;
  /** What happened, one printable line each, in order. */
  lines: string[];
  /** Conditions worth a person's attention that are not findings (no lockfile). */
  warnings: string[];
  /** True when something needs a person: a new package, or a bump with new capabilities. */
  needsReview: boolean;
}

/** The first lockfile found in `dir`, or null. */
function findLockfile(dir: string): string | null {
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

/** Distinct (capability, target) pairs of at least probable confidence, sorted. */
export function usesOf(parsed: ParsedFile): RegistryUse[] {
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

const key = (u: RegistryUse): string => describeUse(u.capability, u.target);

/** Reconcile the registry with the vendored files under `policyDir`. See the module comment. */
export function sync(registry: Registry, policyDir: string, vendored: readonly string[], today: string): SyncResult {
  const lines: string[] = [];
  const warnings: string[] = [];
  let needsReview = false;
  let entries = [...registry.entries];

  const lockfile = findLockfile(policyDir);
  let lock: Registry["lockfile"];
  if (lockfile === null) {
    warnings.push("no lockfile found beside the policy; there is nothing to pin dependency versions to");
  } else {
    lock = { path: path.basename(lockfile), integrity: integrityOfFile(lockfile) };
    if (registry.lockfile && registry.lockfile.integrity === lock.integrity)
      lines.push(`${lock.path} unchanged since last sync`);
    else if (registry.lockfile) lines.push(`${lock.path} changed since last sync`);
  }

  const files = discover([policyDir], { include: includesFor(vendored) });
  const present = new Set<string>();
  for (const file of files) {
    const rel = path.relative(policyDir, file).split(path.sep).join("/");
    if (!vendored.some((g) => matchesGlob(g, rel))) continue;
    const integrity = integrityOfFile(file);
    present.add(integrity);
    if (lookup({ version: 1, entries }, integrity) !== null) continue;

    const pkg = guessPackage(file, policyDir);
    const previous = entries.filter((e) => e.package === pkg.package).sort((a, b) => b.added.localeCompare(a.added))[0];
    const parsed = parseFile(file);
    if (parsed.errors.length > 0) {
      lines.push(`${rel}: does not parse; not added`);
      needsReview = true;
      continue;
    }
    const uses = usesOf(parsed);
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

  return { registry: { version: 1, ...(lock ? { lockfile: lock } : {}), entries }, lines, warnings, needsReview };
}
