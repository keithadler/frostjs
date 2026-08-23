/** How sure the extractor is that this use is real. See REQUIREMENTS 6.1. */
export type Confidence = "certain" | "probable" | "possible";

export type Origin = "first-party" | "vendored" | "inline-html";

export interface CapabilityUse {
  /** Stable code, e.g. "storage.local", "network.fetch". */
  capability: string;
  /** Resolved URL or host if statically knowable, else null. */
  target: string | null;
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** Source text of the enclosing expression. */
  expression: string;
  confidence: Confidence;
  origin: Origin;
}
