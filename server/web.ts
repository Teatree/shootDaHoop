import { createServer, type Server } from "http";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { gzipSync } from "zlib";
import { injectShareMeta } from "../src/shared/shareMeta";

// The HTTP face of the game server (deploy ask 2026-07-17): ONE render.com
// web service serves the built client AND speaks WebSocket on the same
// port (index.ts attaches the WebSocketServer to this server). In dev
// nothing changes - vite serves the client and this only answers a
// friendly note if someone opens :9999 in a browser.
//
// index.html is served through shared/shareMeta.ts, so a shared invite's
// ?need=&hoop= progress lands in the link preview - the same helper the
// vite dev plugin uses (vite.config.ts).

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
};

// text assets shrink ~4x under gzip; media formats are already compressed
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg"]);

/**
 * A minimal static server over `distDir`. No client build present (dev)
 * -> every request gets a plain-text pointer instead of a broken page.
 */
export function createWebServer(distDir: string): Server {
  const root = path.resolve(distDir);
  // gzipped-once cache for the (hashed, immutable) build files - the JS
  // bundle is ~1.6 MB raw vs ~380 KB gzipped, and re-deploys restart the
  // process, so a plain path key never goes stale
  const gzCache = new Map<string, Buffer>();

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      // resolve inside dist only - a traversal lands on the index below
      const rel = path
        .normalize(decodeURIComponent(url.pathname))
        .replace(/^([/\\]|\.\.)+/, "");
      const file = path.join(root, rel);

      const isFile =
        file.startsWith(root) &&
        path.extname(file) !== "" &&
        (await fs.stat(file).catch(() => null))?.isFile();

      const wantsGzip = /\bgzip\b/.test(
        String(req.headers["accept-encoding"] ?? ""),
      );

      if (isFile && !file.endsWith(".html")) {
        const ext = path.extname(file);
        const headers: Record<string, string> = {
          "content-type": MIME[ext] ?? "application/octet-stream",
          // vite hashes asset filenames - long cache is safe; media isn't
          // hashed but changes rarely
          "cache-control": "public, max-age=3600",
        };
        if (wantsGzip && COMPRESSIBLE.has(ext)) {
          let gz = gzCache.get(file);
          if (!gz) {
            gz = gzipSync(await fs.readFile(file));
            gzCache.set(file, gz);
          }
          headers["content-encoding"] = "gzip";
          headers["vary"] = "accept-encoding";
          res.writeHead(200, headers);
          res.end(gz);
          return;
        }
        res.writeHead(200, headers);
        createReadStream(file).pipe(res);
        return;
      }

      // everything else is the game page (also render's health check)
      const html = await fs
        .readFile(path.join(root, "index.html"), "utf8")
        .catch(() => null);
      if (html === null) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(
          "shootDaHoop game server is running.\n" +
            "No client build found - run `npm run build` first " +
            "(in dev, vite serves the client instead).\n",
        );
        return;
      }
      const page = injectShareMeta(html, url.search);
      const pageHeaders: Record<string, string> = {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache", // the entry must pick up new deploys
      };
      if (wantsGzip) {
        // NOT cached: the og:meta injection varies with the query string
        pageHeaders["content-encoding"] = "gzip";
        pageHeaders["vary"] = "accept-encoding";
        res.writeHead(200, pageHeaders);
        res.end(gzipSync(page));
        return;
      }
      res.writeHead(200, pageHeaders);
      res.end(page);
    })().catch((err) => {
      console.error("web request failed:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
