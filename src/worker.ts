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

// Add this type to distinguish between route types
type RouteMatch = {
  targetUrl: URL;
  type: "proxy" | "redirect";
};

export function computeRedirectTarget(
  url: URL,
  routes: RouteConfig
): RouteMatch | null {
  const matchingRoute = Object.entries(routes).find(([path, target]) => {
    if (target.startsWith("proxy:")) {
      // For proxy routes, allow subpaths
      return (
        url.pathname === path ||
        (url.pathname.startsWith(path) && url.pathname[path.length] === "/")
      );
    }
    // For redirects (with or without 302: prefix), require exact match
    return url.pathname === path;
  });

  if (!matchingRoute) {
    return null;
  }

  const [routePath, targetUrl] = matchingRoute;
  const isProxy = targetUrl.startsWith("proxy:");
  const finalTargetUrl = isProxy
    ? targetUrl.slice(6)
    : targetUrl.startsWith("302:")
    ? targetUrl.slice(4)
    : targetUrl;
  const targetURL = new URL(finalTargetUrl);

  if (!isProxy) {
    const finalURL = new URL(targetURL);
    finalURL.search = url.search;
    return {
      targetUrl: finalURL,
      type: "redirect",
    };
  }

  const remainingPath = url.pathname.slice(routePath.length);
  const finalPath =
    targetURL.pathname === "/"
      ? remainingPath || "/"
      : targetURL.pathname + (remainingPath || "");

  const finalURL = new URL(finalPath, targetURL.origin);
  finalURL.search = url.search;

  return {
    targetUrl: finalURL,
    type: "proxy",
  };
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
    const match = computeRedirectTarget(url, routes);

    if (!match) {
      return null;
    }

    // Handle external redirects
    if (match.type === "redirect") {
      return Response.redirect(match.targetUrl.toString(), 302);
    }

    // Find the matching route path for internal redirects
    const routePath =
      Object.entries(routes).find(([path]) =>
        url.pathname.startsWith(path)
      )?.[0] || "";

    const modifiedRequest = new Request(match.targetUrl.toString(), {
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
        .on("*", new AttributeRewriter(routePath, url, match.targetUrl))
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
