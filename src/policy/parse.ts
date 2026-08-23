/**
 * Parser for frostjs's policy files, written in frost's policy dialect:
 * line-oriented, one rule per line, `--` or `#` comments, case-insensitive
 * keywords, double-quoted strings. A trailing comment on a rule is its hint
 * and is printed when the rule refuses something.
 *
 *   policy "checkout-widget"
 *   ignore "public/*.min.js"
 *   vendored "vendor/**"
 *   may reach "api.example.com", "cdn.example.com"
 *   may use session storage
 *   may use local storage in "src/legacy/*" until 2026-12-01  -- migrating
 *   forbid cookies                                             -- consent banner owns these
 *   forbid reaching "*.telemetry.example"
 *   forbid everything else
 */
import { resolveCapability, FAMILIES, CAPABILITY_PHRASES } from "./vocabulary.js";
import { SAME_ORIGIN } from "../extract/target.js";

export type Verb = "may" | "forbid";

export interface Rule {
  verb: Verb;
  /** Capability code or family, or "*" for everything. */
  capability: string;
  /** For `may reach` / `forbid reaching`: host patterns. Empty means any destination. */
  hosts: string[];
  /** Path globs the rule is scoped to; empty means everywhere. */
  paths: string[];
  /** ISO date (YYYY-MM-DD) after which a `may` rule no longer grants, or null. */
  until: string | null;
  /** The trailing comment, if any. */
  hint: string;
  /** 1-based line in the policy file, for reports. */
  line: number;
  /** The rule text as written, trimmed, without its comment. */
  text: string;
}

export interface ParsedPolicy {
  file: string;
  name: string;
  rules: Rule[];
  /** Globs, relative to the policy directory, of third-party files checked by fingerprint rather than analyzed. */
  vendored: string[];
  /** True when the policy asks frostjs check to gate on taint flows (`forbid tainted flows`). */
  taint: boolean;
  /** Globs, relative to the policy directory, of files not analyzed at all (generated bundles, fixtures). */
  ignore: string[];
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

/** A position in one line's tokens. */
class Cursor {
  pos = 0;
  constructor(
    readonly tokens: Token[],
    /** Offset of the end of the code on this line, for errors about something missing. */
    readonly end: number,
    readonly fail: Fail,
  ) {}
  tok(): Token | undefined {
    return this.tokens[this.pos];
  }
  word(offset = 0): string | null {
    const t = this.tokens[this.pos + offset];
    return t?.kind === "word" ? t.value : null;
  }
  at(): number {
    return this.tokens[this.pos]?.at ?? this.end;
  }
  done(): boolean {
    return this.pos >= this.tokens.length;
  }
}

/**
 * Parse a policy file's text. Throws PolicyError at the first line that
 * cannot be read; `file` is used only in messages.
 */
export function parsePolicy(text: string, file: string): ParsedPolicy {
  const rules: Rule[] = [];
  const vendored: string[] = [];
  const ignore: string[] = [];
  let taint = false;
  let name: string | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const [code, hint] = splitComment(lines[i]!);
    const trimmed = code.trim();
    if (trimmed === "") continue;
    const fail: Fail = (at, detail, tryInstead) => {
      throw new PolicyError(file, n, at + 1, detail, code.trimEnd(), tryInstead);
    };
    const c = new Cursor(tokenize(code, fail), code.trimEnd().length, fail);
    const first = c.tok()!;
    if (c.word() === "policy") {
      if (name !== null) fail(first.at, "only one policy line is allowed");
      const nameTok = c.tokens[1];
      if (nameTok?.kind !== "string" || c.tokens.length !== 2) {
        fail(nameTok?.at ?? c.end, "'policy' needs a quoted name", `policy "${nameTok?.raw ?? "name"}"`);
      }
      name = nameTok.value;
      continue;
    }
    // `forbid tainted flows`: turn on the taint gate from the policy itself.
    if (c.word() === "forbid" && c.word(1) === "tainted") {
      const third = c.word(2);
      if ((third !== "flows" && third !== "flow" && third !== "input") || c.tokens.length !== 3) {
        fail(c.tokens[1]!.at, "did you mean 'forbid tainted flows'?", "forbid tainted flows");
      }
      taint = true;
      continue;
    }
    const pathList = c.word() === "vendored" ? vendored : c.word() === "ignore" ? ignore : null;
    if (pathList !== null) {
      const keyword = c.word()!;
      const example = keyword === "vendored" ? 'vendored "vendor/**"' : 'ignore "public/*.min.js"';
      c.pos = 1;
      if (c.tok()?.kind !== "string") fail(c.at(), `'${keyword}' needs one or more quoted paths`, example);
      pathList.push(...quotedList(c, "path", example, checkPath(example)));
      if (!c.done()) fail(c.at(), `unexpected '${c.tok()!.raw}' after the paths`);
      continue;
    }
    rules.push(parseRule(c, trimmed, hint, n));
  }
  return { file, name: name ?? file, rules, vendored, ignore, taint };
}

