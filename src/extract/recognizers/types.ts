import type { Node } from "../ast.js";
import type { Visit } from "../walk.js";
import type { Confidence } from "../capability.js";

export interface Match {
  capability: string;
  target: string | null;
  confidence: Confidence;
  /** The node the match is anchored on; the reported expression grows outward from here. */
  node: Node;
  /** The global name the match rests on (e.g. "localStorage", "window"). If the file declares it, confidence drops. */
  via: string;
}

export type Recognizer = (v: Visit) => Match | null;
