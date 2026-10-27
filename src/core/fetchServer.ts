import { fetch } from "undici";
import type { FetchServerResult } from "./types.js";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type FetchServerOptions = {
  headers?: Record<string, string>;
  cookie?: string;
  userAgent?: string;
  timeoutMs?: number;
};

/**
 * Raw server HTML (no JS). Uses a browser-like Accept header so CDNs return full HTML.
 */
export async function fetchServer(
  url: string,
  options: FetchServerOptions = {}
): Promise<FetchServerResult> {
  const { headers = {}, cookie, userAgent = DEFAULT_UA, timeoutMs = 60_000 } = options;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "User-Agent": userAgent,
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });

    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "";
    const charsetMatch = /charset=([^;]+)/i.exec(ct);
    const charset = charsetMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "utf-8";

    let html: string;
    try {
      const decoder = new TextDecoder(charset.toLowerCase());
      html = decoder.decode(buf);
    } catch {
      html = buf.toString("utf8");
    }

    return {
      status: res.status,
      html,
      finalUrl: res.url,
    };
  } finally {
    clearTimeout(t);
  }
}
