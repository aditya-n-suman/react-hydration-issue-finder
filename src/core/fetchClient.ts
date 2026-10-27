import { chromium, type Page } from "playwright";
import { HYDRATION_SIGNAL_SOURCE } from "./hydrationSignal.js";
import { captureReactHydrationErrors } from "./reactErrors.js";
import type { FetchClientResult, ReactHydrationError } from "./types.js";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type FetchClientOptions = {
  headers?: Record<string, string>;
  cookie?: string;
  userAgent?: string;
  timeoutMs?: number;
  ignoreSelectors?: string[];
};

async function waitForHydrationSnapshot(page: Page, timeoutMs: number): Promise<void> {
  const budget = Math.min(timeoutMs, 120_000);
  await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          __hydrationCmpPromise?: Promise<unknown>;
        };
        return Boolean(w.__hydrationCmpPromise);
      },
      { timeout: 5000 }
    )
    .catch(() => {});

  await page
    .waitForFunction(
      () => {
        const w = window as unknown as { __hydrationCmpDone?: unknown };
        return Boolean(w.__hydrationCmpDone);
      },
      { timeout: budget }
    )
    .catch(async () => {
      await page.waitForLoadState("networkidle", { timeout: Math.min(budget, 30_000) }).catch(() => {});
    });

  await page.evaluate(async () => {
    const w = window as unknown as { __hydrationCmpPromise?: Promise<unknown> };
    if (w.__hydrationCmpPromise) {
      try {
        await Promise.race([
          w.__hydrationCmpPromise,
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((r) => {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => r(), { timeout: 2000 });
      } else {
        setTimeout(() => r(), 200);
      }
    });
    await new Promise<void>((r) => {
      requestAnimationFrame(() => requestAnimationFrame(() => r()));
    });
    await new Promise((r) => setTimeout(r, 400));
  });
}

/**
 * Load URL in Chromium, wait for hydration heuristics, return documentElement.outerHTML.
 */
export async function fetchClient(
  url: string,
  options: FetchClientOptions = {}
): Promise<FetchClientResult & { reactErrors: ReactHydrationError[] }> {
  const {
    headers = {},
    cookie,
    userAgent = DEFAULT_UA,
    timeoutMs = 60_000,
    ignoreSelectors = [],
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

    await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {});
    await waitForHydrationSnapshot(page, timeoutMs);

    if (ignoreSelectors.length > 0) {
      await page.evaluate((selectors: string[]) => {
        for (const sel of selectors) {
          try {
            document.querySelectorAll(sel).forEach((el: Element) => el.remove());
          } catch {
            /* invalid selector */
          }
        }
      }, ignoreSelectors);
    }

    const html = await page.evaluate(() => document.documentElement?.outerHTML ?? "");
    const finalUrl = page.url();

    await context.close();

    return {
      html,
      finalUrl,
      reactErrors,
    };
  } finally {
    await browser.close();
  }
}
