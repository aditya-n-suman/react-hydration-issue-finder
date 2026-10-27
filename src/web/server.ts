import express from "express";
import { createServer } from "node:http";
import path, { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compare } from "../core/compare.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startWebServer(port = 4321): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const publicDir = join(__dirname, "public");
  app.use(express.static(publicDir));

  app.post("/api/compare", async (req, res) => {
    try {
      const url = typeof req.body?.url === "string" ? req.body.url : "";
      if (!url || !/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: "Invalid or missing url" });
        return;
      }
      const timeoutMs =
        typeof req.body?.timeoutMs === "number" ? req.body.timeoutMs : Number(req.body?.timeoutMs) || 60_000;
      const ignoreSelectors = Array.isArray(req.body?.ignoreSelectors)
        ? req.body.ignoreSelectors.filter((x: unknown) => typeof x === "string")
        : [];
      const headers =
        req.body?.headers && typeof req.body.headers === "object" && !Array.isArray(req.body.headers)
          ? (req.body.headers as Record<string, string>)
          : {};
      const cookie = typeof req.body?.cookie === "string" ? req.body.cookie : undefined;

      const report = await compare(url, { timeoutMs, ignoreSelectors, headers, cookie });
      res.json(report);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.on("error", reject);
  });

  // eslint-disable-next-line no-console
  console.log(`Hydration comparator UI: http://127.0.0.1:${port}`);
}

/** CLI: `node dist/web/server.js` */
const entry = process.argv[1];
const isMainModule =
  Boolean(entry) && pathToFileURL(path.resolve(entry!)).href === import.meta.url;

if (isMainModule) {
  const port = Number(process.env.PORT) || 4321;
  startWebServer(port).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
