/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ROUTES: string;
  CACHE_IMAGES?: string;
}

interface RouteConfig {
  [path: string]: string;
}

interface CacheConfig {
  cacheImages: boolean;
}

function getCacheConfig(env: Env, routePath: string): CacheConfig {
  // Check if image caching is enabled for this route
  let cacheImages = false;
  
  if (env.CACHE_IMAGES) {
    try {
      const cacheImageRoutes = JSON.parse(env.CACHE_IMAGES);
      // Check if this specific route has image caching enabled
      if (Array.isArray(cacheImageRoutes)) {
        // Match with wildcard support
        cacheImages = cacheImageRoutes.some(route => {
          // Normalize the route path for comparison (add wildcard back if it was removed)
          const normalizedRoutePath = routePath.endsWith('/*') ? routePath : 
                                     routePath + '/*';
          return route === normalizedRoutePath || route === routePath;
        });
      } else if (typeof cacheImageRoutes === 'boolean') {
        cacheImages = cacheImageRoutes;
      }
    } catch {
      // Invalid JSON, default to false
      cacheImages = false;
    }
  }
  
  return { cacheImages };
}

// Function to detect if a file has a content hash in its name
function hasContentHash(pathname: string): boolean {
  // Match patterns like:
  // - index-353f0761.js
  // - app-ff860190.css
  // - main.a1b2c3d4.js
  // - style.12345678.css
  // Common hash patterns: 8-10 hex chars, or base64-like patterns
  const hashPatterns = [
    /[.-][0-9a-f]{8,}\.(js|css)$/i,  // hex hash
    /[.-][0-9a-zA-Z]{8,}\.(js|css)$/i, // base64-like hash
  ];
  
  return hashPatterns.some(pattern => pattern.test(pathname));
}

// Function to check if a file is an image
function isImageFile(pathname: string): boolean {
  const imageExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.ico', '.bmp', '.avif', '.tiff', '.tif'
  ];
  
  const lowercasePath = pathname.toLowerCase();
  return imageExtensions.some(ext => lowercasePath.endsWith(ext));
}

function validateRoutes(routes: RouteConfig): void {
  Object.entries(routes).forEach(([path, target]) => {
    if (!path.startsWith('/')) {
      throw new Error(`Invalid route path: ${path} - must start with '/'`);
    }
    
    // Validate target URL format
    const targetUrl = target.startsWith('proxy:') 
      ? target.slice(6) 
      : target.startsWith('302:') 
      ? target.slice(4)
      : target;
    
    // Check if target contains wildcard when path contains wildcard
    if (path.endsWith('/*') && !targetUrl.includes('/*')) {
      console.warn(`Route ${path} has wildcard but target ${target} does not`);
    }
    
    // Validate target URL is valid
    try {
      if (targetUrl.includes('/*')) {
        new URL(targetUrl.replace('/*', ''));
      } else {
        new URL(targetUrl);
      }
    } catch {
      // Any error from URL constructor means invalid URL
      throw new Error(`Invalid target URL for route ${path}: ${target}`);
    }
  });
}

function getRoutes(env: Env): RouteConfig {
  let routes: RouteConfig;
  
  // Parse the JSON routes configuration
  try {
    routes = JSON.parse(env.ROUTES);
  } catch (e) {
    console.error("Failed to parse ROUTES:", e);
    return {};
  }
  
  // Separate try/catch for validation
  try {
    validateRoutes(routes);
    return routes;
  } catch (e) {
    console.error("Invalid route configuration:", e);
    return {};
  }
}

// Add this type to distinguish between route types
type RouteMatch = {
  targetUrl: URL;
  type: "proxy" | "redirect";
};

function matchesRoutePath(pathname: string, routePath: string): boolean {
  const pathPattern = routePath.endsWith("/*") ? routePath.slice(0, -2) : routePath;
  
  if (routePath.endsWith("/*")) {
    // For wildcard paths, match the prefix or exact path (treating /path same as /path/)
    return (
      pathname === pathPattern ||
      pathname === pathPattern + "/" ||
      pathname.startsWith(pathPattern + "/")
    );
  }
  // For exact paths, require exact match
  return pathname === routePath;
}

function extractRemainingPath(pathname: string, routePath: string): string {
  const pathPattern = routePath.endsWith("/*")
    ? routePath.slice(0, -2)
    : routePath;
  
  if (pathname === pathPattern) {
    return "/";
  }
  if (pathname === pathPattern + "/") {
    return "/";
  }
  return pathname.slice(pathPattern.length);
}

function parseTargetUrl(target: string): { url: string; isProxy: boolean } {
  const isProxy = target.startsWith("proxy:");
  const url = isProxy
    ? target.slice(6)
    : target.startsWith("302:")
    ? target.slice(4)
    : target;
  
  return { url, isProxy };
}

function buildTargetUrl(targetPattern: string, remainingPath: string): URL {
  if (targetPattern.includes("/*")) {
    const baseTargetUrl = targetPattern.replace("/*", "");
    const targetURL = new URL(baseTargetUrl);
    
    const finalPath =
      targetURL.pathname === "/"
        ? remainingPath
        : targetURL.pathname + remainingPath;
    
    return new URL(finalPath, targetURL.origin);
  }
  
  return new URL(targetPattern);
}

