/// <reference types="@cloudflare/workers-types" />

interface RouteConfig {
  [path: string]: string;
}

const ROUTES: RouteConfig = {
  "/tone-curve": "http://tone-curve.underconstruction.fun",
  "/claude-chat-viewer": "https://underconstruction.fun/claude-chat-viewer",
  "/dialog-explorer": "https://dialog-explorer.underconstruction.fun",
  "/shutterspeak": "https://shutterspeak.underconstruction.fun",
};

export function computeRedirectTarget(url: URL): URL | null {
  const matchingRoute = Object.entries(ROUTES).find(
    ([path]) =>
      url.pathname === path ||
      (url.pathname.startsWith(path) && url.pathname[path.length] === "/")
  );

  if (!matchingRoute) {
    return null;
  }

  const [routePath, targetUrl] = matchingRoute;
  const targetURL = new URL(targetUrl);

  const remainingPath = url.pathname.slice(routePath.length);
  const finalPath =
    targetURL.pathname === "/"
      ? remainingPath || "/"
      : targetURL.pathname + (remainingPath || "");

  const finalURL = new URL(finalPath, targetURL.origin);
  finalURL.search = url.search;

  return finalURL;
}

export async function handleRequest(
  request: Request
): Promise<Response | null> {
  try {
    const url = new URL(request.url);
    const redirectTarget = computeRedirectTarget(url);

    if (!redirectTarget) {
      return null;
    }

    const modifiedRequest = new Request(redirectTarget.toString(), {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
    });

    modifiedRequest.headers.delete("host");

    const response = await fetch(modifiedRequest);
    const newHeaders = new Headers(response.headers);

    // Only set cache headers if they're not already present
    if (!response.headers.has("Cache-Control")) {
      const contentType = response.headers.get("content-type") || "";
      const isHtml =
        contentType.toLowerCase().includes("text/html") ||
        contentType.toLowerCase().includes("application/xhtml+xml") ||
        url.pathname.toLowerCase().endsWith(".html");

      if (isHtml) {
        newHeaders.set("Cache-Control", "no-cache");
      } else {
        newHeaders.set("Cache-Control", "public, max-age=31536000");
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    return new Response(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      { status: 500 }
    );
  }
}

addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(
    handleRequest(event.request).then(
      (response) => response || fetch(event.request)
    )
  );
});
