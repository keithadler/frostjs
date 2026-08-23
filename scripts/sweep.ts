/**
 * Sweep popular npm packages with `frostjs audit` and rank them by what
 * turns up: remote code paths first (the shape that found ECSY's remote
 * eval in three.js), then code generation from non-constant input, then
 * hosts reached, wildcard postMessage and service workers.
 *
 *   npm run sweep                       the built-in list
 *   npm run sweep -- react vue@3.5.0    named packages
 *
 * Packages are fetched with npm pack into corpus/.cache and their
 * integrity is printed so a finding can be reproduced.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discover, isHtml } from "../src/discover/index.js";
import { parseFile, type ParsedFile } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";
import { parseHtml } from "../src/extract/html.js";
import type { CapabilityUse } from "../src/extract/capability.js";
import { audit, groupByFile, type Audit } from "../src/audit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(path.resolve(here, ".."), "corpus", ".cache");

/** Browser-targeted libraries people actually ship. Deliberately not node-only tools. */
const DEFAULT_PACKAGES = [
  "react-dom",
  "vue",
  "preact",
  "lit",
  "solid-js",
  "svelte",
  "alpinejs",
  "htmx.org",
  "jquery",
  "axios",
  "socket.io-client",
  "d3",
  "dayjs",
  "moment",
  "gsap",
  "animejs",
  "pixi.js",
  "phaser",
  "leaflet",
  "swiper",
  "bootstrap",
  "highlight.js",
  "prismjs",
  "codemirror",
  "quill",
  "video.js",
  "hls.js",
  "plyr",
  "sweetalert2",
  "dompurify",
  "mermaid",
  "katex",
  "pdfjs-dist",
  "fabric",
  "konva",
  "p5",
  "tone",
  "howler",
  "workbox-window",
  "@sentry/browser",
  "posthog-js",
  "mixpanel-browser",
  "firebase",
  "three",
  "chart.js",
  "marked",
  "lodash",
  "swagger-ui-dist",
  "tinymce",
  "ckeditor5",
];

function ensure(spec: string): { dir: string; integrity: string; spec: string } {
  const dir = path.join(cacheDir, `sweep-${spec.replace(/[/@]/g, "_")}`);
  const marker = path.join(dir, ".ok");
  if (fs.existsSync(marker)) {
    const [resolved, integrity] = fs.readFileSync(marker, "utf8").split("\n");
    return { dir, integrity: integrity!, spec: resolved! };
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  process.stderr.write(`fetching ${spec}\n`);
  const out = execFileSync("npm", ["pack", spec, "--pack-destination", cacheDir, "--silent"], {
    encoding: "utf8",
  }).trim();
  const tgz = path.join(cacheDir, out.split("\n").pop()!);
  const raw = JSON.parse(
    execFileSync("npm", ["view", spec, "version", "name", "dist.integrity", "--json"], { encoding: "utf8" }),
  );
  const m = (Array.isArray(raw) ? raw[raw.length - 1] : raw) as {
    name: string;
    version: string;
    "dist.integrity": string;
  };
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1"]);
  fs.unlinkSync(tgz);
  const resolved = `${m.name}@${m.version}`;
  fs.writeFileSync(marker, `${resolved}\n${m["dist.integrity"]}`);
  return { dir, integrity: m["dist.integrity"], spec: resolved };
}

interface Entry {
  spec: string;
  integrity: string;
  audit: Audit;
  parseErrors: number;
}

function analyze(spec: string): Entry {
  const { dir, integrity, spec: resolved } = ensure(spec);
  const byFile = new Map<string, CapabilityUse[]>();
  const texts = new Map<string, string>();
  let parseErrors = 0;
  for (const file of discover([dir])) {
    const rel = path.relative(dir, file);
    const text = fs.readFileSync(file, "utf8");
    const units: ParsedFile[] = isHtml(file) ? parseHtml(file, text) : [parseFile(file)];
    const uses: CapabilityUse[] = [];
    for (const unit of units) {
      if (unit.errors.length > 0) parseErrors++;
      else uses.push(...extract(unit).map((u) => ({ ...u, file: rel })));
    }
    byFile.set(rel, uses);
    texts.set(rel, text);
  }
  return { spec: resolved, integrity, audit: audit(byFile, texts), parseErrors };
}

const score = (a: Audit): number =>
  a.remoteCodePaths.length * 100 +
  a.dynamicCodegen.length * 10 +
  a.hosts.size * 3 +
  a.wildcardPostMessage.length * 2 +
  a.serviceWorkers.length;
const site = (u: CapabilityUse): string => `${u.file}:${u.line} ${u.expression.replace(/\s+/g, " ").slice(0, 70)}`;

const specs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PACKAGES;
const entries: Entry[] = [];
for (const spec of specs) {
  try {
    entries.push(analyze(spec));
  } catch (e) {
    process.stderr.write(`${spec}: ${(e as Error).message.split("\n")[0]}\n`);
  }
}
entries.sort((x, y) => score(y.audit) - score(x.audit));

for (const { spec, integrity, audit: a, parseErrors } of entries) {
  const flags: string[] = [];
  if (a.remoteCodePaths.length) flags.push(`REMOTE CODE PATH x${a.remoteCodePaths.length}`);
  if (a.dynamicCodegen.length) flags.push(`dynamic codegen x${a.dynamicCodegen.length}`);
  if (a.hosts.size) flags.push(`reaches: ${[...a.hosts.keys()].join(", ")}`);
  if (a.literalHosts.length)
    flags.push(`named in strings: ${a.literalHosts.slice(0, 8).join(", ")}${a.literalHosts.length > 8 ? ", ..." : ""}`);
  if (a.wildcardPostMessage.length) flags.push(`postMessage "*" x${a.wildcardPostMessage.length}`);
  if (a.serviceWorkers.length) flags.push(`service worker x${a.serviceWorkers.length}`);
  process.stdout.write(
    `\n## ${spec}  (${a.files} files${parseErrors ? `, ${parseErrors} unparsed` : ""})  ${integrity.slice(0, 20)}...\n`,
  );
  process.stdout.write(flags.length ? flags.map((f) => `- ${f}`).join("\n") + "\n" : "- nothing notable\n");
  for (const f of a.remoteCodePaths) {
    process.stdout.write(`  ${f.file}${f.readsUrl ? "  [reads the page URL]" : ""}\n`);
    for (const u of [...f.dynamicCodegen, ...f.scriptInjection].slice(0, 4)) process.stdout.write(`    ${site(u)}\n`);
    const reach = [...f.hosts, ...f.literalHosts.filter((h) => !f.hosts.includes(h)).map((h) => `${h} (named)`)];
    if (reach.length) process.stdout.write(`    reaches: ${reach.slice(0, 8).join(", ")}\n`);
    if (f.unknownDestinations) process.stdout.write(`    and ${f.unknownDestinations} unreadable destination(s)\n`);
  }
  const rc = new Set(a.remoteCodePaths.map((f) => f.file));
  for (const u of a.dynamicCodegen.filter((u) => !rc.has(u.file)).slice(0, 3))
    process.stdout.write(`  codegen: ${site(u)}\n`);
}
