/**
 * Regression guard for the lottie-web showcase (showcase/lottie/README.md).
 *
 * lottie-web's default build evaluates animation-embedded expression strings
 * with `eval`, on by default (`runExpressions`), reproducing the shape of the
 * ExpressionManager sink at lottie.js:14422 in 5.13.0. This is a public,
 * exploited-in-the-wild eval-of-untrusted-data path; the point of the test is
 * that frostjs flags it as `codegen.eval` and does not quietly stop doing so.
 */
import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

// The ExpressionManager sink, reduced to the construct frostjs sees. `val` is
// `data.x`, the expression field lifted straight out of the animation JSON.
const EXPRESSION_MANAGER = `
function initiateExpression(elem, data, property) {
  // Bail out if we don't want expressions
  if (!elem.globalData.renderConfig.runExpressions) {
    return function noOp(v) { return v; };
  }
  var val = data.x;
  var expression_function = eval('[function _expression_function(){' + val + ';scoped_bm_rt=$bm_rt}]')[0];
  return expression_function;
}
`;

describe("showcase: lottie-web expression eval", () => {
  it("flags the animation-fed eval as codegen.eval", () => {
    const uses = extract(parseSource("ExpressionManager.js", EXPRESSION_MANAGER));
    const evals = uses.filter((u) => u.capability === "codegen.eval");
    expect(evals).toHaveLength(1);
    expect(evals[0]).toMatchObject({ capability: "codegen.eval", confidence: "certain" });
    expect(evals[0]!.expression).toContain("_expression_function");
  });

  it("does not invent findings in the surrounding expression plumbing", () => {
    // The noOp guard, the property plumbing and the string concatenation are
    // ordinary code; only the eval is a capability. A regression that starts
    // flagging the guard or the concat would be a false positive.
    const caps = extract(parseSource("ExpressionManager.js", EXPRESSION_MANAGER)).map((u) => u.capability);
    expect(caps).toEqual(["codegen.eval"]);
  });
});
