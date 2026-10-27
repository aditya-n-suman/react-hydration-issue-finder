#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { Command } from "commander";
import kleur from "kleur";
import { compare, reportHasIssues } from "../core/compare.js";
import { describeHydration, renderHtmlReport } from "./htmlReport.js";
import { startWebServer } from "../web/server.js";
import type { Mismatch, Severity } from "../core/types.js";

function parseHeaders(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const idx = p.indexOf(":");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function severityColor(s: Severity): (str: string) => string {
  switch (s) {
    case "critical": return kleur.red;
    case "warning": return kleur.yellow;
    case "info": return kleur.blue;
    default: return kleur.dim;
  }
}

function severityIcon(s: Severity): string {
  switch (s) {
    case "critical": return "✖";
    case "warning": return "⚠";
    case "info": return "ℹ";
    default: return "·";
  }
}

function mismatchDetail(m: Mismatch): string {
  if (m.kind === "tag") return `server: ${m.server} → client: ${m.client}`;
  if (m.kind === "text") return `"${m.server.slice(0, 50)}" → "${m.client.slice(0, 50)}"`;
  if (m.kind === "attr") return `${m.attr}: ${m.server ?? "(none)"} → ${m.client ?? "(none)"}`;
  if (m.kind === "missingChild") return `expected: ${m.expected}`;
  if (m.kind === "extraChild") return `found: ${m.found}`;
  return "";
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const program = new Command();

program
  .name("react-hydrate-cmp")
  .description("Compare server HTML vs post-hydration DOM for React hydration mismatches")
  .argument("[url]", "Page URL to compare")
  .option("--json", "Print full report as JSON")
  .option("--report <file>", "Write standalone HTML report to file")
  .option("--serve", "Start web UI server (default port 4321)")
  .option("--port <n>", "Port for --serve", "4321")
  .option("--timeout <ms>", "Navigation + hydration budget", "60000")
  .option("--cookie <string>", "Cookie header for server + browser")
  .option("--header <h>", "Extra header (repeatable), format Name: value", collect, [])
  .option("--ignore-selector <sel>", "Remove matching nodes before snapshot (repeatable)", collect, [])
  .action(
    async (
      url: string | undefined,
      opts: {
        json?: boolean;
        report?: string;
        serve?: boolean;
        port?: string;
        timeout?: string;
        cookie?: string;
        header: string[];
        ignoreSelector: string[];
      }
    ) => {
      if (opts.serve) {
        const port = Number(opts.port) || 4321;
        await startWebServer(port);
        return;
      }

      if (!url) {
        console.error(kleur.red("Error: URL required unless using --serve"));
        program.help({ error: true });
        return;
      }

      const timeoutMs = Number(opts.timeout) || 60_000;
      const headers = parseHeaders(opts.header ?? []);
      const ignoreSelectors = opts.ignoreSelector ?? [];

      const report = await compare(url, {
        timeoutMs,
        cookie: opts.cookie,
        headers,
        ignoreSelectors,
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const s = report.summary;
        console.log(kleur.cyan("\n━━━ Hydration Comparator Report ━━━\n"));
        console.log(`  URL:           ${kleur.underline(report.url)}`);
        console.log(`  Server status: ${report.serverStatus}`);
        console.log(`  Fetched at:    ${report.fetchedAt}`);
        const hyd = describeHydration(report.hydration);
        console.log(`  Hydration:     ${report.hydration.method === "fallback" ? kleur.yellow(hyd) : hyd}`);
        console.log();

        // Summary badges
        const total = report.mismatches.length;
        const critical = report.mismatches.filter((m) => m.severity === "critical").length;
        const warnings = report.mismatches.filter((m) => m.severity === "warning").length;
        const info = report.mismatches.filter((m) => m.severity === "info").length;

        console.log(`  ${kleur.bold("Summary")}:`);
        console.log(`    Total mismatches: ${kleur.bold(String(total))}`);
        console.log(`    ${kleur.red(`✖ Critical: ${critical}`)}  ${kleur.yellow(`⚠ Warning: ${warnings}`)}  ${kleur.blue(`ℹ Info: ${info}`)}`);
        console.log(`    React errors:  ${s.reactErrorCount > 0 ? kleur.red(String(s.reactErrorCount)) : kleur.green("0")}`);
        console.log(`    Tag / Text / Attr / Missing / Extra:`);
        console.log(`    ${s.tagMismatches} / ${s.textMismatches} / ${s.attrMismatches} / ${s.missingChildren} / ${s.extraChildren}`);

        // React errors
        if (report.reactErrors.length) {
          console.log(kleur.red("\n  ┌─ React Hydration Errors ─┐"));
          for (const e of report.reactErrors) {
            console.log(`  │ [${e.source}] ${e.message.slice(0, 300)}`);
          }
          console.log("  └──────────────────────────┘");
        }

        // Mismatches grouped by component
        if (report.mismatches.length) {
          console.log(kleur.yellow("\n  ┌─ Mismatches by Component ─┐\n"));
          const grouped = report.groupedMismatches;
          for (const [component, items] of Object.entries(grouped)) {
            const compCritical = items.filter((m) => m.severity === "critical").length;
            const compLabel = compCritical > 0
              ? kleur.red(`  ▸ ${component} (${items.length} issues, ${compCritical} critical)`)
              : kleur.yellow(`  ▸ ${component} (${items.length} issues)`);
            console.log(compLabel);

            for (const m of items.slice(0, 15)) {
              const badge = severityColor(m.severity)(` ${severityIcon(m.severity)} ${m.severity.toUpperCase()} `);
              const kind = kleur.dim(`[${m.kind}]`);
              const selector = kleur.cyan(truncate(m.selector || m.path, 70));
              const detail = kleur.dim(truncate(mismatchDetail(m), 60));
              console.log(`    ${badge} ${kind} ${selector}`);
              console.log(`      ${detail}`);
            }
            if (items.length > 15) {
              console.log(kleur.dim(`    ... and ${items.length - 15} more`));
            }
            console.log();
          }
          console.log("  └────────────────────────────┘");

          // Full flat listing — ensures nothing is missed
          console.log(kleur.cyan("\n  ── All mismatches (flat) ──\n"));
          for (const m of report.mismatches) {
            const badge = severityColor(m.severity)(`${severityIcon(m.severity)} ${m.severity.toUpperCase()}`);
            const comp = m.componentHint ? kleur.magenta(`[${m.componentHint}]`) : kleur.dim("[unclassified]");
            const kind = kleur.dim(m.kind);
            const sel = m.selector || m.path;
            console.log(`  ${badge} ${kind} ${comp}`);
            console.log(`    path:     ${kleur.dim(m.path)}`);
            console.log(`    selector: ${kleur.cyan(sel)}`);
            console.log(`    ${kleur.dim(truncate(mismatchDetail(m), 100))}`);
            console.log();
          }
        }

        if (!reportHasIssues(report)) {
          console.log(kleur.green("\n  ✓ No structural mismatches or captured React hydration messages.\n"));
        }
      }

      if (opts.report) {
        writeFileSync(opts.report, renderHtmlReport(report), "utf8");
        console.log(kleur.green(`\nWrote HTML report: ${opts.report}\n`));
      }

      process.exitCode = reportHasIssues(report) ? 1 : 0;
    }
  );

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

program.parse();

