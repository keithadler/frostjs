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
import { resolveCapability, FAMILIES, CAPABILITY_PHRASES } from "./vocabulary.js";

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

/**
 * A policy that cannot be read. The message carries file, line, the source
 * line with a caret under the column, and what to try instead.
 */
export class PolicyError extends Error {
  constructor(
    public readonly file: string,
    public readonly line: number,
    /** 1-based. */
    public readonly column: number,
    public readonly detail: string,
    public readonly source: string,
    public readonly tryInstead?: string,
  ) {
    super(
      `${file} line ${line}: ${detail}\n  ${source}\n  ${" ".repeat(Math.max(0, column - 1))}^` +
        (tryInstead ? `\n  try: ${tryInstead}` : ""),
    );
    this.name = "PolicyError";
  }
}

type Token =
  | { kind: "word"; value: string; raw: string; at: number }
  | { kind: "string"; value: string; raw: string; at: number }
  | { kind: "comma"; raw: string; at: number };

type Fail = (at: number, detail: string, tryInstead?: string) => never;

export function parsePolicy(text: string, file: string): ParsedPolicy {
  const rules: Rule[] = [];
  let name: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i]!;
    const [code, hint] = splitComment(raw);
    const trimmed = code.trim();
    if (trimmed === "") continue;
    const fail: Fail = (at, detail, tryInstead) => {
      throw new PolicyError(file, n, at + 1, detail, code.trimEnd(), tryInstead);
    };
    const tokens = tokenize(code, fail);
    const end = code.trimEnd().length;
    const first = tokens[0]!;
    if (first.kind === "word" && first.value === "policy") {
      if (name !== null) fail(first.at, "only one policy line is allowed");
      const nameTok = tokens[1];
      if (nameTok?.kind !== "string" || tokens.length !== 2) {
        const guess = nameTok?.raw ?? "name";
        fail(nameTok?.at ?? end, "'policy' needs a quoted name", `policy "${guess}"`);
      }
      name = nameTok.value;
      continue;
    }
    rules.push(parseRule(tokens, trimmed, hint, n, end, fail));
  }
  return { file, name: name ?? file, rules };
}

function parseRule(tokens: Token[], text: string, hint: string, line: number, end: number, fail: Fail): Rule {
  let pos = 0;
  const tok = (): Token | undefined => tokens[pos];
  const word = (): string | null => {
    const t = tokens[pos];
    return t?.kind === "word" ? t.value : null;
  };
  const at = (): number => tokens[pos]?.at ?? end;

  let verb: Verb;
  const second = tokens[1];
  if (word() === "may" && second?.kind === "word" && second.value === "use") {
    verb = "may";
    pos += 2;
  } else if (word() === "forbid") {
    verb = "forbid";
    pos += 1;
    if (word() === "using") pos += 1;
  } else {
    const rest = tokens.slice(1).map((t) => t.raw).join(" ");
    const guess = resolveCapability(rest) ? `may use ${rest}` : "may use storage";
    return fail(tokens[0]!.at, `cannot read '${text}'`, guess);
  }
  const verbText = verb === "may" ? "may use" : "forbid";

  // Capability phrase: words up to `in`, `until`, or end.
  const phraseAt = at();
  const phraseWords: string[] = [];
  while (pos < tokens.length) {
    const w = word();
    if (w === null || w === "in" || w === "until") break;
    phraseWords.push(w);
    pos++;
  }
  if (phraseWords.length === 0) fail(phraseAt, "name a capability after the verb", `${verbText} storage`);
  const phrase = phraseWords.join(" ");

  let capability: string;
  if (verb === "forbid" && phrase === "everything else") {
    capability = "*";
  } else {
    const resolved = resolveCapability(phrase);
    if (resolved === null) {
      const near = nearest(phrase);
      fail(
        phraseAt,
        `unknown capability '${phrase}'` + (near ? `; did you mean '${near}'?` : ""),
        near ? `${verbText} ${near}` : `one of ${FAMILIES.join(", ")}, or a phrase such as "local storage" or "cookies"`,
      );
    }
    capability = resolved;
  }

  const paths: string[] = [];
  let sawIn = false;
  let until: string | null = null;
  while (pos < tokens.length) {
    const w = word();
    if (w === "in") {
      if (sawIn) fail(at(), "'in' given twice; list every path after one 'in', separated by commas", `${verbText} ${phrase} in "a/*", "b/*"`);
      sawIn = true;
      pos++;
      if (tok()?.kind !== "string") fail(at(), "'in' needs one or more quoted paths", `${verbText} ${phrase} in "src/*"`);
      for (;;) {
        const t = tok();
        if (t?.kind !== "string") fail(at(), "expected another quoted path after the comma", `${verbText} ${phrase} in "src/*"`);
        if (t.value === "") fail(t.at, "empty path; name a file or a glob", `${verbText} ${phrase} in "src/*"`);
        if (t.value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(t.value)) {
          fail(t.at, "paths are relative to the policy file, not absolute", `${verbText} ${phrase} in "src/*"`);
        }
        paths.push(t.value);
        pos++;
        if (tok()?.kind === "comma") pos++;
        else break;
      }
    } else if (w === "until") {
      if (verb === "forbid") fail(at(), "'until' only applies to 'may' rules; a forbid does not expire", `forbid ${phrase}`);
      if (until !== null) fail(at(), "'until' given twice", `${verbText} ${phrase} until 2026-12-01`);
      pos++;
      const t = tok();
      if (t?.kind !== "word" || !/^\d{4}-\d{2}-\d{2}$/.test(t.value)) {
        fail(at(), "'until' needs a date like 2026-12-01", `${verbText} ${phrase} until 2026-12-01`);
      }
      if (!isRealDate(t.value)) fail(t.at, `${t.value} is not a real date`);
      until = t.value;
      pos++;
    } else {
      fail(at(), `unexpected '${tok()?.raw}' after the rule`);
    }
  }

  return { verb, capability, paths, until, hint, line, text };
}

/** The closest known phrase or code, or null if nothing is within editing distance. */
function nearest(phrase: string): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of CAPABILITY_PHRASES.keys()) {
    const d = levenshtein(phrase, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  for (const candidate of new Set(CAPABILITY_PHRASES.values())) {
    if (candidate === "*") continue;
    const d = levenshtein(phrase, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  // Allow roughly a third of the phrase to be wrong, never more than three edits.
  const limit = Math.min(3, Math.max(1, Math.floor(phrase.length / 3)));
  return bestDist <= limit ? best : null;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
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

function tokenize(line: string, fail: Fail): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === ",") {
      out.push({ kind: "comma", raw: ",", at: i });
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
      if (!closed) fail(i, "unterminated string", `${line.trim()}"`);
      out.push({ kind: "string", value, raw: line.slice(i, j + 1), at: i });
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/[\s,"]/.test(line[j]!)) j++;
      const raw = line.slice(i, j);
      out.push({ kind: "word", value: raw.toLowerCase(), raw, at: i });
      i = j;
    }
  }
  return out;
}
