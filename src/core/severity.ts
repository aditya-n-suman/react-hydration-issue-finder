import type { Mismatch, Severity } from "./types.js";

/**
 * Classify a mismatch into an actionable severity level.
 *
 * - critical: Tag mismatches, missing children in body, React #418-type errors
 * - warning:  Text mismatches (visible content), attr mismatches on render-affecting props
 * - info:     data-* only attr diffs, whitespace/encoding text diffs, head-only mismatches
 */

/** Attributes whose mismatch is render-affecting */
const RENDER_AFFECTING_ATTRS = new Set([
  "class",
  "classname",
  "style",
  "href",
  "src",
  "srcset",
  "alt",
  "title",
  "role",
  "type",
  "value",
  "checked",
  "selected",
  "disabled",
  "hidden",
  "placeholder",
]);

function isHeadPath(path: string): boolean {
  return /^html\s*>\s*head/i.test(path);
}

function isWhitespaceOnlyDiff(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

export function classifySeverity(m: Mismatch): Severity {
  switch (m.kind) {
    case "tag":
      // Tag mismatches are always critical — React will throw
      return "critical";

    case "text": {
      if (isHeadPath(m.path)) return "info";
      // Pure whitespace/encoding differences
      if (isWhitespaceOnlyDiff(m.server, m.client)) return "info";
      return "warning";
    }

    case "attr": {
      if (isHeadPath(m.path)) return "info";
      const lower = m.attr.toLowerCase();
      // data-* only attr diffs (non-render-affecting)
      if (lower.startsWith("data-") && !RENDER_AFFECTING_ATTRS.has(lower)) return "info";
      // Render-affecting attributes
      if (RENDER_AFFECTING_ATTRS.has(lower)) return "warning";
      // aria-* mismatches
      if (lower.startsWith("aria-")) return "info";
      return "info";
    }

    case "missingChild": {
      if (isHeadPath(m.path)) return "warning";
      // Missing children in body = content not rendered = critical
      return "critical";
    }

    case "extraChild": {
      if (isHeadPath(m.path)) return "info";
      return "warning";
    }

    default:
      return "info";
  }
}
