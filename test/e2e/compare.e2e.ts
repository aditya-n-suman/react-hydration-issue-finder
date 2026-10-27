import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { compare } from "../../src/core/compare.js";
import type { Report } from "../../src/core/types.js";
import { startFixtureServer } from "../fixtures/reactSsrServer.js";

let baseUrl = "";
let close: () => Promise<void> = async () => {};

before(async () => {
  ({ baseUrl, close } = await startFixtureServer());
});
after(() => close());

const run = (name: string): Promise<Report> => compare(`${baseUrl}/${name}`, { timeoutMs: 30_000 });

describe("compare() against real React 18 SSR pages", { timeout: 120_000 }, () => {
  it("clean page: no mismatches, snapshot taken at the hydration commit (before useEffect)", async () => {
    const r = await run("clean");
    assert.equal(r.hydration.method, "react-commit");
    assert.equal(r.hydration.reactVersion?.startsWith("18."), true);
    assert.deepEqual(r.hydration.roots, ["#root"]);
    assert.deepEqual(r.mismatches, []);
    assert.equal(r.reactErrors.length, 0);
    assert.match(r.raw.clientHtml, /before effect/);
  });

  it("text mismatch: reported structurally and React #418 is captured", async () => {
    const r = await run("text");
    const text = r.mismatches.filter((m) => m.kind === "text");
    assert.equal(text.length, 1, JSON.stringify(r.mismatches));
    assert.equal(text[0]!.kind === "text" && text[0]!.server, "Rendered on server");
    assert.equal(text[0]!.kind === "text" && text[0]!.client, "Rendered on client");
    assert.equal(r.reactErrors.some((e) => /418|423|425/.test(e.message)), true, JSON.stringify(r.reactErrors));
  });

  it("tag mismatch is reported with a usable selector", async () => {
    const r = await run("tag");
    const tag = r.mismatches.filter((m) => m.kind === "tag");
    assert.equal(tag.length, 1, JSON.stringify(r.mismatches));
    assert.equal(tag[0]!.selector.startsWith("#root"), true, tag[0]!.selector);
    // h2 → h3 must not cascade into a bogus mismatch on the following <p>
    assert.equal(r.mismatches.length, 1, JSON.stringify(r.mismatches));
  });

  it("extra client child is reported once", async () => {
    const r = await run("extra");
    assert.deepEqual(
      r.mismatches.map((m) => m.kind),
      ["extraChild"]
    );
  });
});