/** The verb forms a rule may start with, longest first so `forbid using` beats `forbid`. */
const FORMS: readonly { words: readonly string[]; verb: Verb; reach: boolean; text: string }[] = [
  { words: ["may", "use"], verb: "may", reach: false, text: "may use" },
  { words: ["may", "reach"], verb: "may", reach: true, text: "may reach" },
  { words: ["forbid", "reaching"], verb: "forbid", reach: true, text: "forbid reaching" },
  { words: ["forbid", "using"], verb: "forbid", reach: false, text: "forbid" },
  { words: ["forbid"], verb: "forbid", reach: false, text: "forbid" },
];

function parseRule(c: Cursor, text: string, hint: string, line: number): Rule {
  const form = FORMS.find((f) => f.words.every((w, i) => c.word(i) === w));
  if (!form) {
    const rest = c.tokens
      .slice(1)
      .map((t) => t.raw)
      .join(" ");
    c.fail(c.tokens[0]!.at, `cannot read '${text}'`, resolveCapability(rest) ? `may use ${rest}` : "may use storage");
  }
  c.pos = form.words.length;
  const { verb, text: verbText } = form;

  const { capability, phrase, hosts } = form.reach ? parseHosts(c, verbText) : parseCapability(c, verb, verbText);

  const paths: string[] = [];
  let until: string | null = null;
  while (!c.done()) {
    const w = c.word();
    if (w === "in") {
      if (paths.length > 0) {
        c.fail(
          c.at(),
          "'in' given twice; list every path after one 'in', separated by commas",
          `${verbText} ${phrase} in "a/*", "b/*"`,
        );
      }
      c.pos++;
      const example = `${verbText} ${phrase} in "src/*"`;
      if (c.tok()?.kind !== "string") c.fail(c.at(), "'in' needs one or more quoted paths", example);
      paths.push(...quotedList(c, "path", example, checkPath(example)));
    } else if (w === "until") {
      if (verb === "forbid") {
        c.fail(c.at(), "'until' only applies to 'may' rules; a forbid does not expire", `forbid ${phrase}`);
      }
      if (until !== null) c.fail(c.at(), "'until' given twice", `${verbText} ${phrase} until 2026-12-01`);
      c.pos++;
      const t = c.tok();
      if (t?.kind !== "word" || !/^\d{4}-\d{2}-\d{2}$/.test(t.value)) {
        c.fail(c.at(), "'until' needs a date like 2026-12-01", `${verbText} ${phrase} until 2026-12-01`);
      }
      if (!isRealDate(t.value)) c.fail(t.at, `${t.value} is not a real date`);
      until = t.value;
      c.pos++;
    } else {
      c.fail(c.at(), `unexpected '${c.tok()?.raw}' after the rule`);
    }
  }

  return { verb, capability, hosts, paths, until, hint, line, text };
}

interface Head {
  capability: string;
  /** How the rule names what it covers, for use in `try:` suggestions. */
  phrase: string;
  hosts: string[];
}

