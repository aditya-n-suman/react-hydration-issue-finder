const $ = (id) => document.getElementById(id);

const form = $("form");
const statusEl = $("status");
const errorEl = $("error");
const results = $("results");

/** Currently loaded report data */
let currentReport = null;

function setHidden(el, v) {
  el.hidden = v;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function severityPill(severity) {
  return `<span class="severity-pill ${severity}">${severity.toUpperCase()}</span>`;
}

function mismatchDetailHtml(m) {
  if (m.kind === "tag") return `server: <code>${esc(m.server)}</code><br/>client: <code>${esc(m.client)}</code>`;
  if (m.kind === "text") return `server: <code>${esc(m.server)}</code><br/>client: <code>${esc(m.client)}</code>`;
  if (m.kind === "attr")
    return `<code>${esc(m.attr)}</code><br/>server: <code>${esc(String(m.server ?? "(none)"))}</code><br/>client: <code>${esc(String(m.client ?? "(none)"))}</code>`;
  if (m.kind === "missingChild") return `expected: <code>${esc(m.expected)}</code>`;
  if (m.kind === "extraChild") return `found: <code>${esc(m.found)}</code>`;
  return "";
}

function selectorCellHtml(m) {
  const sel = m.selector || m.path;
  return `<code>${esc(sel)}</code><button class="copy-btn" title="Copy selector to clipboard">&#x1F4CB;</button>`;
}

// ─── Line-by-line diff engine ───

/** Pretty-format raw HTML into indented lines for readable diffing */
function formatHtmlLines(html) {
  let formatted = html
    .replace(/></g, ">\n<")
    .replace(/(\n\s*){3,}/g, "\n\n");

  const lines = formatted.split("\n");
  const result = [];
  let indent = 0;
  const BLOCK_OPEN = /^<(?:html|head|body|div|main|section|article|header|footer|nav|aside|ul|ol|li|table|thead|tbody|tfoot|tr|form|details|summary|figure|figcaption|blockquote|pre|p|h[1-6])([\s>])/i;
  const BLOCK_CLOSE = /^<\/(?:html|head|body|div|main|section|article|header|footer|nav|aside|ul|ol|li|table|thead|tbody|tfoot|tr|form|details|summary|figure|figcaption|blockquote|pre|p|h[1-6])>/i;
  const SELF_CLOSING = /^<(?:meta|link|br|hr|img|input|source|col|area|base|embed|wbr|track)([\s/>])/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (BLOCK_CLOSE.test(line)) indent = Math.max(0, indent - 1);
    result.push("  ".repeat(indent) + line);
    if (BLOCK_OPEN.test(line) && !SELF_CLOSING.test(line) && !line.includes("</")) {
      indent++;
    }
  }
  return result;
}

/**
 * Compute LCS table for two arrays of strings.
 */
