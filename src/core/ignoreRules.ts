import type { P5Child, P5Element } from "./treeTypes.js";

const ANALYTICS_HOST_SNIPPETS = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "segment.com",
  "segment.io",
  "hotjar.com",
  "facebook.net",
  "doubleclick.net",
  "clarity.ms",
  "plausible.io",
  "mixpanel.com",
  "connect.facebook.net",
  "cdn.heapanalytics.com",
  "cdn.amplitude.com",
];

const EXT_ATTR_PREFIXES = ["bis_", "__processed_", "cz-shortcut-listen"];
const EXT_ATTR_NAMES = new Set([
  "bis_skin_checked",
  "cz-shortcut-listen",
  "data-new-gr-c-s-check-loaded",
  "data-gr-ext-installed",
]);

export function isExtensionAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  if (EXT_ATTR_NAMES.has(lower)) return true;
  for (const p of EXT_ATTR_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) return true;
  }
  return false;
}

function attrValue(el: P5Element, name: string): string | undefined {
  const a = el.attrs?.find((x) => x.name === name);
  return a?.value;
}

function scriptSrc(el: P5Element): string | undefined {
  return attrValue(el, "src");
}

function iframeSrc(el: P5Element): string | undefined {
  return attrValue(el, "src");
}

export function shouldIgnoreClientScript(el: P5Element): boolean {
  if (el.tagName !== "script") return false;
  const src = scriptSrc(el);
  if (!src) {
    const inline = getInlineScriptSnippet(el);
    if (/gtag|googletagmanager|dataLayer|fbq\(|analytics|partytown/i.test(inline)) return true;
    return false;
  }
  const lower = src.toLowerCase();
  for (const h of ANALYTICS_HOST_SNIPPETS) {
    if (lower.includes(h)) return true;
  }
  // ShikshaPWA: Partytown worker scripts
  if (lower.includes("~partytown") || lower.includes("partytown")) return true;
  return false;
}

export function shouldIgnoreClientIframe(el: P5Element): boolean {
  if (el.tagName !== "iframe") return false;
  const src = iframeSrc(el) ?? "";
  const lower = src.toLowerCase();
  for (const h of ANALYTICS_HOST_SNIPPETS) {
    if (lower.includes(h)) return true;
  }
  return false;
}

export function shouldIgnoreClientStyleInHead(el: P5Element, parentTag: string): boolean {
  if (el.tagName !== "style" || parentTag !== "head") return false;
  if (attrValue(el, "data-emotion")) return true;
  if (attrValue(el, "data-styled")) return true;
  if (attrValue(el, "data-s")) return true;
  if (attrValue(el, "data-linaria")) return true;
  return false;
}

export function shouldIgnoreClientLink(el: P5Element): boolean {
  if (el.tagName !== "link") return false;
  const rel = (attrValue(el, "rel") ?? "").toLowerCase();
  const as = (attrValue(el, "as") ?? "").toLowerCase();
  if (rel.includes("preload") && (as === "script" || as === "fetch")) return true;
  if (rel.includes("prefetch") && attrValue(el, "href")?.includes("_next")) return true;
  // ShikshaPWA: @loadable/component chunk preloads
  if (rel.includes("preload") && attrValue(el, "href")?.includes("chunk")) return true;
  return false;
}

function getInlineScriptSnippet(el: P5Element): string {
  const first = el.childNodes?.find((c) => c.nodeName === "#text") as { value?: string } | undefined;
  return (first?.value ?? "").slice(0, 200);
}

/**
 * ShikshaPWA: Check if an element is a PartytownWrapper container.
 * These are injected client-side only and are not hydration mismatches.
 */
function isPartytownContainer(el: P5Element): boolean {
  const id = attrValue(el, "id") ?? "";
  const cls = attrValue(el, "class") ?? "";
  if (id.includes("partytown") || cls.includes("partytown")) return true;
  // Partytown injects a specific script type
  if (el.tagName === "script" && attrValue(el, "type") === "text/partytown") return true;
  return false;
}

/**
 * ShikshaPWA: Check if an element is a service-worker registration script
 * or other client-only runtime injection.
 */
function isServiceWorkerScript(el: P5Element): boolean {
  if (el.tagName !== "script") return false;
  const inline = getInlineScriptSnippet(el);
  if (/serviceWorker|service-worker|sw\.js/i.test(inline)) return true;
  return false;
}

export function shouldSkipServerChild(node: P5Child): boolean {
  if (node.nodeName === "#comment") return true;
  if (node.nodeName === "#documentType") return true;
  if (isElementNode(node) && node.tagName === "noscript") return true;
  return false;
}

export function shouldSkipClientChild(node: P5Child, parentTag: string): boolean {
  if (node.nodeName === "#comment") return true;
  if (node.nodeName === "#documentType") return true;
  if (!isElementNode(node)) return false;
  if (shouldIgnoreClientScript(node)) return true;
  if (shouldIgnoreClientIframe(node)) return true;
  if (shouldIgnoreClientStyleInHead(node, parentTag)) return true;
  if (shouldIgnoreClientLink(node)) return true;
  // ShikshaPWA-specific suppressions
  if (isPartytownContainer(node)) return true;
  if (isServiceWorkerScript(node)) return true;
  return false;
}

export function isElementNode(node: P5Child): node is P5Element {
  return "tagName" in node && typeof (node as P5Element).tagName === "string";
}