/** `may reach "host", ...` and `forbid reaching "host", ...`. */
function parseHosts(c: Cursor, verbText: string): Head {
  const example = `${verbText} "api.example.com"`;
  const t0 = c.tok();
  if (t0?.kind !== "string") {
    const guess = t0?.kind === "word" ? t0.raw : "api.example.com";
    c.fail(c.at(), `'${verbText}' needs one or more quoted hosts`, `${verbText} "${guess}"`);
  }
  const hosts = quotedList(c, "host", example, (host, at) => {
    if (/[/:?#]/.test(host)) {
      const m = /^(?:[a-z][a-z0-9+.-]*:)?\/\/(?:[^/@]*@)?([^/:?#]+)/i.exec(host);
      c.fail(at, "name a host, not a URL", `${verbText} "${m?.[1] ?? "api.example.com"}"`);
    }
    return host.toLowerCase();
  });
  return { capability: "network", phrase: hosts.map((h) => `"${h}"`).join(", "), hosts };
}

/** `may use <capability>` and `forbid [using] <capability>`: words up to `in`, `until` or the end. */
function parseCapability(c: Cursor, verb: Verb, verbText: string): Head {
  const phraseAt = c.at();
  const words: string[] = [];
  for (let w = c.word(); w !== null && w !== "in" && w !== "until"; w = c.word()) {
    words.push(w);
    c.pos++;
  }
  if (words.length === 0) c.fail(phraseAt, "name a capability after the verb", `${verbText} storage`);
  const phrase = words.join(" ");
  if (verb === "forbid" && phrase === "everything else") return { capability: "*", phrase, hosts: [] };

  const capability = resolveCapability(phrase);
  if (capability === null) {
    const near = nearest(phrase);
    c.fail(
      phraseAt,
      `unknown capability '${phrase}'` + (near ? `; did you mean '${near}'?` : ""),
      near ? `${verbText} ${near}` : `one of ${FAMILIES.join(", ")}, or a phrase such as "local storage" or "cookies"`,
    );
  }
  return { capability, phrase, hosts: [] };
}

/** Validator for a path in `in` or `vendored`: relative, never absolute. */
function checkPath(example: string): (value: string, at: number, c: Cursor) => string {
  return (value, at, c) => {
    if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) {
      c.fail(at, "paths are relative to the policy file, not absolute", example);
    }
    return value;
  };
}

/**
 * A comma-separated list of quoted strings starting at the cursor. The
 * caller has already checked that the first token is a string, so the
 * "needs one or more" message stays the caller's.
 */
function quotedList(
  c: Cursor,
  what: "host" | "path",
  example: string,
  check: (value: string, at: number, c: Cursor) => string,
): string[] {
  const out: string[] = [];
  for (;;) {
    const t = c.tok();
    if (t?.kind !== "string") c.fail(c.at(), `expected another quoted ${what} after the comma`, example);
    const value = what === "host" ? t.value.trim() : t.value;
    if (value === "") c.fail(t.at, what === "host" ? "empty host" : "empty path; name a file or a glob", example);
    out.push(value === SAME_ORIGIN ? value : check(value, t.at, c));
    c.pos++;
    if (c.tok()?.kind === "comma") c.pos++;
    else break;
  }
  return out;
}

/** The closest known phrase or code, or null if nothing is within editing distance. */
function nearest(phrase: string): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const candidates = [...CAPABILITY_PHRASES.keys(), ...new Set(CAPABILITY_PHRASES.values())];
  for (const candidate of candidates) {
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

/** Year, month (0-based) and day of a validated YYYY-MM-DD string. */
export function ymd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return [y, m - 1, d];
}

function isRealDate(s: string): boolean {
  const [y, m, d] = ymd(s);
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d;
}

/** Split a line into code and trailing comment; a marker inside quotes is not a comment. */
function splitComment(raw: string): [string, string] {
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
        const inner = line[j]!;
        if (inner === "\\") {
          const e = line[j + 1];
          if (e !== undefined && ESCAPES[e] !== undefined) {
            value += ESCAPES[e];
            j += 2;
            continue;
          }
        }
        if (inner === '"') {
          closed = true;
          break;
        }
        value += inner;
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