export function computeRedirectTarget(
  url: URL,
  routes: RouteConfig
): RouteMatch | null {
  const matchingRoute = Object.entries(routes).find(([path, _target]) => 
    matchesRoutePath(url.pathname, path)
  );

  if (!matchingRoute) {
    return null;
  }

  const [routePath, targetPattern] = matchingRoute;
  const { url: finalTargetUrl, isProxy } = parseTargetUrl(targetPattern);
  
  const remainingPath = extractRemainingPath(url.pathname, routePath);
  const targetURL = buildTargetUrl(finalTargetUrl, remainingPath);
  
  targetURL.search = url.search;

  return {
    targetUrl: targetURL,
    type: isProxy ? "proxy" : "redirect",
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
      // Check if it's an absolute URL
      let isAbsolute = false;
      try {
        new URL(href);
        isAbsolute = true;
      } catch {
        // Not an absolute URL, will treat as relative
      }
      
      if (isAbsolute) {
        element.setAttribute("href", this.rewriteAbsoluteUrl(href));
      } else {
        element.setAttribute("href", this.rewriteRelativeUrl(href));
      }
    }

    // Handle src attributes
    const src = element.getAttribute("src");
    if (src) {
      // Check if it's an absolute URL
      let isAbsolute = false;
      try {
        new URL(src);
        isAbsolute = true;
      } catch {
        // Not an absolute URL, will treat as relative
      }
      
      if (isAbsolute) {
        element.setAttribute("src", this.rewriteAbsoluteUrl(src));
      } else {
        element.setAttribute("src", this.rewriteRelativeUrl(src));
      }
    }

    // Handle meta tags with content attribute
    if (element.tagName === "meta") {
      const content = element.getAttribute("content");
      if (content) {
        // Check if content is a URL
        let isUrl = false;
        try {
          new URL(content);
          isUrl = true;
        } catch {
          // Not a URL, leave unchanged
        }
        
        if (isUrl) {
          element.setAttribute("content", this.rewriteAbsoluteUrl(content));
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
      Object.entries(routes).find(([path]) => {
        const pathPattern = path.endsWith("/*") ? path.slice(0, -2) : path;
        return url.pathname.startsWith(pathPattern);
      })?.[0] || "";

    // Remove wildcard from routePath for HTML transformations
    const transformPath = routePath.endsWith("/*")
      ? routePath.slice(0, -2)
      : routePath;

    const modifiedRequest = new Request(match.targetUrl.toString(), {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
    });

    modifiedRequest.headers.delete("host");

    // Add a header to detect routing loops
    const loopDetection = request.headers.get("X-Routing-Loop-Detection");
    if (loopDetection === "route-subdomain-to-path") {
      console.error(`Routing loop detected for ${match.targetUrl.toString()}`);
      return new Response("Routing loop detected", { status: 508 });
    }
    modifiedRequest.headers.set("X-Routing-Loop-Detection", "route-subdomain-to-path");

    let response: Response;
    try {
      response = await fetch(modifiedRequest);
    } catch (fetchError) {
      console.error(`Failed to fetch from origin: ${match.targetUrl.toString()}`, fetchError);
      // Return a more specific error for connection failures
      return new Response(
        `Failed to connect to origin server: ${match.targetUrl.origin}`,
        { status: 502 }
      );
    }

    const newHeaders = new Headers(response.headers);

    const contentType = response.headers.get("content-type") || "";
    const isHtml =
      contentType.toLowerCase().includes("text/html") ||
      contentType.toLowerCase().includes("application/xhtml+xml") ||
      url.pathname.toLowerCase().endsWith(".html");

    // Get cache configuration for this route (use routePath with wildcard for matching)
    const cacheConfig = getCacheConfig(env, routePath);
    
    // Determine caching strategy
    const upstreamCacheControl = response.headers.get("Cache-Control");
    const hasRestrictiveCache = upstreamCacheControl && 
      (upstreamCacheControl.includes("max-age=0") || 
       upstreamCacheControl.includes("no-cache") ||
       upstreamCacheControl.includes("no-store") ||
       upstreamCacheControl.includes("must-revalidate"));
    
    // Check if this is a hashed asset that should be cached
    const isHashedAsset = hasContentHash(url.pathname);
    const isImage = isImageFile(url.pathname);
    
    // Apply caching logic
    if (isHashedAsset && hasRestrictiveCache) {
      // Override restrictive caching for hashed JS/CSS files
      // These files have content hashes, so they're safe to cache forever
      newHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (isImage && cacheConfig.cacheImages && hasRestrictiveCache) {
      // Override restrictive caching for images if enabled for this route
      // Cache images for 1 week by default
      newHeaders.set("Cache-Control", "public, max-age=604800");
    } else if (!response.headers.has("Cache-Control")) {
      // Apply default caching if no upstream cache control
      if (isHtml) {
        newHeaders.set("Cache-Control", "no-cache");
      } else {
        newHeaders.set("Cache-Control", "public, max-age=31536000");
      }
    }

    // If it's HTML content, transform it
    if (isHtml) {
      const rewriter = new HTMLRewriter()
        .on("*", new AttributeRewriter(transformPath, url, match.targetUrl))
        .on("head", new BaseTagInjector(transformPath));

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
    // This is the top-level handler for the request
    // We need to return a response for any error to avoid 500s
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
