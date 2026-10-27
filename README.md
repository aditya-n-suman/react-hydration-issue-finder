# React Hydration Comparator

Compares:

1. **Server HTML** (raw response source, JS disabled behavior), and
2. **Initial hydrated DOM** (`document.documentElement.outerHTML` after hydration settle, without user interaction)

Then reports React-hydration-relevant mismatches and captured React hydration errors (including minified `#418` / `#423` signatures).

## Features

- CLI and Web UI on the same core engine.
- DOM-aware diff (not line-based text diff).
- Captures hydration diagnostics from browser console/page errors.
- Suppresses common client-only noise (analytics scripts, CSS-in-JS style tags in `<head>`, extension attrs, `<noscript>` server artifacts).
- Exit code `1` when issues are found (CI-friendly).

## Install

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
- `raw.serverHtml` and `raw.clientHtml`

## Tests

```bash
npm test
```

Current tests cover:

- tag mismatch
- text mismatch
- attribute mismatch normalization (`class`, `style`)
- extra child detection
- ignore rules for common client-only noise

## Known Limitations

- Uses heuristics for hydration completion in generic React apps.
- Attribute matching is an allow-list approximation of hydration-relevant props.
- Side-by-side highlighter in the web UI is best-effort, not AST-anchored.
- No visual/pixel comparison.
