import { run } from "../src/cli/run.js";

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export function cli(...argv: string[]): Result {
  let stdout = "";
  let stderr = "";
  const code = run(argv, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr };
}
