import { parse } from "parse5";
import type { Mismatch, Severity } from "./types.js";
import {
  isElementNode,
  isExtensionAttribute,
  shouldSkipClientChild,
  shouldSkipServerChild,
} from "./ignoreRules.js";
import type { P5Child, P5Document, P5Element, P5Text } from "./treeTypes.js";

/** Result of domDiff including parsed trees for enrichment */
export interface DiffResult {
  mismatches: Mismatch[];
  serverDoc: P5Document;
  clientDoc: P5Document;
}

const IGNORE_ATTRS = new Set([
  "data-reactroot",
  "data-reactid",
  "data-react-checksum",
  "suppresshydrationwarning",
]);

const CORE_ATTRS = new Set([
  "id",
  "class",
  "classname",
  "name",
  "type",
  "value",
  "checked",
  "selected",
  "href",
  "src",
  "for",
  "htmlfor",
  "role",
  "title",
  "alt",
  "tabindex",
  "disabled",
  "readonly",
  "placeholder",
  "rows",
  "cols",
  "span",
  "rowspan",
  "colspan",
  "contenteditable",
  "draggable",
  "spellcheck",
  "inputmode",
  "pattern",
  "min",
  "max",
  "step",
  "accept",
  "multiple",
  "capture",
  "autocomplete",
  "autofocus",
  "required",
  "form",
  "formaction",
  "formmethod",
  "formenctype",
  "formnovalidate",
  "formtarget",
  "list",
  "maxlength",
  "minlength",
  "size",
  "srcset",
  "sizes",
  "loading",
  "decoding",
  "crossorigin",
  "integrity",
  "referrerpolicy",
  "target",
  "rel",
  "download",
  "ping",
  "hreflang",
  "media",
  "nonce",
]);

function shouldCompareAttrName(name: string): boolean {
  const lower = name.toLowerCase();
  if (IGNORE_ATTRS.has(lower)) return false;
  if (isExtensionAttribute(lower)) return false;
  if (lower === "style") return true;
  if (lower.startsWith("aria-")) return true;
  if (lower.startsWith("data-")) return true;
  if (CORE_ATTRS.has(lower)) return true;
  return false;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeClass(s: string): string {
  return normalizeWhitespace(
    s
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(" ")
  );
}

function normalizeStyle(s: string): string {
  const parts = s
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const idx = p.indexOf(":");
      if (idx === -1) return p;
      const prop = p.slice(0, idx).trim().toLowerCase();
      const val = p.slice(idx + 1).trim();
      return `${prop}:${val}`;
    })
    .sort();
  return parts.join(";");
}

function getAttrMap(el: P5Element): Map<string, string> {
  const m = new Map<string, string>();
  for (const { name, value } of el.attrs ?? []) {
    const lower = name.toLowerCase();
    if (!shouldCompareAttrName(lower)) continue;
    let v = value ?? "";
    if (lower === "class") v = normalizeClass(v);
    else if (lower === "style") v = normalizeStyle(v);
    else v = normalizeWhitespace(v);
    m.set(lower, v);
  }
  return m;
}

function elementSummary(el: P5Element): string {
  const tag = el.tagName;
  const id = el.attrs?.find((a) => a.name === "id")?.value;
  const cls = el.attrs?.find((a) => a.name === "class")?.value;
  const parts = [tag];
  if (id) parts.push(`#${id}`);
  if (cls) parts.push(`.${cls.split(/\s+/).filter(Boolean).slice(0, 2).join(".")}`);
  return parts.join("");
}

function isTextNode(n: P5Child): n is P5Text {
  return n.nodeName === "#text";
}

function getDocumentElement(doc: P5Document): P5Element | null {
  for (const c of doc.childNodes ?? []) {
    if (isElementNode(c) && c.tagName === "html") return c;
  }
  for (const c of doc.childNodes ?? []) {
    if (isElementNode(c)) return c;
  }
  return null;
}

function filterChildren(nodes: P5Child[] | undefined, side: "server" | "client", parentTag: string): P5Child[] {
  if (!nodes) return [];
  const out: P5Child[] = [];
  for (const n of nodes) {
    if (side === "server") {
      if (!shouldSkipServerChild(n)) out.push(n);
    } else {
      if (!shouldSkipClientChild(n, parentTag)) out.push(n);
    }
  }
  return out;
}

function serverElementIndex(parent: P5Element, child: P5Element): number {
  const kids = filterChildren(parent.childNodes, "server", parent.tagName).filter(isElementNode);
  return kids.indexOf(child);
}

function childPathFor(parentPath: string, parent: P5Element, serverChild: P5Child, childIndex: number): string {
  if (isTextNode(serverChild)) {
    return `${parentPath} > #text[${childIndex}]`;
  }
  if (isElementNode(serverChild)) {
    const idx = serverElementIndex(parent, serverChild);
    const safeIdx = idx >= 0 ? idx : childIndex;
    return `${parentPath} > ${serverChild.tagName}[${safeIdx}]`;
  }
  return `${parentPath} > ${serverChild.nodeName}[${childIndex}]`;
}

