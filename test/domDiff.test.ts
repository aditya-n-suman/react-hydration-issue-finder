import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { domDiff } from "../src/core/domDiff.js";

describe("domDiff", () => {
  it("detects text mismatch", () => {
    const server = `<!doctype html><html><body><div id="root"><h1>Hello</h1></div></body></html>`;
    const client = `<!doctype html><html><body><div id="root"><h1>Hello world</h1></div></body></html>`;
    const { mismatches } = domDiff(server, client);
    assert.equal(mismatches.some((m) => m.kind === "text"), true);
  });

  it("detects tag mismatch", () => {
    const server = `<!doctype html><html><body><main><h1>A</h1></main></body></html>`;
    const client = `<!doctype html><html><body><main><p>A</p></main></body></html>`;
    const { mismatches } = domDiff(server, client);
    assert.equal(mismatches.some((m) => m.kind === "tag"), true);
  });

  it("detects attribute mismatch and normalizes class/style ordering", () => {
    const server = `<!doctype html><html><body><div class="a b" style="color:red; margin: 0" data-x="1"></div></body></html>`;
    const client = `<!doctype html><html><body><div class="b a" style="margin:0;color:red" data-x="2"></div></body></html>`;
    const { mismatches } = domDiff(server, client);
    const attr = mismatches.filter((m) => m.kind === "attr");
    assert.equal(attr.some((m) => m.kind === "attr" && m.attr === "data-x"), true);
    assert.equal(attr.some((m) => m.kind === "attr" && m.attr === "class"), false);
    assert.equal(attr.some((m) => m.kind === "attr" && m.attr === "style"), false);
  });

  it("detects missing and extra children", () => {
    const server = `<!doctype html><html><body><ul><li>1</li><li>2</li></ul></body></html>`;
    const client = `<!doctype html><html><body><ul><li>1</li><li>2</li><li>3</li></ul></body></html>`;
    const { mismatches } = domDiff(server, client);
    assert.equal(mismatches.some((m) => m.kind === "extraChild"), true);

    const { mismatches: missing } = domDiff(client, server);
    assert.deepEqual(missing.map((m) => m.kind), ["missingChild"]);
  });

  it("ignores whitespace-only text and comment separators between nodes", () => {
    const server = `<!doctype html><html><head></head>\n  <body>\n<div id="root"><p>a<!-- -->b</p></div></body></html>`;
    const client = `<!doctype html><html><head></head><body><div id="root"><p>ab</p></div></body></html>`;
    assert.deepEqual(domDiff(server, client).mismatches, []);
  });

  it("an injected sibling does not cascade into mismatches for every following node", () => {
    const server = `<!doctype html><html><body><main><h1>T</h1><p>1</p><p>2</p><p>3</p></main></body></html>`;
    const client = `<!doctype html><html><body><main><div class="ad">x</div><h1>T</h1><p>1</p><p>2</p><p>3</p></main></body></html>`;
    const { mismatches } = domDiff(server, client);
    assert.deepEqual(mismatches.map((m) => m.kind), ["extraChild"]);
  });

  it("scopes the diff to the hydration root", () => {
    const server = `<!doctype html><html><head><title>a</title></head><body><header>x</header><div id="root"><h1>Hi</h1></div></body></html>`;
    const client = `<!doctype html><html><head><title>b</title><style>.x{}</style></head><body><div class="banner"></div><header>y</header><div id="root"><h1>Hello</h1></div></body></html>`;
    const { mismatches } = domDiff(server, client, { roots: [{ selector: "#root", path: "html > body[0] > div[0]" }] });
    assert.deepEqual(
      mismatches.map((m) => [m.kind, m.path]),
      [["text", "html > body[0] > div[0] > h1[0] > #text[0]"]]
    );
  });

  it("ignoreSelectors drop matching subtrees on both sides", () => {
    const server = `<!doctype html><html><body><div id="root"><aside class="widget"><b>s</b></aside><p>ok</p></div></body></html>`;
    const client = `<!doctype html><html><body><div id="root"><p>ok</p><div data-ad="1">x</div></div></body></html>`;
    assert.equal(domDiff(server, client).mismatches.length > 0, true);
    const { mismatches } = domDiff(server, client, { ignoreSelectors: ["#root .widget", "[data-ad]"] });
    assert.deepEqual(mismatches, []);
  });

  it("suppresses known client-only noise (head style/script injections and noscript)", () => {
    const server = `<!doctype html><html><head><meta charset="utf-8"/></head><body><noscript>no js</noscript><div id="app">ok</div></body></html>`;
    const client =
      `<!doctype html><html><head><meta charset="utf-8"/>` +
      `<style data-emotion="x y">.x{}</style>` +
      `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-1"></script>` +
      `</head><body><div id="app">ok</div></body></html>`;
    const { mismatches } = domDiff(server, client);
    assert.deepEqual(mismatches, []);
  });

  it("enrichment fields are present with placeholder values", () => {
    const server = `<!doctype html><html><body><div>A</div></body></html>`;
    const client = `<!doctype html><html><body><div>B</div></body></html>`;
    const { mismatches, serverDoc, clientDoc } = domDiff(server, client);
    assert.ok(mismatches.length > 0);
    assert.ok(serverDoc);
    assert.ok(clientDoc);
    for (const m of mismatches) {
      assert.equal(typeof m.selector, "string");
      assert.equal(typeof m.severity, "string");
    }
  });
});

