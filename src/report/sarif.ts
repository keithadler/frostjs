/**
 * SARIF 2.1.0 for code scanning. One rule per capability code seen. Denied
 * uses are errors, unknown uses are warnings, baselined uses are errors
 * marked baselineState "unchanged", suppressed uses carry an in-source
 * suppression. Uses the policy did not flag are not results.
 */
import type { Decision, Verdict } from "../policy/index.js";
import { createHash } from "node:crypto";
import { denialMessage, describeUse } from "./text.js";
import { baselineKey } from "../baseline.js";
import { VERSION } from "../version.js";

const LEVEL: Record<Exclude<Verdict, "allowed">, "error" | "warning" | "note"> = {
  denied: "error",
  unknown: "warning",
  baselined: "error",
  unchanged: "note",
  suppressed: "note",
};

/** `--format sarif`: a SARIF 2.1.0 log with one rule per capability code seen. */
export function sarif(decisions: readonly Decision[]): string {
  const reported = decisions.filter((d) => d.verdict !== "allowed");
  const ruleIds = [...new Set(reported.map((d) => d.use.capability))].sort();
  const rules = ruleIds.map((id) => ({
    id,
    name: id.replace(/[.-](\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase()),
    shortDescription: { text: `Use of the ${id} capability` },
    helpUri: "https://github.com/keithadler/frostjs#capabilities-recognized-so-far",
  }));
  const results = reported.map((d) => {
    const carried = d.verdict === "baselined" || d.verdict === "unchanged";
    const subject = describeUse(d.use.capability, d.use.target);
    const message =
      d.verdict === "denied" || carried ? denialMessage(d) : `${subject} ${d.use.confidence}: ${d.use.expression}`;
    const r: Record<string, unknown> = {
      ruleId: d.use.capability,
      ruleIndex: ruleIds.indexOf(d.use.capability),
      level: LEVEL[d.verdict as Exclude<Verdict, "allowed">],
      message: { text: message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: d.use.file.replace(/\\/g, "/"), uriBaseId: "%SRCROOT%" },
            region: { startLine: d.use.line, startColumn: d.use.column },
          },
        },
      ],
      properties: { confidence: d.use.confidence, target: d.use.target, verdict: d.verdict },
      // A stable key over (file, capability, expression), not the line, so
      // code scanning tracks a finding across commits when it moves lines.
      partialFingerprints: {
        "frostjs/v1": createHash("sha256")
          .update(baselineKey(d.use.file, d.use.capability, d.use.expression))
          .digest("hex")
          .slice(0, 16),
      },
    };
    if (carried) r["baselineState"] = "unchanged";
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
            name: "frostjs",
            version: VERSION,
            informationUri: "https://github.com/keithadler/frostjs",
            rules,
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(log, null, 2) + "\n";
}
