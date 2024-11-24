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

class AttributeRewriter {
  constructor(
    private sourcePath: string,
    private sourceUrl: URL,
    private targetUrl: URL
  ) {}

  // Rewrite absolute URLs from target back to source
  private rewriteAbsoluteUrl(url: string): string {
    if (url.startsWith(this.targetUrl.origin)) {
      const path = url.slice(this.targetUrl.origin.length);
      return `${this.sourceUrl.origin}${this.sourcePath}${path}`;
    }
    return url;
  }

  // Rewrite relative URLs to include the source path prefix
  private rewriteRelativeUrl(url: string): string {
    if (url.startsWith("/")) {
      return `${this.sourcePath}${url}`;
    }
    return url;
  }

  element(element: Element) {
    // Handle href attributes
    const href = element.getAttribute("href");
    if (href) {
      try {
        // Check if it's an absolute URL
        new URL(href);
        element.setAttribute("href", this.rewriteAbsoluteUrl(href));
      } catch {
        // If URL parsing fails, treat as relative
        element.setAttribute("href", this.rewriteRelativeUrl(href));
      }
    }

    // Handle src attributes
    const src = element.getAttribute("src");
    if (src) {
      try {
        new URL(src);
        element.setAttribute("src", this.rewriteAbsoluteUrl(src));
      } catch {
        element.setAttribute("src", this.rewriteRelativeUrl(src));
      }
    }

    // Handle meta tags with content attribute
    if (element.tagName === "meta") {
      const content = element.getAttribute("content");
      if (content) {
        try {
          new URL(content);
          element.setAttribute("content", this.rewriteAbsoluteUrl(content));
        } catch {
          // If not a URL, leave it unchanged
        }
      }
    }
  }
}

class BaseTagInjector {
  constructor(private basePath: string) {}

  element(element: Element) {
    // Only process the <head> element
    if (element.tagName === "head") {
      const baseTag = `<base href="${this.basePath}${
        this.basePath.endsWith("/") ? "" : "/"
      }">`;

      // Use true for the html option to indicate this is raw HTML
      element.prepend(baseTag, { html: true });
    }
  }
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

    // Find the matching route path
    const routePath =
      Object.entries(routes).find(([path]) =>
        url.pathname.startsWith(path)
      )?.[0] || "";

    const modifiedRequest = new Request(redirectTarget.toString(), {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
    });

    modifiedRequest.headers.delete("host");

    const response = await fetch(modifiedRequest);
    const newHeaders = new Headers(response.headers);

    const contentType = response.headers.get("content-type") || "";
    const isHtml =
      contentType.toLowerCase().includes("text/html") ||
      contentType.toLowerCase().includes("application/xhtml+xml") ||
      url.pathname.toLowerCase().endsWith(".html");

    if (!response.headers.has("Cache-Control")) {
      if (isHtml) {
        newHeaders.set("Cache-Control", "no-cache");
      } else {
        newHeaders.set("Cache-Control", "public, max-age=31536000");
      }
    }

    // If it's HTML content, transform it
    if (isHtml) {
      const rewriter = new HTMLRewriter()
        .on("*", new AttributeRewriter(routePath, url, redirectTarget))
        .on("head", new BaseTagInjector(routePath));

      const transformedResponse = rewriter.transform(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        })
      );

      return transformedResponse;
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
