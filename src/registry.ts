/**
 * The fingerprint registry for vendored code (REQUIREMENTS section 8).
 * Lives at .permit/registry.json beside the policy. Maps a SHA-384 of a
 * file's bytes to the package it came from and the capability set it was
 * found to use when somebody reviewed it with `permit vendor add`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REGISTRY_RELATIVE = path.join(".permit", "registry.json");

export interface RegistryUse {
  capability: string;
  target: string | null;
}

export interface RegistryEntry {
  /** "sha384-<base64>", the same form as an SRI integrity value. */
  integrity: string;
  package: string;
  version: string;
  /** Path relative to the policy directory when the entry was added. */
  file: string;
  /** Distinct (capability, target) pairs with at least probable confidence. */
  uses: RegistryUse[];
  added: string;
}

export interface Registry {
  version: 1;
  /** Lockfile this registry was last synced against, if any. */
  lockfile?: { path: string; integrity: string };
  entries: RegistryEntry[];
}

/** The SRI-form SHA-384 of some bytes. */
function integrityOf(bytes: Buffer): string {
  return "sha384-" + createHash("sha384").update(bytes).digest("base64");
}

/** The SRI-form SHA-384 of a file's contents. */
export function integrityOfFile(file: string): string {
  return integrityOf(fs.readFileSync(file));
}

/** Where the registry lives for a policy: .permit/registry.json beside it. */
export function registryPath(policyDir: string): string {
  return path.join(policyDir, REGISTRY_RELATIVE);
}

/** Read a registry. A missing file is an empty registry; malformed JSON or an unknown version throws. */
export function readRegistry(file: string): Registry {
  if (!fs.existsSync(file)) return { version: 1, entries: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`registry ${file} is not valid JSON: ${(e as Error).message}`);
  }
  const r = raw as Partial<Registry>;
  if (r.version !== 1 || !Array.isArray(r.entries)) throw new Error(`registry ${file} has an unknown format`);
  return { version: 1, ...(r.lockfile ? { lockfile: r.lockfile } : {}), entries: r.entries };
}

/** Write the registry with entries sorted by package, version and file, creating .permit/ if needed. */
export function writeRegistry(file: string, registry: Registry): void {
  const sorted = [...registry.entries].sort((a, b) =>
    a.package === b.package
      ? a.version === b.version
        ? a.file.localeCompare(b.file)
        : a.version.localeCompare(b.version)
      : a.package.localeCompare(b.package),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...registry, entries: sorted }, null, 2) + "\n");
}

/** Replace any entry with the same integrity, then add. */
export function upsert(registry: Registry, entry: RegistryEntry): Registry {
  return { ...registry, entries: [...registry.entries.filter((e) => e.integrity !== entry.integrity), entry] };
}

/** The entry for a hash, or null. */
export function lookup(registry: Registry, integrity: string): RegistryEntry | null {
  return registry.entries.find((e) => e.integrity === integrity) ?? null;
}

/**
 * Guess the package and version a vendored file belongs to: the nearest
 * package.json between the file and `stopAt`, else the file's base name.
 */
export function guessPackage(file: string, stopAt: string): { package: string; version: string } {
  let dir = path.dirname(path.resolve(file));
  const stop = path.resolve(stopAt);
  for (;;) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const p = JSON.parse(fs.readFileSync(pj, "utf8")) as { name?: string; version?: string };
        if (typeof p.name === "string")
          return { package: p.name, version: typeof p.version === "string" ? p.version : "unknown" };
      } catch {
        // fall through to the next directory
      }
    }
    if (dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { package: path.basename(file), version: "unknown" };
}