function lcsTable(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Uint32Array(n + 1);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/**
 * Backtrack LCS table to produce diff entries:
 * { type: 'equal'|'removed'|'added'|'changed', serverLine?, clientLine?, serverIdx?, clientIdx? }
 */
function computeLineDiff(serverLines, clientLines) {
  const MAX_LINES = 3000;
  const sLines = serverLines.length > MAX_LINES ? serverLines.slice(0, MAX_LINES) : serverLines;
  const cLines = clientLines.length > MAX_LINES ? clientLines.slice(0, MAX_LINES) : clientLines;

  const dp = lcsTable(sLines, cLines);
  const result = [];
  let i = sLines.length, j = cLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sLines[i - 1] === cLines[j - 1]) {
      result.push({ type: "equal", serverLine: sLines[i - 1], clientLine: cLines[j - 1], serverIdx: i, clientIdx: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "added", clientLine: cLines[j - 1], clientIdx: j });
      j--;
    } else {
      result.push({ type: "removed", serverLine: sLines[i - 1], serverIdx: i });
      i--;
    }
  }
  result.reverse();

  // Merge adjacent removed+added pairs into "changed"
  const merged = [];
  for (let k = 0; k < result.length; k++) {
    const cur = result[k];
    const next = result[k + 1];
    if (cur.type === "removed" && next && next.type === "added") {
      merged.push({
        type: "changed",
        serverLine: cur.serverLine,
        clientLine: next.clientLine,
        serverIdx: cur.serverIdx,
        clientIdx: next.clientIdx,
      });
      k++;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

/** Render a single diff line with line number and background color */
function diffLineHtml(lineNum, content, cssClass) {
  const num = lineNum != null ? String(lineNum).padStart(4, " ") : "    ";
  return `<div class="diff-line ${cssClass}"><span class="diff-ln">${num}</span>${esc(content || "")}</div>`;
}

/** Highlight inline character-level differences within a changed line */
function highlightInlineDiff(serverLine, clientLine) {
  const sChars = serverLine || "";
  const cChars = clientLine || "";
  let prefixLen = 0;
  while (prefixLen < sChars.length && prefixLen < cChars.length && sChars[prefixLen] === cChars[prefixLen]) prefixLen++;
  let suffixLen = 0;
  while (
    suffixLen < (sChars.length - prefixLen) &&
    suffixLen < (cChars.length - prefixLen) &&
    sChars[sChars.length - 1 - suffixLen] === cChars[cChars.length - 1 - suffixLen]
  ) suffixLen++;

  const sEnd = sChars.length - suffixLen;
  const cEnd = cChars.length - suffixLen;

  const sPrefix = esc(sChars.slice(0, prefixLen));
  const sSuffix = suffixLen > 0 ? esc(sChars.slice(sEnd)) : "";
  const sMiddle = esc(sChars.slice(prefixLen, sEnd));
  const cPrefix = esc(cChars.slice(0, prefixLen));
  const cSuffix = suffixLen > 0 ? esc(cChars.slice(cEnd)) : "";
  const cMiddle = esc(cChars.slice(prefixLen, cEnd));

  return {
    server: `${sPrefix}<span class="diff-inline-del">${sMiddle}</span>${sSuffix}`,
    client: `${cPrefix}<span class="diff-inline-add">${cMiddle}</span>${cSuffix}`,
  };
}

function renderSummary(report) {
  const cards = $("summary-cards");
  const s = report.summary;
  const mismatches = report.mismatches || [];
  const criticalCount = mismatches.filter((m) => m.severity === "critical").length;
  const warningCount = mismatches.filter((m) => m.severity === "warning").length;
  const infoCount = mismatches.filter((m) => m.severity === "info").length;

  cards.innerHTML = [
    [`Critical`, criticalCount, "var(--bad)", "card-critical"],
    [`Warning`, warningCount, "var(--warn)", "card-warning"],
    [`Info`, infoCount, "var(--accent)", "card-info"],
    ["React errors", s.reactErrorCount, s.reactErrorCount ? "var(--bad)" : "var(--ok)", ""],
    ["Total mismatches", mismatches.length, "var(--text)", ""],
  ]
    .map(
      ([label, val, col, cls]) =>
        `<div class="card ${cls}"><span style="color:${col}"><strong>${val}</strong></span>${esc(label)}</div>`
    )
    .join("");

  $("summary-json").textContent = JSON.stringify(
    {
      url: report.url,
      fetchedAt: report.fetchedAt,
      serverStatus: report.serverStatus,
      hydration: report.hydration,
      summary: report.summary,
    },
    null,
    2
  );
}

/** Get currently active severity filters */
function getActiveFilters() {
  const checks = document.querySelectorAll("#severity-filter input[type=checkbox][value]");
  const active = new Set();
  checks.forEach((cb) => {
    if (cb.checked) active.add(cb.value);
  });
  return active;
}

function filterMismatches(mismatches) {
  const active = getActiveFilters();
  return mismatches.filter((m) => active.has(m.severity));
}

function renderMismatchesGrouped(mismatches) {
  const grouped = {};
  for (const m of mismatches) {
    const key = m.componentHint || "Unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  const container = $("mismatch-grouped");
  const html = Object.entries(grouped)
    .map(([component, items]) => {
      const criticalCount = items.filter((m) => m.severity === "critical").length;
      const summaryColor = criticalCount > 0 ? "var(--bad)" : "var(--warn)";
      const rows = items
        .map(
          (m) =>
            `<tr>
              <td>${severityPill(m.severity)}</td>
              <td><code>${esc(m.kind)}</code></td>
              <td class="selector-cell">${selectorCellHtml(m)}</td>
              <td>${mismatchDetailHtml(m)}</td>
            </tr>`
        )
        .join("");

      return `<details class="component-group" open>
        <summary style="color:${summaryColor}">
          ${esc(component)} <span class="group-count">(${items.length} issue${items.length !== 1 ? "s" : ""}${criticalCount ? `, ${criticalCount} critical` : ""})</span>
        </summary>
        <table class="table">
          <thead><tr><th>Severity</th><th>Kind</th><th>Selector</th><th>Details</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>`;
    })
    .join("");

  container.innerHTML = html;
  bindCopyButtons(container);
}

function renderMismatchesFlat(mismatches) {
  const body = $("mismatch-body");
  body.innerHTML = mismatches
    .map((m) => {
      const compCell = m.componentHint
        ? esc(m.componentHint)
        : '<span style="color:var(--muted);font-style:italic">unclassified</span>';
      return `<tr>
        <td>${severityPill(m.severity)}</td>
        <td><code>${esc(m.kind)}</code></td>
        <td>${compCell}</td>
        <td><code style="font-size:0.72rem;color:var(--muted)">${esc(m.path)}</code></td>
        <td class="selector-cell">${selectorCellHtml(m)}</td>
        <td>${mismatchDetailHtml(m)}</td>
      </tr>`;
    })
    .join("");
  bindCopyButtons(body);
}

function renderMismatches() {
  if (!currentReport) return;
  const filtered = filterMismatches(currentReport.mismatches || []);
  const isGrouped = $("group-toggle").checked;

  if (isGrouped) {
    $("mismatch-grouped").hidden = false;
    $("mismatch-flat-table").hidden = true;
    renderMismatchesGrouped(filtered);
  } else {
    $("mismatch-grouped").hidden = true;
    $("mismatch-flat-table").hidden = false;
    renderMismatchesFlat(filtered);
  }
}

function bindCopyButtons(container) {
  container.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const cell = btn.closest(".selector-cell");
      const code = cell?.querySelector("code");
      if (code) {
        navigator.clipboard.writeText(code.textContent || "").then(() => {
          btn.textContent = "✓";
          setTimeout(() => {
            btn.innerHTML = "&#x1F4CB;";
          }, 1200);
        });
      }
    });
  });
}

