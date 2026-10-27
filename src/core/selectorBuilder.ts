import type { P5Child, P5Document, P5Element } from "./treeTypes.js";
import { isElementNode } from "./ignoreRules.js";

/**
 * Convert a parse5 diff-path (e.g. "html > body > div[0] > main@[2]")
 * into a valid CSS selector usable with document.querySelector().
 *
 * Strategy: walk the server parse5 tree following the path, and at each
 * element prefer unique selectors in order:
 *   #id → [data-testid] → [data-module] → tag.class:nth-of-type(n)
 */

function getDocumentElement(doc: P5Document): P5Element | null {
  for (const c of doc.childNodes ?? []) {
    if (isElementNode(c) && c.tagName === "html") return c;
  }
  for (const c of doc.childNodes ?? []) {
    if (isElementNode(c)) return c;
  }
  return null;
}

function attrVal(el: P5Element, name: string): string | undefined {
  return el.attrs?.find((a) => a.name === name)?.value;
}

function elementChildren(el: P5Element): P5Element[] {
  return (el.childNodes ?? []).filter(isElementNode) as P5Element[];
}

/**
 * Build the shortest unambiguous CSS selector segment for a single element.
 * Returns just the segment (e.g. "#main-wrapper" or "div.card:nth-of-type(3)")
 */
function selectorSegment(el: P5Element, parent: P5Element | null): string {
  // 1. Prefer id (globally unique)
  const id = attrVal(el, "id");
  if (id && /^[a-zA-Z_][\w-]*$/.test(id)) {
    return `#${id}`;
  }

  // 2. data-testid (unique within parent, great for DevTools)
  const testId = attrVal(el, "data-testid");
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  // 3. data-module (ShikshaPWA component boundary marker)
  const dataModule = attrVal(el, "data-module");
  if (dataModule) {
    return `[data-module="${dataModule}"]`;
  }

  // 4. data-component
  const dataComp = attrVal(el, "data-component");
  if (dataComp) {
    return `[data-component="${dataComp}"]`;
  }

  // 5. tag + class + nth-of-type for disambiguation
  const tag = el.tagName;
  const cls = attrVal(el, "class");
  const firstClass = cls
    ?.split(/\s+/)
    .filter(Boolean)
    .find((c) => /^[a-zA-Z_][\w-]*$/.test(c));

  if (parent) {
    const siblings = elementChildren(parent).filter((s) => s.tagName === tag);
    if (siblings.length <= 1) {
      return firstClass ? `${tag}.${firstClass}` : tag;
    }
    const idx = siblings.indexOf(el);
    const base = firstClass ? `${tag}.${firstClass}` : tag;
    return `${base}:nth-of-type(${idx + 1})`;
  }

  return firstClass ? `${tag}.${firstClass}` : tag;
}

/**
 * Parse a diff path like "html > body > div[0] > main > h1[2]" into
 * segment tokens. Each segment is { tag, index }.
 */
interface PathSegment {
  tag: string;
  index: number;
  isText: boolean;
}

function parseDiffPath(path: string): PathSegment[] {
  // Segments are separated by " > "
  // Each segment looks like: tagName[idx], tagName, #text[idx], or something@[idx]
  const parts = path.split(/\s*>\s*/);
  const out: PathSegment[] = [];
  for (const p of parts) {
    const textMatch = /^#text\[(\d+)\]$/.exec(p);
    if (textMatch) {
      out.push({ tag: "#text", index: Number(textMatch[1]), isText: true });
      continue;
    }
    // tag[idx] or tag@[idx]
    const idxMatch = /^(\S+?)(?:\[(\d+)\]|@\[(\d+)\])$/.exec(p);
    if (idxMatch) {
      const tag = idxMatch[1]!;
      const idx = Number(idxMatch[2] ?? idxMatch[3] ?? 0);
      out.push({ tag, index: idx, isText: false });
      continue;
    }
    // plain tag
    out.push({ tag: p, index: 0, isText: false });
  }
  return out;
}

/**
 * Walk the parse5 tree following a diff path and build a CSS selector chain.
 */
export function buildSelector(serverDoc: P5Document, diffPath: string): string {
  const segments = parseDiffPath(diffPath);
  if (segments.length === 0) return diffPath;

  let current: P5Element | null = getDocumentElement(serverDoc);
  if (!current) return diffPath;

  const selectorParts: string[] = [];
  let parent: P5Element | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;

    if (i === 0) {
      // The first segment is usually "html" — skip building selector for it
      // but set current = html element
      if (current.tagName === seg.tag) {
        // don't push "html" into selector; start from body-level
        parent = null;
        continue;
      }
    }

    if (seg.isText) {
      // Text nodes don't have CSS selectors; stop here
      break;
    }

    // Find the child element matching this segment
    const children = elementChildren(current);
    const sameTag = children.filter((c) => c.tagName === seg.tag);
    const child = sameTag[seg.index] ?? children[seg.index];

    if (!child) {
      // Can't walk further; use what we have + the raw remaining path
      selectorParts.push(seg.tag);
      break;
    }

    parent = current;
    const selSeg = selectorSegment(child, parent);

    // If we hit an id selector, reset the chain (ids are globally unique)
    if (selSeg.startsWith("#")) {
      selectorParts.length = 0;
    }

    selectorParts.push(selSeg);
    current = child;
  }

  if (selectorParts.length === 0) {
    return "html";
  }

  return selectorParts.join(" > ");
}
