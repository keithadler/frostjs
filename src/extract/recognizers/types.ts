import type { Node } from "../ast.js";
import type { Visit } from "../walk.js";
import type { Confidence } from "../capability.js";

export interface Match {
  capability: string;
  target: string | null;
  confidence: Confidence;
  /** The node the match is anchored on; the reported expression grows outward from here. */
  node: Node;
  /** The identifier the match rests on (`localStorage`, `window`...), or null if none. A local binding of it means no match. */
  via: Node | null;
}

export type Recognizer = (v: Visit) => Match | null;