/** Placeholder values used during diff; enrichment fills real values later */
const PLACEHOLDER_SELECTOR = "";
const PLACEHOLDER_SEVERITY: Severity = "info";

function compareText(a: P5Text, b: P5Text, path: string, out: Mismatch[]): void {
  const sa = normalizeWhitespace(a.value ?? "");
  const sb = normalizeWhitespace(b.value ?? "");
  if (sa !== sb) {
    out.push({ kind: "text", path, server: sa, client: sb, selector: PLACEHOLDER_SELECTOR, severity: PLACEHOLDER_SEVERITY });
  }
}

function compareElements(server: P5Element, client: P5Element, path: string, out: Mismatch[]): void {
  if (server.tagName !== client.tagName) {
    out.push({
      kind: "tag",
      path,
      server: elementSummary(server),
      client: elementSummary(client),
      selector: PLACEHOLDER_SELECTOR,
      severity: PLACEHOLDER_SEVERITY,
    });
    return;
  }

  const as = getAttrMap(server);
  const bs = getAttrMap(client);
  const keys = new Set([...as.keys(), ...bs.keys()]);
  for (const k of keys) {
    const va = as.get(k) ?? null;
    const vb = bs.get(k) ?? null;
    if (va !== vb) {
      out.push({ kind: "attr", path, attr: k, server: va, client: vb, selector: PLACEHOLDER_SELECTOR, severity: PLACEHOLDER_SEVERITY });
    }
  }

  const sKids = filterChildren(server.childNodes, "server", server.tagName);
  const cKids = filterChildren(client.childNodes, "client", client.tagName);
  const max = Math.max(sKids.length, cKids.length);
  for (let i = 0; i < max; i++) {
    const slotPath = `${path}@[${i}]`;
    if (i >= sKids.length) {
      const ck = cKids[i]!;
      out.push({
        kind: "extraChild",
        path: slotPath,
        found: summarizeNode(ck),
        selector: PLACEHOLDER_SELECTOR,
        severity: PLACEHOLDER_SEVERITY,
      });
      continue;
    }
    if (i >= cKids.length) {
      const sk = sKids[i]!;
      out.push({
        kind: "missingChild",
        path: slotPath,
        expected: summarizeNode(sk),
        selector: PLACEHOLDER_SELECTOR,
        severity: PLACEHOLDER_SEVERITY,
      });
      continue;
    }
    const sk = sKids[i]!;
    const ck = cKids[i]!;
    const childPath = childPathFor(path, server, sk, i);
    compareNodes(sk, ck, server, childPath, out);
  }
}

function summarizeNode(n: P5Child): string {
  if (isTextNode(n)) return `#text(${normalizeWhitespace(n.value ?? "").slice(0, 80)})`;
  if (isElementNode(n)) return elementSummary(n);
  return n.nodeName;
}

function compareNodes(
  server: P5Child,
  client: P5Child,
  serverParent: P5Element,
  path: string,
  out: Mismatch[]
): void {
  if (isTextNode(server) && isTextNode(client)) {
    compareText(server, client, path, out);
    return;
  }
  if (isTextNode(server) !== isTextNode(client)) {
    out.push({
      kind: "tag",
      path,
      server: summarizeNode(server),
      client: summarizeNode(client),
      selector: PLACEHOLDER_SELECTOR,
      severity: PLACEHOLDER_SEVERITY,
    });
    return;
  }
  if (isElementNode(server) && isElementNode(client)) {
    compareElements(server, client, path, out);
    return;
  }
  out.push({
    kind: "tag",
    path,
    server: summarizeNode(server),
    client: summarizeNode(client),
    selector: PLACEHOLDER_SELECTOR,
    severity: PLACEHOLDER_SEVERITY,
  });
}

export function domDiff(serverHtml: string, clientHtml: string): DiffResult {
  const sDoc = parse(serverHtml, { sourceCodeLocationInfo: false }) as unknown as P5Document;
  const cDoc = parse(clientHtml, { sourceCodeLocationInfo: false }) as unknown as P5Document;
  const sRoot = getDocumentElement(sDoc);
  const cRoot = getDocumentElement(cDoc);
  const out: Mismatch[] = [];
  if (!sRoot && !cRoot) return { mismatches: out, serverDoc: sDoc, clientDoc: cDoc };
  if (!sRoot || !cRoot) {
    out.push({
      kind: "tag",
      path: "document",
      server: sRoot ? "html" : "(empty)",
      client: cRoot ? "html" : "(empty)",
      selector: "",
      severity: "critical",
    });
    return { mismatches: out, serverDoc: sDoc, clientDoc: cDoc };
  }
  compareElements(sRoot, cRoot, "html", out);
  return { mismatches: out, serverDoc: sDoc, clientDoc: cDoc };
}
