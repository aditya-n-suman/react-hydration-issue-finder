import { parse } from "parse5";
import type { Mismatch, Severity } from "./types.js";
import {
  isElementNode,
  isExtensionAttribute,
  shouldSkipClientChild,
  shouldSkipServerChild,
} from "./ignoreRules.js";
import type { P5Child, P5Document, P5Element, P5Text } from "./treeTypes.js";
import { compileSelector, matchesSelector, type CompiledSelector } from "./selectorMatch.js";

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

export type DiffOptions = {
  /**
   * Hydration roots to scope the diff to (from the in-page React hook). Each is located
   * by `#id` selector first, then by diff-path. Omit to diff the whole document.
   */
  roots?: { selector: string; path: string }[];
  /** CSS selectors whose subtrees are dropped from BOTH trees before diffing */
  ignoreSelectors?: string[];
};

type Ctx = { out: Mismatch[]; ignore: CompiledSelector[] };

/** Index among same-tag element siblings (0-based nth-of-type), as used by diff paths */
function nthOfType(parent: P5Element, child: P5Element): number {
  let n = 0;
  for (const c of parent.childNodes ?? []) {
    if (c === child) return n;
    if (isElementNode(c) && c.tagName === child.tagName) n++;
  }
  return 0;
}

function elementPath(parentPath: string, parent: P5Element, child: P5Element): string {
  return `${parentPath} > ${child.tagName}[${nthOfType(parent, child)}]`;
}

/**
 * Children React would actually hydrate against: drops comments (incl. `<!-- -->` text
 * separators), whitespace-only text, known client-only injections and user-ignored
 * subtrees, then merges adjacent text nodes so server/client splits don't matter.
 */
function hydratableChildren(
  el: P5Element,
  ancestors: P5Element[],
  ctx: Ctx
): P5Child[] {
  const out: P5Child[] = [];
  const chain = [...ancestors, el];
  for (const n of el.childNodes ?? []) {
    // Noise rules apply to both sides: a tracker script present in the server HTML too
    // must not turn into a "missing child" just because the client side filters it.
    if (shouldSkipServerChild(n) || shouldSkipClientChild(n, el.tagName)) continue;
    if (isTextNode(n)) {
      if (!n.value || !n.value.trim()) continue;
      const prev = out[out.length - 1];
      if (prev && isTextNode(prev)) {
        out[out.length - 1] = { nodeName: "#text", value: prev.value + n.value };
        continue;
      }
      out.push(n);
      continue;
    }
    if (isElementNode(n)) {
      if (n.tagName === "noscript") continue;
      if (ctx.ignore.some((sel) => matchesSelector(n, chain, sel))) continue;
    }
    out.push(n);
  }
  return out;
}

/** Placeholder values used during diff; enrichment fills real values later */
const PLACEHOLDER_SELECTOR = "";
const PLACEHOLDER_SEVERITY: Severity = "info";

function compareText(a: P5Text, b: P5Text, path: string, ctx: Ctx): void {
  const sa = normalizeWhitespace(a.value ?? "");
  const sb = normalizeWhitespace(b.value ?? "");
  if (sa !== sb) {
    ctx.out.push({ kind: "text", path, server: sa, client: sb, selector: PLACEHOLDER_SELECTOR, severity: PLACEHOLDER_SEVERITY });
  }
}

function alignKey(n: P5Child): string {
  if (isTextNode(n)) return "#text";
  if (isElementNode(n)) {
    const id = n.attrs?.find((a) => a.name === "id")?.value;
    return id ? `${n.tagName}#${id}` : n.tagName;
  }
  return n.nodeName;
}

/** Above this many cells the LCS table gets too big; fall back to positional pairing. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * Align sibling lists by LCS over (tag, id) keys so one injected/removed node doesn't
 * cascade into a mismatch for every following sibling. Unmatched nodes sitting in the
 * same gap are paired positionally (that's where React would see a tag/text mismatch);
 * leftovers become missing/extra children.
 */