function renderReact(errors) {
  const ul = $("react-list");
  if (!errors.length) {
    ul.innerHTML = "<li>(none captured)</li>";
    return;
  }
  ul.innerHTML = errors
    .map((e) => `<li><strong>${esc(e.source)}</strong> ${esc(e.level || "")}<pre>${esc(e.message)}</pre></li>`)
    .join("");
}

function renderSide(report) {
  const serverLines = formatHtmlLines(report.raw.serverHtml);
  const clientLines = formatHtmlLines(report.raw.clientHtml);
  const diff = computeLineDiff(serverLines, clientLines);

  // ── Counters ──
  let addedCount = 0, removedCount = 0, changedCount = 0;
  for (const d of diff) {
    if (d.type === "removed") removedCount++;
    else if (d.type === "added") addedCount++;
    else if (d.type === "changed") changedCount++;
  }

  // ── Stats bar ──
  const statsEl = document.getElementById("diff-stats");
  if (statsEl) {
    statsEl.innerHTML =
      `<span class="diff-stat-removed">\u2212${removedCount} removed</span> ` +
      `<span class="diff-stat-added">+${addedCount} added</span> ` +
      `<span class="diff-stat-changed">~${changedCount} changed</span> ` +
      `<span style="color:var(--muted)">(${diff.length} total lines)</span>`;
  }

  renderUnifiedDiff(diff);
  renderSplitDiff(diff);
}

