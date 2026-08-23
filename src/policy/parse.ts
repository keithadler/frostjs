/**
 * Parser for permit's policy files, written in frost's policy dialect:
 * line-oriented, one rule per line, `--` or `#` comments, case-insensitive
 * keywords, double-quoted strings. A trailing comment on a rule is its hint
 * and is printed when the rule refuses something.
 *
 *   policy "checkout-widget"
 *   may use session storage
 *   may use local storage in "src/legacy/*" until 2026-12-01  -- migrating
 *   forbid cookies                                             -- consent banner owns these
 */
import { resolveCapability, FAMILIES } from "./vocabulary.js";

export type Verb = "may" | "forbid";

export interface Rule {
  verb: Verb;
  /** Capability code or family, or "*" for everything. */
  capability: string;
  /** Path globs the rule is scoped to; empty means everywhere. */
  paths: string[];
  /** ISO date (YYYY-MM-DD) after which a `may` rule no longer grants, or null. */
  until: string | null;
  /** The trailing comment, if any. */
  hint: string;
  line: number;
  /** The rule text as written, trimmed, without its comment. */
  text: string;
}

export interface ParsedPolicy {
  file: string;
  name: string;
  rules: Rule[];
}

export class PolicyError extends Error {
  constructor(
    public readonly file: string,
    public readonly line: number,
    detail: string,
    tryInstead?: string,
  ) {
    super(`${file} line ${line}: ${detail}` + (tryInstead ? `\n  try: ${tryInstead}` : ""));
    this.name = "PolicyError";
  }
}

type Token =
  | { kind: "word"; value: string; raw: string }
  | { kind: "string"; value: string; raw: string }
  | { kind: "comma"; raw: string };

export function parsePolicy(text: string, file: string): ParsedPolicy {
  const rules: Rule[] = [];
  let name: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const [code, hint] = splitComment(lines[i]!);
    const trimmed = code.trim();
    if (trimmed === "") continue;
    const fail = (detail: string, tryInstead?: string): never => {
      throw new PolicyError(file, n, detail, tryInstead);
    };
    const tokens = tokenize(trimmed, fail);
    const first = tokens[0];
    if (first?.kind === "word" && first.value === "policy") {
      if (name !== null) fail("only one policy line is allowed");
      const nameTok = tokens[1];
      if (tokens.length !== 2 || nameTok?.kind !== "string") {
        const guess = tokens[1]?.raw ?? "name";
        fail("'policy' needs a quoted name", `policy "${guess}"`);
      }
      name = (nameTok as Extract<Token, { kind: "string" }>).value;
      continue;
    }
    rules.push(parseRule(tokens, trimmed, hint, n, fail));
  }
  return { file, name: name ?? file, rules };
}

function parseRule(tokens: Token[], text: string, hint: string, line: number, fail: (d: string, t?: string) => never): Rule {
  let pos = 0;
  const word = (): string | null => {
    const t = tokens[pos];
    return t?.kind === "word" ? t.value : null;
  };

  let verb: Verb;
  if (word() === "may" && tokens[pos + 1]?.kind === "word" && (tokens[pos + 1] as { value: string }).value === "use") {
    verb = "may";
    pos += 2;
  } else if (word() === "forbid") {
    verb = "forbid";
    pos += 1;
    if (word() === "using") pos += 1;
  } else {
    const rest = tokens.slice(1).map((t) => t.raw).join(" ");
    const guess = resolveCapability(rest) ? `may use ${rest}` : "may use storage";
    return fail(`cannot read '${text}'`, guess);
  }

  // Capability phrase: words up to `in`, `until`, or end.
  const phraseWords: string[] = [];
  while (pos < tokens.length) {
    const w = word();
    if (w === null || w === "in" || w === "until") break;
    phraseWords.push(w);
    pos++;
  }
  if (phraseWords.length === 0) fail("name a capability after the verb", `${verb === "may" ? "may use" : "forbid"} storage`);

  let capability: string;
  if (verb === "forbid" && phraseWords.join(" ") === "everything else") {
    capability = "*";
  } else {
    const phrase = phraseWords.join(" ");
    const resolved = resolveCapability(phrase);
    if (resolved === null) {
      fail(
        `unknown capability '${phrase}'`,
        `one of ${FAMILIES.join(", ")}, or a phrase such as "local storage" or "cookies"`,
      );
    }
    capability = resolved as string;
  }

  const paths: string[] = [];
  let until: string | null = null;
  while (pos < tokens.length) {
    const w = word();
    if (w === "in") {
      pos++;
      const before = paths.length;
      while (tokens[pos]?.kind === "string") {
        paths.push((tokens[pos] as Extract<Token, { kind: "string" }>).value);
        pos++;
        if (tokens[pos]?.kind === "comma") pos++;
        else break;
      }
      if (paths.length === before) fail("'in' needs one or more quoted paths", `${phraseOf(verb, phraseWords)} in "src/*"`);
    } else if (w === "until") {
      pos++;
      const t = tokens[pos];
      if (t?.kind !== "word" || !/^\d{4}-\d{2}-\d{2}$/.test(t.value)) {
        fail("'until' needs a date like 2026-12-01", `${phraseOf(verb, phraseWords)} until 2026-12-01`);
      }
      const date = (t as { value: string }).value;
      if (!isRealDate(date)) fail(`${date} is not a real date`);
      until = date;
      pos++;
    } else {
      fail(`unexpected '${tokens[pos]?.raw}' after the rule`);
    }
  }

  return { verb, capability, paths, until, hint, line, text };
}

function phraseOf(verb: Verb, words: string[]): string {
  return `${verb === "may" ? "may use" : "forbid"} ${words.join(" ")}`;
}

function isRealDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Split a line into code and trailing comment; a marker inside quotes is not a comment. */
export function splitComment(raw: string): [string, string] {
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && quoted) {
      i++;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (raw.startsWith("--", i) || ch === "#")) {
      const len = ch === "#" ? 1 : 2;
      return [raw.slice(0, i), raw.slice(i + len).trim()];
    }
  }
  return [raw, ""];
}

const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };

function tokenize(line: string, fail: (d: string, t?: string) => never): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === ",") {
      out.push({ kind: "comma", raw: "," });
      i++;
    } else if (ch === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < line.length) {
        const c = line[j]!;
        if (c === "\\") {
          const e = line[j + 1];
          if (e !== undefined && ESCAPES[e] !== undefined) {
            value += ESCAPES[e];
            j += 2;
            continue;
          }
        }
        if (c === '"') {
          closed = true;
          break;
        }
        value += c;
        j++;
      }
      if (!closed) fail("unterminated string", `${line}"`);
      out.push({ kind: "string", value, raw: line.slice(i, j + 1) });
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/[\s,"]/.test(line[j]!)) j++;
      const raw = line.slice(i, j);
      out.push({ kind: "word", value: raw.toLowerCase(), raw });
      i = j;
    }
  }
  return out;
}
