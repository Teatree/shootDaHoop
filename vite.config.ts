import { defineConfig, type Plugin } from "vite";
import { injectShareMeta } from "./src/shared/shareMeta";

// One job: the share-link preview. A shared invite carries ?need=&hoop=
// (stamped at share time) and the og:description must echo it - chat
// apps fetch the URL to build the preview, so the rewrite has to happen
// wherever index.html is SERVED. In dev that's this plugin; production
// has no HTTP layer yet (server/ is WebSocket-only), and whoever builds
// one must run the same injectShareMeta over the built index.html.

function shareMetaPlugin(): Plugin {
  return {
    name: "share-meta",
    transformIndexHtml(html, ctx) {
      const q = ctx.originalUrl?.split("?")[1];
      return q ? injectShareMeta(html, q) : html;
    },
  };
}

export default defineConfig({
  plugins: [shareMetaPlugin()],
});
