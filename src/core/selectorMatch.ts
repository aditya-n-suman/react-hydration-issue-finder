import type { P5Element } from "./treeTypes.js";

/**
 * Tiny CSS selector matcher for parse5 elements, used for --ignore-selector so the
 * same nodes are dropped from both the server and client trees.
 *
 * Supports selector lists (`a, b`), descendant combinators (`.a .b`), and compound
 * selectors made of: tag, `*`, `#id`, `.class`, `[attr]`, `[attr=value]`,
 * `[attr^=value]`, `[attr*=value]`, `[attr$=value]`.
 */

type AttrTest = { name: string; op?: "=" | "^=" | "*=" | "$="; value?: string };
type Compound = { tag?: string; id?: string; classes: string[]; attrs: AttrTest[] };
type Complex = Compound[]; // descendant chain, last item is the subject

export type CompiledSelector = Complex[];

function parseCompound(src: string): Compound | null {
  const c: Compound = { classes: [], attrs: [] };
  const re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([\^*$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*))\s*)?\]/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return null;
    // `^` keeps the tag alternative anchored to the start of the compound
    if (m[1]) c.tag = m[1] === "*" ? undefined : m[1].toLowerCase();
    if (m[2]) c.id = m[2];
    if (m[3]) c.classes.push(m[3]);
    if (m[4]) {
      c.attrs.push({
        name: m[4].toLowerCase(),
        op: m[5] as AttrTest["op"],
        value: m[6] ?? m[7] ?? m[8],
      });
    }
    i = re.lastIndex;
  }
  return c;
}

export function compileSelector(selector: string): CompiledSelector | null {
  const out: CompiledSelector = [];
  for (const part of selector.split(",")) {
    const chain = part.trim().split(/\s+/).filter(Boolean).map(parseCompound);
    if (chain.length === 0 || chain.some((c) => c === null)) return null;
    out.push(chain as Compound[]);
  }
  return out.length ? out : null;
}

function attr(el: P5Element, name: string): string | undefined {
  return el.attrs?.find((a) => a.name === name)?.value;
}

function matchesCompound(el: P5Element, c: Compound): boolean {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && attr(el, "id") !== c.id) return false;
  if (c.classes.length) {
    const cls = new Set((attr(el, "class") ?? "").split(/\s+/));
    if (!c.classes.every((x) => cls.has(x))) return false;
  }
  for (const a of c.attrs) {
    const v = attr(el, a.name);
    if (v === undefined) return false;
    if (!a.op) continue;
    const want = a.value ?? "";
    if (a.op === "=" && v !== want) return false;
    if (a.op === "^=" && !v.startsWith(want)) return false;
    if (a.op === "*=" && !v.includes(want)) return false;
    if (a.op === "$=" && !v.endsWith(want)) return false;
  }
  return true;
}

/** `ancestors` is ordered outermost → nearest parent */
export function matchesSelector(el: P5Element, ancestors: P5Element[], sel: CompiledSelector): boolean {
  for (const chain of sel) {
    if (!matchesCompound(el, chain[chain.length - 1]!)) continue;
    let ci = chain.length - 2;
    for (let ai = ancestors.length - 1; ai >= 0 && ci >= 0; ai--) {
      if (matchesCompound(ancestors[ai]!, chain[ci]!)) ci--;
    }
    if (ci < 0) return true;
  }
  return false;
}
