import type { ReactHydrationError } from "./types.js";

const PROD_CODES = ["#418", "#423", "error #418", "error #423", "invariant=418", "invariant=423"];

const DEV_PATTERNS = [
  /hydration failed/i,
  /text content did not match/i,
  /expected server html to contain/i,
  /did not expect server html to contain/i,
  /prop `[^`]+` did not match/i,
  /dangerouslysetinnerhtml/i,
  /suppresshydrationwarning/i,
];

export function isReactHydrationMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  for (const code of PROD_CODES) {
    if (m.includes(code)) return true;
  }
  for (const re of DEV_PATTERNS) {
    if (re.test(m)) return true;
  }
  return false;
}

export function captureReactHydrationErrors(): {
  errors: ReactHydrationError[];
  attachToPage: (page: import("playwright").Page) => void;
} {
  const errors: ReactHydrationError[] = [];

  function attachToPage(page: import("playwright").Page): void {
    page.on("console", (msg) => {
      const text = msg.text();
      if (!isReactHydrationMessage(text)) return;
      errors.push({
        source: "console",
        level: msg.type(),
        message: text,
        stack: msg.location()
          ? `${msg.location().url}:${msg.location().lineNumber}:${msg.location().columnNumber}`
          : undefined,
      });
    });

    page.on("pageerror", (err) => {
      const text = err.message ?? String(err);
      if (!isReactHydrationMessage(text)) return;
      errors.push({
        source: "pageerror",
        message: text,
        stack: err.stack,
      });
    });
  }

  return { errors, attachToPage };
}
