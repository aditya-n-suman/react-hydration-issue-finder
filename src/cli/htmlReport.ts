import type { Mismatch, Report, Severity } from "../core/types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function severityBadge(s: Severity): string {
  const colors: Record<Severity, string> = {
    critical: "#f85149",
    warning: "#d29922",
    info: "#58a6ff",
  };
  return `<span style="background:${colors[s]}22;color:${colors[s]};padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600">${esc(s.toUpperCase())}</span>`;
}

function mismatchDetail(m: Mismatch): string {
  if (m.kind === "tag") return `server: <code>${esc(m.server)}</code><br/>client: <code>${esc(m.client)}</code>`;
  if (m.kind === "text") return `server: <code>${esc(m.server)}</code><br/>client: <code>${esc(m.client)}</code>`;
  if (m.kind === "attr")
    return `<code>${esc(m.attr)}</code><br/>server: <code>${esc(String(m.server ?? "(none)"))}</code><br/>client: <code>${esc(String(m.client ?? "(none)"))}</code>`;
  if (m.kind === "missingChild") return `expected: <code>${esc(m.expected)}</code>`;
  if (m.kind === "extraChild") return `found: <code>${esc(m.found)}</code>`;
  return "";
}

export function renderHtmlReport(report: Report): string {
  const { summary, mismatches, reactErrors, raw, url, fetchedAt, serverStatus, groupedMismatches } = report;
  const reportJson = esc(JSON.stringify(report, null, 2));

  // Grouped mismatch sections
  const groupedSections = Object.entries(groupedMismatches)
    .map(([component, items]) => {
      const criticalCount = items.filter((m) => m.severity === "critical").length;
      const headerColor = criticalCount > 0 ? "#f85149" : "#d29922";
      const rows = items
        .map(
          (m) =>
            `<tr>
              <td>${severityBadge(m.severity)}</td>
              <td><code>${esc(m.kind)}</code></td>
              <td class="selector-cell"><code class="sel">${esc(m.selector || m.path)}</code><button class="copy-btn" onclick="navigator.clipboard.writeText('${esc(m.selector || m.path).replace(/'/g, "\\'")}')">&#x1F4CB;</button></td>
              <td>${mismatchDetail(m)}</td>
            </tr>`
        )
        .join("\n");

      return `
        <details open>
          <summary style="color:${headerColor};cursor:pointer;font-weight:600;margin:0.75rem 0 0.5rem">
            ${esc(component)} <span style="color:#8b949e;font-weight:400">(${items.length} issue${items.length !== 1 ? "s" : ""}${criticalCount ? `, ${criticalCount} critical` : ""})</span>
          </summary>
          <table>
            <thead><tr><th>Severity</th><th>Kind</th><th>Selector</th><th>Details</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </details>`;
    })
    .join("\n");

  const reactRows = reactErrors
    .map(
      (e) =>
        `<tr><td>${esc(e.source)}</td><td>${esc(e.level ?? "")}</td><td><pre>${esc(e.message)}</pre></td></tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hydration report \u2014 ${esc(url)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 1.5rem; background: #0f1419; color: #e6edf3; max-width: 1400px; margin-inline: auto; }
    h1 { font-size: 1.3rem; border-bottom: 1px solid #30363d; padding-bottom: 0.5rem; }
    h2 { font-size: 1.1rem; margin-top: 2rem; color: #8b949e; }
    .meta { color: #8b949e; font-size: 0.9rem; margin-bottom: 1rem; }
    .summary { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1rem 0; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 0.75rem 1rem; min-width: 110px; }
    .card strong { display: block; font-size: 1.5rem; }
    .card.critical { border-color: #f8514966; }
    .card.warning { border-color: #d2992266; }
    .card.info { border-color: #58a6ff66; }
    table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; font-size: 0.82rem; }
    th, td { border: 1px solid #30363d; padding: 0.4rem 0.5rem; vertical-align: top; }
    th { background: #21262d; text-align: left; }
    pre { white-space: pre-wrap; word-break: break-all; margin: 0; max-height: 200px; overflow: auto; }
    code { background: #161b22; padding: 1px 4px; border-radius: 3px; font-size: 0.82rem; }
    .selector-cell { position: relative; }
    .sel { word-break: break-all; }
    .copy-btn { background: none; border: 1px solid #30363d; border-radius: 4px; cursor: pointer; font-size: 0.7rem; padding: 1px 4px; margin-left: 4px; color: #8b949e; }
    .copy-btn:hover { border-color: #58a6ff; color: #58a6ff; }
    details { margin-bottom: 0.25rem; }
    details summary { list-style: none; }
    details summary::-webkit-details-marker { display: none; }
    details summary::before { content: "\\25B8 "; }
    details[open] summary::before { content: "\\25BE "; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .pane { border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
    .pane h3 { margin: 0; padding: 0.5rem 0.75rem; background: #21262d; font-size: 0.9rem; }
    .pane pre { margin: 0; padding: 0.75rem; max-height: 60vh; overflow: auto; font-size: 0.7rem; }
    .ok { color: #3fb950; }
    .bad { color: #f85149; }
  </style>
</head>
<body>
  <h1>React Hydration Comparator Report</h1>
  <div class="meta">
    <div><strong>URL:</strong> ${esc(url)}</div>
    <div><strong>Fetched:</strong> ${esc(fetchedAt)}</div>
    <div><strong>Server status:</strong> ${serverStatus}</div>
  </div>

  <div class="summary">
    <div class="card critical"><strong style="color:#f85149">${mismatches.filter((m) => m.severity === "critical").length}</strong>Critical</div>
    <div class="card warning"><strong style="color:#d29922">${mismatches.filter((m) => m.severity === "warning").length}</strong>Warning</div>
    <div class="card info"><strong style="color:#58a6ff">${mismatches.filter((m) => m.severity === "info").length}</strong>Info</div>
    <div class="card"><strong>${summary.reactErrorCount}</strong>React errors</div>
    <div class="card"><strong>${mismatches.length}</strong>Total mismatches</div>
  </div>

  <h2>React Hydration Messages</h2>
  <table>
    <thead><tr><th>Source</th><th>Level</th><th>Message</th></tr></thead>
    <tbody>${reactRows || '<tr><td colspan="3">(none)</td></tr>'}</tbody>
  </table>

  <h2>Structural Mismatches \u2014 Grouped by Component</h2>
  ${groupedSections || '<p style="color:#8b949e">(none)</p>'}

  <h2>Raw HTML</h2>
  <div class="grid">
    <div class="pane"><h3>Server HTML</h3><pre>${esc(raw.serverHtml)}</pre></div>
    <div class="pane"><h3>Client HTML</h3><pre>${esc(raw.clientHtml)}</pre></div>
  </div>

  <h2>Full JSON Report</h2>
  <pre style="max-height:40vh;overflow:auto;padding:1rem;border-radius:8px;border:1px solid #30363d;background:#010409;font-size:0.7rem">${reportJson}</pre>
</body>
</html>`;
}
