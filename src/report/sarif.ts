/**
 * SARIF 2.1.0 for code scanning. One rule per capability code seen. Denied
 * uses are errors, unknown uses are warnings, baselined uses are errors
 * marked baselineState "unchanged", suppressed uses carry an in-source
 * suppression. Uses the policy did not flag are not results.
 */
import type { Decision } from "../policy/index.js";
import { denialText } from "./text.js";
import { VERSION } from "../version.js";

const LEVEL: Record<string, "error" | "warning" | "note"> = {
  denied: "error",
  unknown: "warning",
  baselined: "error",
  unchanged: "note",
  suppressed: "note",
};

export function sarif(decisions: readonly Decision[]): string {
  const reported = decisions.filter((d) => d.verdict !== "allowed");
  const ruleIds = [...new Set(reported.map((d) => d.use.capability))].sort();
  const rules = ruleIds.map((id) => ({
    id,
    name: id.replace(/[.-](\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase()),
    shortDescription: { text: `Use of the ${id} capability` },
    helpUri: "https://github.com/keithadler/permit#capabilities-recognized-so-far",
  }));
  const results = reported.map((d) => {
    const message =
      d.verdict === "denied" || d.verdict === "baselined" || d.verdict === "unchanged"
        ? `${d.use.capability} ${denialText(d)}: ${d.use.expression}`
        : `${d.use.capability} ${d.use.confidence}: ${d.use.expression}`;
    const r: Record<string, unknown> = {
      ruleId: d.use.capability,
      ruleIndex: ruleIds.indexOf(d.use.capability),
      level: LEVEL[d.verdict] ?? "note",
      message: { text: message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: d.use.file.split("\\").join("/"), uriBaseId: "%SRCROOT%" },
            region: { startLine: d.use.line, startColumn: d.use.column },
          },
        },
      ],
      properties: { confidence: d.use.confidence, target: d.use.target, verdict: d.verdict },
    };
    if (d.verdict === "baselined" || d.verdict === "unchanged") r["baselineState"] = "unchanged";
    if (d.verdict === "suppressed") r["suppressions"] = [{ kind: "inSource" }];
    return r;
  });
  const log = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "permit",
            version: VERSION,
            informationUri: "https://github.com/keithadler/permit",
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(log, null, 2) + "\n";
}