/**
 * Git-diff-style unified view: interleaved lines with +/-/~ prefixes,
 * @@ hunk headers, and two-column line numbers (server | client).
 */
function renderUnifiedDiff(diff) {
  const CONTEXT = 3;
  let html = "";

  // Find indices of changed entries
  const changeIndices = [];
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type !== "equal") changeIndices.push(i);
  }

  if (changeIndices.length === 0) {
    html = `<div class="diff-line diff-equal" style="color:var(--muted);padding:1rem">No differences found.</div>`;
    $("unified-diff").innerHTML = html;
    return;
  }

  // Merge change indices into context-expanded ranges
  const ranges = [];
  let rangeStart = Math.max(0, changeIndices[0] - CONTEXT);
  let rangeEnd = Math.min(diff.length - 1, changeIndices[0] + CONTEXT);

  for (let k = 1; k < changeIndices.length; k++) {
    const newStart = Math.max(0, changeIndices[k] - CONTEXT);
    const newEnd = Math.min(diff.length - 1, changeIndices[k] + CONTEXT);
    if (newStart <= rangeEnd + 1) {
      rangeEnd = newEnd;
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = newStart;
      rangeEnd = newEnd;
    }
  }
  ranges.push([rangeStart, rangeEnd]);

  for (const [rStart, rEnd] of ranges) {
    // @@ hunk header
    const firstS = diff[rStart].serverIdx ?? "?";
    const firstC = diff[rStart].clientIdx ?? "?";
    const lastS = diff[rEnd].serverIdx ?? "?";
    const lastC = diff[rEnd].clientIdx ?? "?";
    html += `<div class="diff-line diff-hunk">@@ server:${firstS}\u2013${lastS}  client:${firstC}\u2013${lastC} @@</div>`;

    for (let i = rStart; i <= rEnd; i++) {
      const d = diff[i];
      switch (d.type) {
        case "equal": {
          const sN = String(d.serverIdx ?? "").padStart(4, " ");
          const cN = String(d.clientIdx ?? "").padStart(4, " ");
          html += `<div class="diff-line diff-equal"><span class="diff-ln">${sN}</span><span class="diff-ln">${cN}</span><span class="diff-gutter-char"> </span>${esc(d.serverLine || "")}</div>`;
          break;
        }
        case "removed": {
          const sN = String(d.serverIdx ?? "").padStart(4, " ");
          html += `<div class="diff-line diff-removed"><span class="diff-ln">${sN}</span><span class="diff-ln">    </span><span class="diff-gutter-char diff-gutter-del">\u2212</span>${esc(d.serverLine || "")}</div>`;
          break;
        }
        case "added": {
          const cN = String(d.clientIdx ?? "").padStart(4, " ");
          html += `<div class="diff-line diff-added"><span class="diff-ln">    </span><span class="diff-ln">${cN}</span><span class="diff-gutter-char diff-gutter-add">+</span>${esc(d.clientLine || "")}</div>`;
          break;
        }
        case "changed": {
          const { server: sInline, client: cInline } = highlightInlineDiff(d.serverLine, d.clientLine);
          const sN = String(d.serverIdx ?? "").padStart(4, " ");
          const cN = String(d.clientIdx ?? "").padStart(4, " ");
          html += `<div class="diff-line diff-removed"><span class="diff-ln">${sN}</span><span class="diff-ln">    </span><span class="diff-gutter-char diff-gutter-del">\u2212</span>${sInline}</div>`;
          html += `<div class="diff-line diff-added"><span class="diff-ln">    </span><span class="diff-ln">${cN}</span><span class="diff-gutter-char diff-gutter-add">+</span>${cInline}</div>`;
          break;
        }
      }
    }
  }

  $("unified-diff").innerHTML = html;
}

