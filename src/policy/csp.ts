/**
 * Derive a Content-Security-Policy header from a compiled policy. CSP is
 * the runtime backstop; this is the build-time gate. Only directives the
 * policy actually determines are emitted:
 *
 *   connect-src  from `may reach` hosts; `may use the network` means *;
 *                nothing granted means 'none'
 *   script-src   'self', plus 'unsafe-eval' when code generation is granted,
 *                plus any `may reach` hosts when dynamic import is granted
 *   worker-src   'self' plus `may reach` hosts when workers are granted
 *
 * Path-scoped grants still count: a header covers the whole page. Expired
 * grants do not. Forbids narrow nothing here, since CSP cannot express
 * "everything except"; the build-time gate enforces those.
 */
import type { Policy } from "./compile.js";
import { matchesCapability } from "./compile.js";
import type { Rule } from "./parse.js";

function live(policy: Policy, today: string): Rule[] {
  return policy.rules.filter((r) => r.verb === "may" && (r.until === null || r.until >= today));
}

function grants(rules: readonly Rule[], capability: string): Rule[] {
  return rules.filter((r) => matchesCapability(r.capability, capability) || r.capability === "*");
}

function hostSource(h: string): string {
  return h === "same-origin" ? "'self'" : h;
}

export function csp(policy: Policy, today: string): string {
  const rules = live(policy, today);
  const directives: string[] = [];

  // connect-src
  const net = grants(rules, "network.fetch");
  const anyDestination = net.some((r) => r.hosts.length === 0);
  const hosts = [...new Set(net.flatMap((r) => r.hosts.map(hostSource)))];
  if (anyDestination) directives.push("connect-src *");
  else if (hosts.length > 0) directives.push(`connect-src ${hosts.join(" ")}`);
  else directives.push("connect-src 'none'");

  // script-src
  const script = ["'self'"];
  if (grants(rules, "codegen.eval").length > 0 || grants(rules, "codegen.function").length > 0)
    script.push("'unsafe-eval'");
  if (grants(rules, "network.import").length > 0) {
    if (anyDestination) script.push("*");
    else for (const h of hosts) if (!script.includes(h)) script.push(h);
  }
  directives.push(`script-src ${script.join(" ")}`);

  // worker-src
  if (grants(rules, "worker.dedicated").length > 0 || grants(rules, "worker.service").length > 0) {
    const w = ["'self'"];
    if (anyDestination) w.push("*");
    else for (const h of hosts) if (!w.includes(h)) w.push(h);
    directives.push(`worker-src ${w.join(" ")}`);
  }

  return directives.join("; ");
}
