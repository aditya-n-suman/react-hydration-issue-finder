import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import React from "react";
import { renderToString } from "react-dom/server";

/**
 * Real React 18 SSR + hydrateRoot pages for end-to-end tests. Each scenario's App is
 * one JS source string evaluated on both sides with `isServer` flipped, so mismatches
 * are exactly the ones written into the scenario.
 */
const SCENARIOS: Record<string, string> = {
  // No mismatch; a useEffect rewrites text after hydration and must NOT be reported.
  clean: `
    function App(p) {
      var s = React.useState('before effect'), v = s[0], set = s[1];
      React.useEffect(function () { set('after effect'); }, []);
      return h('main', null,
        h('h1', { id: 'title' }, 'Hello'),
        h('p', { className: 'status' }, v),
        h('ul', null, h('li', null, 'a'), h('li', null, 'b')));
    }`,
  text: `
    function App(p) {
      return h('main', null,
        h('h1', null, p.isServer ? 'Rendered on server' : 'Rendered on client'),
        h('p', null, 'stable'));
    }`,
  tag: `
    function App(p) {
      return h('main', null, p.isServer ? h('h2', null, 'Title') : h('h3', null, 'Title'), h('p', null, 'x'));
    }`,
  extra: `
    function App(p) {
      var items = p.isServer ? ['a', 'b'] : ['a', 'b', 'c'];
      return h('ul', null, items.map(function (x) { return h('li', { key: x }, x); }));
    }`,
};

// UMD builds aren't in the packages' "exports" map, so resolve them via package.json.
const require = createRequire(import.meta.url);
const umd = (pkg: string, file: string) =>
  readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), "umd", file), "utf8");
const reactUmd = umd("react", "react.production.min.js");
const reactDomUmd = umd("react-dom", "react-dom.production.min.js");

function buildApp(src: string): (p: { isServer: boolean }) => React.ReactElement {
  return new Function("React", "h", `${src}; return App;`)(React, React.createElement);
}

function page(name: string, src: string): string {
  const App = buildApp(src);
  const markup = renderToString(React.createElement(App, { isServer: true }));
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <script src="/react.js"></script>
  <script src="/react-dom.js"></script>
</head>
<body>
  <div id="root">${markup}</div>
  <script>
    // Third-party style DOM noise outside the React root: must not be reported.
    document.head.appendChild(document.createElement('style')).textContent = '.x{}';
    var banner = document.createElement('div'); banner.className = 'cookie-banner'; banner.textContent = 'cookies';
    document.body.insertBefore(banner, document.body.firstChild);
    var h = React.createElement;
    ${src}
    window.addEventListener('load', function () {
      ReactDOM.hydrateRoot(document.getElementById('root'), h(App, { isServer: false }));
    });
  </script>
</body>
</html>`;
}

export async function startFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.get("/react.js", (_req, res) => res.type("js").send(reactUmd));
  app.get("/react-dom.js", (_req, res) => res.type("js").send(reactDomUmd));
  for (const [name, src] of Object.entries(SCENARIOS)) {
    const html = page(name, src);
    app.get(`/${name}`, (_req, res) => res.type("html").send(html));
  }
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
