import { chromium, type Page } from "playwright";
import { HYDRATION_SIGNAL_SOURCE } from "./hydrationSignal.js";
import { captureReactHydrationErrors } from "./reactErrors.js";
import type { FetchClientResult, HydratedRoot } from "./types.js";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type FetchClientOptions = {
  headers?: Record<string, string>;
  cookie?: string;
  userAgent?: string;
  timeoutMs?: number;
};

type HydrationCmpState = {
  renderers: { version: string | null; bundleType: number }[];
  roots: HydratedRoot[];
  fallbackDone: boolean;
};

/**
 * Wait until React reports a hydration commit (snapshot already captured in-page),
 * or the non-React fallback fires. Then give late roots / recoverable-error logging
 * a short window to land.
 */
async function waitForHydration(page: Page, timeoutMs: number): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const s = (window as unknown as { __hydrationCmp?: HydrationCmpState }).__hydrationCmp;
        return Boolean(s && (s.roots.length > 0 || s.fallbackDone));
      },
      undefined,
      { timeout: timeoutMs, polling: 100 }
    )
    .catch(() => {});
  await page.waitForLoadState("load", { timeout: Math.min(timeoutMs, 30_000) }).catch(() => {});
  // String form: tsx/esbuild wraps named inner functions in a `__name` helper that
  // doesn't exist in the page.
  await page.evaluate(`new Promise((r) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => setTimeout(r, 1500), { timeout: 3000 });
    else setTimeout(r, 1500);
  })`);
}

/**
 * Load URL in Chromium and return the DOM as it was at React's hydration commit
 * (or after load + idle when no React hydration is observed).
 */
export async function fetchClient(
  url: string,
  options: FetchClientOptions = {}
): Promise<FetchClientResult> {
  const {
    headers = {},
    cookie,
    userAgent = DEFAULT_UA,
    timeoutMs = 60_000,
  } = options;

  const { errors: reactErrors, attachToPage } = captureReactHydrationErrors();

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent,
      extraHTTPHeaders: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });
    const page = await context.newPage();
    attachToPage(page);
    await page.addInitScript(HYDRATION_SIGNAL_SOURCE);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    await waitForHydration(page, timeoutMs);

    const state = await page.evaluate(
      () => (window as unknown as { __hydrationCmp?: HydrationCmpState }).__hydrationCmp ?? null
    );
    const roots = state?.roots ?? [];
    // Prefer the DOM as React left it at the hydration commit; otherwise the settled DOM.
    const html =
      roots[0]?.html || (await page.evaluate(() => document.documentElement?.outerHTML ?? ""));
    const finalUrl = page.url();
    const renderer = state?.renderers[0];

    await context.close();

    return {
      html,
      finalUrl,
      reactErrors,
      roots,
      reactVersion: renderer?.version ?? undefined,
      reactBuild: renderer ? (renderer.bundleType === 1 ? "development" : "production") : undefined,
    };
  } finally {
    await browser.close();
  }
}
