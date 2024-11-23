/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ROUTES: string;
}

interface RouteConfig {
  [path: string]: string;
}

function getRoutes(env: Env): RouteConfig {
  try {
    return JSON.parse(env.ROUTES);
  } catch (e) {
    console.error("Failed to parse ROUTES:", e);
    return {};
  }
}

export function computeRedirectTarget(
  url: URL,
  routes: RouteConfig
): URL | null {
  const matchingRoute = Object.entries(routes).find(
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
  request: Request,
  env: Env
): Promise<Response | null> {
  try {
    const url = new URL(request.url);
    const routes = getRoutes(env);
    const redirectTarget = computeRedirectTarget(url, routes);

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await handleRequest(request, env);
    return response || (await fetch(request));
  },
};
