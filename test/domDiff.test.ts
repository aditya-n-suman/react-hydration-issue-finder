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

