/**
 * Reproduce SHOWCASE.md: copy three.js 0.160.0 (already fetched and
 * hash-verified by `npm run corpus`) next to the showcase policy and run
 * frostjs over it.
 *
 *   npm run showcase            the two files the write-up is about
 *   npm run showcase -- --all   everything under src and examples/jsm
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = path.join(root, "corpus", ".cache", "three@0.160.0");
const work = path.join(root, "showcase", "three", ".work");

if (!fs.existsSync(source)) {
  execFileSync("npm", ["run", "corpus"], { cwd: root, stdio: "inherit" });
}
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.cpSync(path.join(source, "src"), path.join(work, "src"), { recursive: true });
fs.cpSync(path.join(source, "examples", "jsm"), path.join(work, "examples", "jsm"), { recursive: true });
fs.copyFileSync(path.join(root, "showcase", "three", "frostjs.policy"), path.join(work, "frostjs.policy"));

const all = process.argv.includes("--all");
const targets = all
  ? ["src", "examples/jsm"]
  : ["examples/jsm/libs/ecsy.module.js", "examples/jsm/physics/RapierPhysics.js"];
const r = execFileSync("node", [path.join(root, "dist", "cli", "main.js"), "--exit-zero", ...targets], {
  cwd: work,
  encoding: "utf8",
});
process.stdout.write(r);