/** Side-by-side split diff into #server-html and #client-html. */
function renderSplitDiff(diff) {
  let serverHtml = "";
  let clientHtml = "";

  for (const d of diff) {
    switch (d.type) {
      case "equal":
        serverHtml += diffLineHtml(d.serverIdx, d.serverLine, "diff-equal");
        clientHtml += diffLineHtml(d.clientIdx, d.clientLine, "diff-equal");
        break;
      case "removed":
        serverHtml += diffLineHtml(d.serverIdx, d.serverLine, "diff-removed");
        clientHtml += diffLineHtml(null, "", "diff-empty");
        break;
      case "added":
        serverHtml += diffLineHtml(null, "", "diff-empty");
        clientHtml += diffLineHtml(d.clientIdx, d.clientLine, "diff-added");
        break;
      case "changed": {
        const { server: sInline, client: cInline } = highlightInlineDiff(d.serverLine, d.clientLine);
        const sNum = d.serverIdx != null ? String(d.serverIdx).padStart(4, " ") : "    ";
        const cNum = d.clientIdx != null ? String(d.clientIdx).padStart(4, " ") : "    ";
        serverHtml += `<div class="diff-line diff-changed"><span class="diff-ln">${sNum}</span>${sInline}</div>`;
        clientHtml += `<div class="diff-line diff-changed"><span class="diff-ln">${cNum}</span>${cInline}</div>`;
        break;
      }
    }
  }

  $("server-html").innerHTML = serverHtml;
  $("client-html").innerHTML = clientHtml;

  // Synchronized scrolling
  const left = $("server-html");
  const right = $("client-html");
  left.addEventListener("scroll", () => { right.scrollTop = left.scrollTop; right.scrollLeft = left.scrollLeft; }, { passive: true });
  right.addEventListener("scroll", () => { left.scrollTop = right.scrollTop; left.scrollLeft = right.scrollLeft; }, { passive: true });
}

function setupDiffViewToggle() {
  document.querySelectorAll(".diff-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      document.querySelectorAll(".diff-view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (view === "unified") {
        $("diff-unified").hidden = false;
        $("diff-split").hidden = true;
      } else {
        $("diff-unified").hidden = true;
        $("diff-split").hidden = false;
      }
    });
  });
}

function renderRaw(report) {
  const s = report.raw.serverHtml;
  const c = report.raw.clientHtml;

  $("raw-server").textContent = s;
  $("raw-client").textContent = c;

  // Cleanup old listeners if any (though unlikely here)
  const btnS = $("copy-server");
  const btnC = $("copy-client");

  const copy = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("copy-success");
      setTimeout(() => {
        btn.textContent = old;
        btn.classList.remove("copy-success");
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  btnS.onclick = () => copy(s, btnS);
  btnC.onclick = () => copy(c, btnC);
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      $(`panel-${tab}`).classList.add("active");
    });
  });
}

function setupFilters() {
  // Severity checkboxes
  document.querySelectorAll("#severity-filter input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => renderMismatches());
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setHidden(errorEl, true);
  setHidden(results, true);
  setHidden(statusEl, false);
  statusEl.textContent = "Running Playwright + diff…";

  const url = $("url").value.trim();
  const timeoutMs = Number($("timeout").value) || 60000;
  const ignoreRaw = $("ignore").value.trim();
  const ignoreSelectors = ignoreRaw
    ? ignoreRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  $("submit").disabled = true;
  try {
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, timeoutMs, ignoreSelectors }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || res.statusText);
    }
    currentReport = data;
    renderSummary(data);
    renderMismatches();
    renderReact(data.reactErrors || []);
    renderSide(data);
    renderRaw(data);
    setHidden(results, false);
    setHidden(statusEl, true);
  } catch (err) {
    setHidden(statusEl, true);
    setHidden(errorEl, false);
    errorEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    $("submit").disabled = false;
  }
});

setupTabs();
setupFilters();
setupDiffViewToggle();
