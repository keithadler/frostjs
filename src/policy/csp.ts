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
import { isExpired, matchesCapability, type Policy } from "./compile.js";
import { SAME_ORIGIN } from "../extract/target.js";

/** The Content-Security-Policy header string the policy implies, for the date it was compiled against. */
export function csp(policy: Policy): string {
  const rules = policy.rules.filter((r) => r.verb === "may" && !isExpired(r, policy.today));
  const granted = (capability: string): boolean => rules.some((r) => matchesCapability(r.capability, capability));
  const directives: string[] = [];

  // connect-src
  const net = rules.filter((r) => matchesCapability(r.capability, "network.fetch"));
  const anyDestination = net.some((r) => r.hosts.length === 0);
  const hosts = [...new Set(net.flatMap((r) => r.hosts.map((h) => (h === SAME_ORIGIN ? "'self'" : h))))];
  if (anyDestination) directives.push("connect-src *");
  else if (hosts.length > 0) directives.push(`connect-src ${hosts.join(" ")}`);
  else directives.push("connect-src 'none'");

  /** 'self' plus every reachable host, or * when any destination is granted. */
  const selfAndHosts = (): string =>
    ["'self'", ...(anyDestination ? ["*"] : hosts.filter((h) => h !== "'self'"))].join(" ");

  // script-src
  let script = "'self'";
  if (granted("codegen.eval") || granted("codegen.function")) script += " 'unsafe-eval'";
  if (granted("network.import")) script += selfAndHosts().slice("'self'".length);
  directives.push(`script-src ${script}`);

  // worker-src
  if (granted("worker.dedicated") || granted("worker.service")) directives.push(`worker-src ${selfAndHosts()}`);

  return directives.join("; ");
}
