/** Structural diff kinds aligned with React hydration semantics */
export type MismatchKind =
  | "tag"
  | "text"
  | "attr"
  | "missingChild"
  | "extraChild";

/** Severity classification for actionable triage */
export type Severity = "critical" | "warning" | "info";

export type Mismatch =
  | { kind: "tag"; path: string; server: string; client: string; selector: string; componentHint?: string; severity: Severity }
  | { kind: "text"; path: string; server: string; client: string; selector: string; componentHint?: string; severity: Severity }
  | { kind: "attr"; path: string; attr: string; server: string | null; client: string | null; selector: string; componentHint?: string; severity: Severity }
  | { kind: "missingChild"; path: string; expected: string; selector: string; componentHint?: string; severity: Severity }
  | { kind: "extraChild"; path: string; found: string; selector: string; componentHint?: string; severity: Severity };

/** Guessed mapping from a DOM node to a React component / source file */
export type ComponentMapping = {
  /** CSS selector for the closest identifiable ancestor component */
  selector: string;
  /** Guessed React component name from data attributes, class names, or id */
  componentHint?: string;
  /** Source file path (when a source-map enricher is configured) */
  sourceFile?: string;
};

export type ReactHydrationError = {
  source: "console" | "pageerror";
  level?: string;
  message: string;
  stack?: string;
};

export type ReportSummary = {
  tagMismatches: number;
  textMismatches: number;
  attrMismatches: number;
  missingChildren: number;
  extraChildren: number;
  reactErrorCount: number;
};

export type Report = {
  url: string;
  fetchedAt: string;
  serverStatus: number;
  reactErrors: ReactHydrationError[];
  mismatches: Mismatch[];
  /** Mismatches grouped by componentHint (or "Unknown" fallback) */
  groupedMismatches: Record<string, Mismatch[]>;
  summary: ReportSummary;
  /** How the post-hydration snapshot was obtained and which subtree was diffed */
  hydration: HydrationInfo;
  raw: { serverHtml: string; clientHtml: string };
};

export type HydrationInfo = {
  /**
   * "react-commit": snapshot taken synchronously at React's hydration commit (precise).
   * "fallback": React never reported a hydration commit; snapshot taken after load + idle.
   */
  method: "react-commit" | "fallback";
  reactVersion?: string;
  reactBuild?: "production" | "development";
  /** Hydration root(s) the diff was scoped to (CSS selectors), or ["html"] for the whole document */
  roots: string[];
  /** ms from navigation start to the first hydration commit */
  hydratedAtMs?: number;
};

/** A hydrated React root and the DOM serialized at its hydration commit */
export type HydratedRoot = {
  selector: string;
  /** Diff-path of the container, e.g. "html > body[0] > div[0]" */
  path: string;
  html: string;
  at: number;
};

export type FetchServerResult = {
  status: number;
  html: string;
  finalUrl: string;
};

export type FetchClientResult = {
  /** Snapshot of the whole document: at the first hydration commit, or settled (fallback) */
  html: string;
  finalUrl: string;
  reactErrors: ReactHydrationError[];
  roots: HydratedRoot[];
  reactVersion?: string;
  reactBuild?: "production" | "development";
};

export type CompareOptions = {
  /** Max time for navigation + hydration wait (ms) */
  timeoutMs?: number;
  /** Extra HTTP headers for both server fetch and browser */
  headers?: Record<string, string>;
  /** Cookie header value */
  cookie?: string;
  /** User-Agent override */
  userAgent?: string;
  /** CSS selectors whose subtrees are stripped before diff (user-defined) */
  ignoreSelectors?: string[];
};
