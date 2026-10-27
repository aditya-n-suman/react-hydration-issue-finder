# React Hydration Comparator

Compares:

1. **Server HTML** (raw response source, JS disabled behavior), and
2. **Hydrated DOM** — `document.documentElement.outerHTML` serialized synchronously inside React's hydration commit (before any `useEffect` or user interaction runs)

Then reports React-hydration-relevant mismatches and captured React hydration errors (including minified `#418` / `#423` signatures).

## How hydration is detected

An init script installs a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__` before any page script runs. Every React build (16+, production or development, bundled or global) reports commits to this hook, so it works for webpack/Next/Vite apps where `ReactDOM` is never on `window`. The first commit of a root that was dehydrated is the hydration commit; the DOM is snapshotted right there, and the diff is scoped to that root's container (e.g. `#root`), so `<head>` and third-party DOM outside the root are never compared.

If no hydration commit is observed (non-React page, or a site that blocks the DevTools hook), the tool falls back to a snapshot after `load` + idle and diffs the whole document. The CLI prints which method was used on the `Hydration:` line.

## Features

- CLI and Web UI on the same core engine.
- DOM-aware diff (not line-based text diff).
- Captures hydration diagnostics from browser console/page errors.
- Suppresses common client-only noise (analytics scripts, CSS-in-JS style tags in `<head>`, extension attrs, `<noscript>` server artifacts).
- Exit code `1` when issues are found (CI-friendly).

## Install

Requires Node.js 20+ (`.nvmrc` pins 22; run `nvm use`).

```bash
npm install
```

If needed for browser runtime:

```bash
npx playwright install chromium
```

## CLI Usage

```bash
npx tsx src/cli/index.ts https://example.com/page
```

Build + run compiled binary:

```bash
npm run build
node dist/cli/index.js https://example.com/page
```

Common options:

```bash
node dist/cli/index.js https://example.com/page --json
node dist/cli/index.js https://example.com/page --report report.html
node dist/cli/index.js https://example.com/page --timeout 30000
node dist/cli/index.js https://example.com/page --header "x-env: stage" --cookie "sid=abc"
node dist/cli/index.js https://example.com/page --ignore-selector ".chat-widget"
node dist/cli/index.js --serve --port 4321
```

## Web UI

Start:

```bash
npm run dev:web
```

Then open:

- [http://127.0.0.1:4321](http://127.0.0.1:4321)

The UI includes:

- URL + timeout + ignore selectors input
- Summary counters
- Mismatch table
- Side-by-side HTML panes with basic highlighting
- Raw React hydration error panel

## Report Shape

`compare(url)` returns:

- `url`, `fetchedAt`, `serverStatus`
- `reactErrors[]`
- `mismatches[]`
- `summary`
- `hydration` — `method` (`react-commit` | `fallback`), `reactVersion`, `reactBuild`, `roots`, `hydratedAtMs`
- `raw.serverHtml` and `raw.clientHtml`

## Tests

```bash
npm test        # domDiff unit tests
npm run test:e2e  # Playwright against real React 18 SSR pages served locally (test/fixtures)
```

Unit tests cover tag/text/attr/missing/extra detection, whitespace and `<!-- -->` separators, sibling alignment (one injected node doesn't cascade), scoping to the hydration root, `--ignore-selector` on both trees, and client-only noise rules.

The e2e suite hydrates real pages with `hydrateRoot` and checks: a clean page (with a post-hydration `useEffect` and DOM noise outside the root) reports nothing; text, tag and extra-child mismatches are each reported once; React `#418` is captured.

## Known Limitations

- The snapshot is taken at each root's *first* hydration commit. Suspense boundaries that are still dehydrated at that point keep their server HTML in the snapshot, so mismatches inside them only show up via captured React errors.
- React 18+ production builds don't patch attribute mismatches (they keep the server value), so attribute differences usually surface only through dev-mode warnings, not the DOM diff.
- `--ignore-selector` supports tag, `#id`, `.class`, `[attr]`, `[attr=|^=|*=|$=value]`, selector lists and descendant combinators.
- Attribute matching is an allow-list approximation of hydration-relevant props.
- Side-by-side highlighter in the web UI is best-effort, not AST-anchored.
- No visual/pixel comparison.
