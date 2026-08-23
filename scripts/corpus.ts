/**
 * Corpus scan: fetch the pinned packages (once), verify their integrity,
 * run the extractor over every .js/.mjs inside, and diff the findings
 * against corpus/expected.txt.
 *
 *   npm run corpus            fail if the findings changed
 *   npm run corpus -- --update  rewrite expected.txt (only when a step intends it)
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discover, isHtml } from "../src/discover/index.js";
import { parseFile, type ParsedFile } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";
import { parseHtml } from "../src/extract/html.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const corpusDir = path.join(root, "corpus");
const cacheDir = path.join(corpusDir, ".cache");
const expectedFile = path.join(corpusDir, "expected.txt");

interface Pkg {
  name: string;
  version: string;
  integrity: string;
}
const manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, "manifest.json"), "utf8")) as { packages: Pkg[] };

function verify(tgz: string, integrity: string): void {
  const [algo, expected] = integrity.split("-", 2) as [string, string];
  const actual = createHash(algo).update(fs.readFileSync(tgz)).digest("base64");
  if (actual !== expected) throw new Error(`integrity mismatch for ${path.basename(tgz)}`);
}

function ensure(pkg: Pkg): string {
  const dir = path.join(cacheDir, `${pkg.name}@${pkg.version}`);
  if (fs.existsSync(path.join(dir, ".ok"))) return dir;
  fs.mkdirSync(cacheDir, { recursive: true });
  const spec = `${pkg.name}@${pkg.version}`;
  process.stderr.write(`fetching ${spec}\n`);
  const out = execFileSync("npm", ["pack", spec, "--pack-destination", cacheDir, "--silent"], {
    encoding: "utf8",
  }).trim();
  const tgz = path.join(cacheDir, out.split("\n").pop()!);
  verify(tgz, pkg.integrity);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1"]);
  fs.unlinkSync(tgz);
  fs.writeFileSync(path.join(dir, ".ok"), pkg.integrity);
  return dir;
}

const lines: string[] = [];
let files = 0;
let bytes = 0;
const t0 = performance.now();
for (const pkg of manifest.packages) {
  const dir = ensure(pkg);
  for (const file of discover([dir])) {
    files++;
    const units: ParsedFile[] = isHtml(file) ? parseHtml(file, fs.readFileSync(file, "utf8")) : [parseFile(file)];
    bytes += units[0]?.source.length ?? 0;
    for (const parsed of units) {
      if (parsed.errors.length > 0) {
        lines.push(`${pkg.name}@${pkg.version}/${path.relative(dir, file)}: PARSE ERROR ${parsed.errors[0]!.message}`);
        continue;
      }
      for (const u of extract(parsed, { origin: isHtml(file) ? "inline-html" : "first-party" })) {
        const expr = u.expression.replace(/\s+/g, " ").slice(0, 100);
        lines.push(
          `${pkg.name}@${pkg.version}/${path.relative(dir, file)}:${u.line}:${u.column} ${u.capability} ${u.confidence} ${expr}`,
        );
      }
    }
  }
}
lines.sort();
const seconds = ((performance.now() - t0) / 1000).toFixed(2);
const actual = lines.join("\n") + (lines.length ? "\n" : "");

if (process.argv.includes("--update")) {
  fs.writeFileSync(expectedFile, actual);
  process.stderr.write(
    `wrote ${lines.length} findings to corpus/expected.txt (${files} files, ${(bytes / 1e6).toFixed(1)} MB, ${seconds}s)\n`,
  );
  process.exit(0);
}

const expected = fs.existsSync(expectedFile) ? fs.readFileSync(expectedFile, "utf8") : "";
const have = new Set(expected.split("\n").filter(Boolean));
const got = new Set(lines);
const added = lines.filter((l) => !have.has(l));
const removed = [...have].filter((l) => !got.has(l));
for (const l of added) process.stdout.write(`+ ${l}\n`);
for (const l of removed) process.stdout.write(`- ${l}\n`);
process.stderr.write(`${files} files, ${(bytes / 1e6).toFixed(1)} MB, ${lines.length} findings, ${seconds}s`);
if (added.length || removed.length) {
  process.stderr.write(
    `: ${added.length} new, ${removed.length} gone. If this step intended the change, run: npm run corpus -- --update\n`,
  );
  process.exit(1);
}
process.stderr.write(": unchanged\n");