function alignChildren(s: P5Child[], c: P5Child[]): [P5Child | null, P5Child | null][] {
  const n = s.length;
  const m = c.length;
  const pairs: [P5Child | null, P5Child | null][] = [];
  if (n * m > MAX_LCS_CELLS) {
    for (let i = 0; i < Math.max(n, m); i++) pairs.push([s[i] ?? null, c[i] ?? null]);
    return pairs;
  }
  const sk = s.map(alignKey);
  const ck = c.map(alignKey);
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        sk[i] === ck[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  let gapS: P5Child[] = [];
  let gapC: P5Child[] = [];
  const flushGap = () => {
    for (let k = 0; k < Math.max(gapS.length, gapC.length); k++) pairs.push([gapS[k] ?? null, gapC[k] ?? null]);
    gapS = [];
    gapC = [];
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sk[i] === ck[j]) {
      flushGap();
      pairs.push([s[i]!, c[j]!]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) {
      gapS.push(s[i++]!);
    } else {
      gapC.push(c[j++]!);
    }
  }
  while (i < n) gapS.push(s[i++]!);
  while (j < m) gapC.push(c[j++]!);
  flushGap();
  return pairs;
}

function compareElements(
  server: P5Element,
  client: P5Element,
  path: string,
  sAncestors: P5Element[],
  cAncestors: P5Element[],
  ctx: Ctx
): void {
  if (server.tagName !== client.tagName) {
    ctx.out.push({
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
      ctx.out.push({ kind: "attr", path, attr: k, server: va, client: vb, selector: PLACEHOLDER_SELECTOR, severity: PLACEHOLDER_SEVERITY });
    }
  }

  const sKids = hydratableChildren(server, sAncestors, ctx);
  const cKids = hydratableChildren(client, cAncestors, ctx);
  const sChain = [...sAncestors, server];
  const cChain = [...cAncestors, client];
  let textIdx = 0;
  for (const [sk, ck] of alignChildren(sKids, cKids)) {
    const childPath = sk
      ? isElementNode(sk)
        ? elementPath(path, server, sk)
        : `${path} > #text[${textIdx++}]`
      : path;
    if (sk && !ck) {
      ctx.out.push({ kind: "missingChild", path: childPath, expected: summarizeNode(sk), selector: PLACEHOLDER_SELECTOR, severity: PLACEHOLDER_SEVERITY });
    } else if (!sk && ck) {
      // Client-only node: point at the parent, which exists on both sides
      ctx.out.push({ kind: "extraChild", path, found: summarizeNode(ck), selector: PLACEHOLDER_SELECTOR, severity: PLACEHOLDER_SEVERITY });
    } else if (sk && ck) {
      compareNodes(sk, ck, childPath, sChain, cChain, ctx);
    }
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
  path: string,
  sAncestors: P5Element[],
  cAncestors: P5Element[],
  ctx: Ctx
): void {
  if (isTextNode(server) && isTextNode(client)) {
    compareText(server, client, path, ctx);
    return;
  }
  if (isElementNode(server) && isElementNode(client)) {
    compareElements(server, client, path, sAncestors, cAncestors, ctx);
    return;
  }
  ctx.out.push({
    kind: "tag",
    path,
    server: summarizeNode(server),
    client: summarizeNode(client),
    selector: PLACEHOLDER_SELECTOR,
    severity: PLACEHOLDER_SEVERITY,
  });
}

function findById(el: P5Element, id: string): P5Element | null {
  if (el.attrs?.some((a) => a.name === "id" && a.value === id)) return el;
  for (const c of el.childNodes ?? []) {
    if (isElementNode(c)) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    // <template> content lives on a separate fragment in parse5
    const content = (c as { content?: { childNodes?: P5Child[] } }).content;
    if (content?.childNodes) {
      for (const t of content.childNodes) {
        if (isElementNode(t)) {
          const hit = findById(t, id);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

function findByPath(html: P5Element, path: string): P5Element | null {
  const segs = path.split(/\s*>\s*/).slice(1);
  let cur: P5Element = html;
  for (const seg of segs) {
    const m = /^([\w-]+)\[(\d+)\]$/.exec(seg);
    if (!m) return null;
    const same = (cur.childNodes ?? []).filter((c): c is P5Element => isElementNode(c) && c.tagName === m[1]);
    const next = same[Number(m[2])];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** Ancestor chain (outermost → parent) and diff-path for an element in a document */
function locate(html: P5Element, target: P5Element): { ancestors: P5Element[]; path: string } | null {
  if (html === target) return { ancestors: [], path: "html" };
  const walk = (el: P5Element, chain: P5Element[], path: string): { ancestors: P5Element[]; path: string } | null => {
    for (const c of el.childNodes ?? []) {
      if (!isElementNode(c)) continue;
      const p = elementPath(path, el, c);
      if (c === target) return { ancestors: [...chain, el], path: p };
      const hit = walk(c, [...chain, el], p);
      if (hit) return hit;
    }
    return null;
  };
  return walk(html, [], "html");
}

function resolveRoot(html: P5Element, root: { selector: string; path: string }): P5Element | null {
  if (root.path === "html") return html;
  if (root.selector.startsWith("#")) {
    const hit = findById(html, root.selector.slice(1));
    if (hit) return hit;
  }
  return findByPath(html, root.path);
}

export function domDiff(serverHtml: string, clientHtml: string, options: DiffOptions = {}): DiffResult {
  const sDoc = parse(serverHtml, { sourceCodeLocationInfo: false }) as unknown as P5Document;
  const cDoc = parse(clientHtml, { sourceCodeLocationInfo: false }) as unknown as P5Document;
  const sHtml = getDocumentElement(sDoc);
  const cHtml = getDocumentElement(cDoc);
  const ignore = (options.ignoreSelectors ?? [])
    .map(compileSelector)
    .filter((x): x is CompiledSelector => x !== null);
  const ctx: Ctx = { out: [], ignore };
  if (!sHtml && !cHtml) return { mismatches: ctx.out, serverDoc: sDoc, clientDoc: cDoc };
  if (!sHtml || !cHtml) {
    ctx.out.push({
      kind: "tag",
      path: "document",
      server: sHtml ? "html" : "(empty)",
      client: cHtml ? "html" : "(empty)",
      selector: "",
      severity: "critical",
    });
    return { mismatches: ctx.out, serverDoc: sDoc, clientDoc: cDoc };
  }

  const roots = options.roots?.length ? options.roots : [{ selector: "html", path: "html" }];
  for (const root of roots) {
    const sRoot = resolveRoot(sHtml, root);
    const cRoot = resolveRoot(cHtml, root);
    if (!sRoot || !cRoot) {
      ctx.out.push({
        kind: "missingChild",
        path: root.path,
        expected: `hydration root ${root.selector} (${sRoot ? "absent in client DOM" : "absent in server HTML"})`,
        selector: root.selector,
        severity: "critical",
      });
      continue;
    }
    const sLoc = locate(sHtml, sRoot) ?? { ancestors: [], path: root.path };
    const cLoc = locate(cHtml, cRoot) ?? { ancestors: [], path: root.path };
    compareElements(sRoot, cRoot, sLoc.path, sLoc.ancestors, cLoc.ancestors, ctx);
  }
  return { mismatches: ctx.out, serverDoc: sDoc, clientDoc: cDoc };
}
