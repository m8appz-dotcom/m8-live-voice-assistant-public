import { createDemoServer } from "./server.mjs";

// Keep the same hardened auth, account store, cookies and bounded voice engine.
// Only exported public files belong in root. Never serve the source checkout.
export function createOriginalVoiceServer(options) {
  const server = createDemoServer(options);
  const handler = server.listeners("request")[0];
  server.removeListener("request", handler);
  server.on("request", (req, res) => {
    let url;
    try {
      url = new URL(req.url, options.origin);
    } catch {
      return handler(req, res);
    }
    if (["/", "/live", "/settings"].includes(url.pathname))
      req.url = "/index.html" + url.search;
    else if (url.pathname.startsWith("/workspace/"))
      req.url =
        "/previous-workspace/" +
        url.pathname.slice("/workspace/".length) +
        url.search;
    const writeHead = res.writeHead;
    res.writeHead = function (...args) {
      const csp = res.getHeader("Content-Security-Policy");
      if (csp)
        res.setHeader(
          "Content-Security-Policy",
          csp + "; font-src 'self' data:",
        );
      const type = /\.woff2?(?:\?|$)/.test(req.url)
        ? req.url.includes(".woff2")
          ? "font/woff2"
          : "font/woff"
        : /\.ttf(?:\?|$)/.test(req.url)
          ? "font/ttf"
          : null;
      if (type) {
        const index = typeof args[1] === "object" ? 1 : 2;
        args[index] = { ...args[index], "Content-Type": type };
      }
      return writeHead.apply(this, args);
    };
    return handler(req, res);
  });
  return server;
}
