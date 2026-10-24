import page from "./index.html";
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ ok: true, runtime: "cloudflare-workers" });
    if (url.pathname === "/api/inspect" || url.pathname === "/api/download")
      return Response.json({ detail: "Direct caption extraction is not available on Cloudflare Workers yet. You can convert an existing subtitle file using the form." }, { status: 501 });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : page, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'" }
    });
  }
};