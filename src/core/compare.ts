import { domDiff } from "./domDiff.js";
import { fetchClient } from "./fetchClient.js";
import { fetchServer } from "./fetchServer.js";
import { buildSelector } from "./selectorBuilder.js";
import { extractComponentHint, SHIKSHA_COMPONENT_MAP } from "./componentHint.js";
import { classifySeverity } from "./severity.js";
import type { CompareOptions, Mismatch, Report, ReportSummary } from "./types.js";

function summarize(mismatches: Mismatch[], reactErrorCount: number): ReportSummary {
  let tagMismatches = 0;
  let textMismatches = 0;
  let attrMismatches = 0;
  let missingChildren = 0;
  let extraChildren = 0;
  for (const m of mismatches) {
    switch (m.kind) {
      case "tag":
        tagMismatches++;
        break;
      case "text":
        textMismatches++;
        break;
      case "attr":
        attrMismatches++;
        break;
      case "missingChild":
        missingChildren++;
        break;
      case "extraChild":
        extraChildren++;
        break;
      default:
        break;
    }
  }
  return {
    tagMismatches,
    textMismatches,
    attrMismatches,
    missingChildren,
    extraChildren,
    reactErrorCount,
  };
}

/** Group mismatches by their componentHint (or "Unknown") */
function groupByComponent(mismatches: Mismatch[]): Record<string, Mismatch[]> {
  const groups: Record<string, Mismatch[]> = {};
  for (const m of mismatches) {
    const key = m.componentHint || "Unknown";
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(m);
  }
  return groups;
}

/**
 * Fetch server HTML + hydrated client DOM, diff for hydration-relevant mismatches,
 * enrich with CSS selectors + component hints + severity, and attach React console/pageerror messages.
 */
export async function compare(url: string, options: CompareOptions = {}): Promise<Report> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const headers = options.headers ?? {};
  const ignoreSelectors = options.ignoreSelectors ?? [];

  const [serverRes, clientRes] = await Promise.all([
    fetchServer(url, {
      headers,
      cookie: options.cookie,
      userAgent: options.userAgent,
      timeoutMs,
    }),
    fetchClient(url, {
      headers,
      cookie: options.cookie,
      userAgent: options.userAgent,
      timeoutMs,
      ignoreSelectors,
    }),
  ]);

  const { mismatches, serverDoc } = domDiff(serverRes.html, clientRes.html);

  // ── Enrichment pipeline ──

  // 1. Build browser-ready CSS selectors
  for (const m of mismatches) {
    m.selector = buildSelector(serverDoc, m.path);
  }

  // 2. Extract component hints (walk ancestors for data-module, id, class patterns)
  for (const m of mismatches) {
    const hint = extractComponentHint(serverDoc, m.path, SHIKSHA_COMPONENT_MAP);
    if (hint.componentHint) {
      m.componentHint = hint.componentHint;
    }
  }

  // 3. Classify severity (critical / warning / info)
  for (const m of mismatches) {
    m.severity = classifySeverity(m);
  }

  // 4. Group by component
  const groupedMismatches = groupByComponent(mismatches);

  const reactErrors = clientRes.reactErrors;
  const summary = summarize(mismatches, reactErrors.length);

  return {
    url: clientRes.finalUrl || serverRes.finalUrl,
    fetchedAt: new Date().toISOString(),
    serverStatus: serverRes.status,
    reactErrors,
    mismatches,
    groupedMismatches,
    summary,
    raw: {
      serverHtml: serverRes.html,
      clientHtml: clientRes.html,
    },
  };
}

export function reportHasIssues(report: Report): boolean {
  if (report.reactErrors.length > 0) return true;
  if (report.mismatches.length > 0) return true;
  return false;
}

