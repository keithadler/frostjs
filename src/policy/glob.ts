/**
 * Path globs for policy scoping. Deliberately small: `*` within a segment,
 * `**` across segments, `?` one character. Patterns and paths are compared
 * with forward slashes. A pattern with no slash matches the basename at any
 * depth (gitignore style); a plain path with no glob characters also
 * matches everything beneath it, so `in "src/legacy"` reads naturally.
 */

const cache = new Map<string, RegExp>();

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `file` (a path relative to the policy directory) matches the glob. */
export function matchesGlob(pattern: string, file: string): boolean {
  const pat = normalize(pattern);
  const path = normalize(file);
  let rx = cache.get(pat);
  if (!rx) {
    rx = toRegExp(pat);
    cache.set(pat, rx);
  }
  return rx.test(path);
}

function normalize(p: string): string {
  let s = p.replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  return s.replace(/\/+$/, "");
}

function toRegExp(pat: string): RegExp {
  const hasGlob = /[*?]/.test(pat);
  const anyDepth = !pat.includes("/");
  let out = "";
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i]!;
    if (ch === "*") {
      if (pat[i + 1] === "*") {
        // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
        if (pat[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(ch);
    }
  }
  const prefix = anyDepth ? "^(?:.*/)?" : "^";
  const suffix = hasGlob ? "$" : "(?:/.*)?$";
  return new RegExp(prefix + out + suffix);
}
