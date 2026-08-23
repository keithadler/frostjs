import path from "node:path";
import { run } from "../src/cli/run.js";

/** Tests always report relative to the repo root, whatever vitest's cwd is. */
const ROOT = path.resolve(__dirname, "..");

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export function cli(...argv: string[]): Result {
  return cliIn(ROOT, ...argv);
}

/** Run with reports (and policy discovery for csp/summary) relative to `cwd`. */
export function cliIn(cwd: string, ...argv: string[]): Result {
  let stdout = "";
  let stderr = "";
  const code = run(argv, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    cwd,
  });
  return { code, stdout, stderr };
}
