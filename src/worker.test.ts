import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { computeRedirectTarget, handleRequest, type Env } from "./worker";

const TEST_ENV = {
  ROUTES: JSON.stringify({
    "/app-one/*": "proxy:https://app-one.example.com/*",
    "/app-two/*": "proxy:https://app-two.example.com/*",
    "/app-three/*": "proxy:https://app-three.example.com/*",
    "/app-four/*": "proxy:https://app-four.example.com/*",
  }),
};

describe("URL Transformation", () => {
  describe("domain-based routing", () => {
    const testRoutes = JSON.parse(TEST_ENV.ROUTES);

    it("should route to a different domain", () => {
      const url = new URL("https://source.example.com/app-one/editor");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-one.example.com/editor"
      );
    });

    it("should handle root path on target domain", () => {
      const url = new URL("https://source.example.com/app-four");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-four.example.com/"
      );
    });

    it("should handle root path with trailing slash on target domain", () => {
      const url = new URL("https://source.example.com/app-four/");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-four.example.com/"
      );
    });

    it("should return null for non-matching routes", () => {
      const url = new URL("https://source.example.com/unknown-path");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target).toBeNull();
    });
  });

  describe("path-based routing", () => {
    const testRoutes = JSON.parse(TEST_ENV.ROUTES);

    it("should route to a path on different domain", () => {
      const url = new URL("https://source.example.com/app-two/settings");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-two.example.com/settings"
      );
    });

    it("should preserve multiple path segments", () => {
      const url = new URL(
        "https://source.example.com/app-three/test/nested/path"
      );
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-three.example.com/test/nested/path"
      );
    });
  });

  describe("query parameters", () => {
    const testRoutes = JSON.parse(TEST_ENV.ROUTES);

    it("should preserve simple query parameters", () => {
      const url = new URL(
        "https://source.example.com/app-one/editor?param=value"
      );
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-one.example.com/editor?param=value"
      );
    });

    it("should preserve multiple query parameters", () => {
      const url = new URL(
        "https://source.example.com/app-one/editor?param1=value1&param2=value2"
      );
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-one.example.com/editor?param1=value1&param2=value2"
      );
    });

    it("should handle special characters in query parameters", () => {
      const url = new URL(
        "https://source.example.com/app-one/editor?q=test%20space&filter=type%3Aimage"
      );
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.targetUrl.toString()).toBe(
        "https://app-one.example.com/editor?q=test%20space&filter=type%3Aimage"
      );
    });
  });

  describe("pass-through behavior", () => {
    const testRoutes = JSON.parse(TEST_ENV.ROUTES);

    it("should return null for non-matching routes", () => {
      const url = new URL("https://source.example.com/unknown-path");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target).toBeNull();
    });

    it("should return null for partial prefix matches", () => {
      const url = new URL("https://source.example.com/app-one-extra");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target).toBeNull();
    });

    it("should not match substrings that aren't subpaths", () => {
      const url = new URL("https://source.example.com/app-one-editor");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target).toBeNull();
    });
  });

  describe("external redirects", () => {
    const testRoutes = {
      "/": "https://example.com/tools",
      "/about": "https://example.com/about-page",
      "/app/*": "proxy:https://app.example.com/*",
    };

    it("should handle exact path redirects", async () => {
      const request = new Request("https://source.example.com/");
      const response = await handleRequest(request, {
        ROUTES: JSON.stringify(testRoutes),
      });

      expect(response?.status).toBe(302);
      expect(response?.headers.get("Location")).toBe(
        "https://example.com/tools"
      );
    });

    it("should handle wildcard proxy paths", async () => {
      globalThis.fetch = async () => {
        return new Response("Test response", {
          status: 200,
          headers: new Headers({ "content-type": "text/plain" }),
        });
      };

      const request = new Request("https://source.example.com/app/some/path");
      const response = await handleRequest(request, {
        ROUTES: JSON.stringify(testRoutes),
      });

      expect(response?.status).toBe(200);
    });

    it("should treat /path same as /path/ for wildcard routes", async () => {
      globalThis.fetch = async () => {
        return new Response("Test response", {
          status: 200,
          headers: new Headers({ "content-type": "text/plain" }),
        });
      };

      const request = new Request("https://source.example.com/app");
      const response = await handleRequest(request, {
        ROUTES: JSON.stringify(testRoutes),
      });

      expect(response?.status).toBe(200);
    });
  });
});

describe("Request Handler", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      const headers = new Headers();

      if (url.endsWith(".html")) {
        headers.set("content-type", "text/html; charset=utf-8");
      } else if (url.endsWith(".js")) {
        headers.set("content-type", "application/javascript");
      } else {
        headers.set("content-type", "text/plain");
      }

      return new Response("Test response", {
        status: 200,
        headers,
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("routing behavior", () => {
    it("should handle redirected requests", async () => {
      const request = new Request("https://source.example.com/app-one/editor");
      const response = await handleRequest(request, TEST_ENV);
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
    });

    it("should return null for non-redirected requests", async () => {
      const request = new Request("https://source.example.com/unknown-path");
      const response = await handleRequest(request, TEST_ENV);
      expect(response).toBeNull();
    });
  });

  describe("header handling", () => {
    it("should respect existing cache control headers", async () => {
      globalThis.fetch = async () => {
        const headers = new Headers({
          "content-type": "text/html; charset=utf-8",
          "cache-control": "max-age=3600",
        });
        return new Response("Test response", { status: 200, headers });
      };

      const request = new Request(
        "https://source.example.com/app-one/index.html"
      );
      const response = await handleRequest(request, TEST_ENV);
      expect(response?.headers.get("Cache-Control")).toBe("max-age=3600");
    });

    it("should set default cache control for HTML when none exists", async () => {
      globalThis.fetch = async () => {
        const headers = new Headers({
          "content-type": "text/html; charset=utf-8",
        });
        return new Response("Test response", { status: 200, headers });
      };

      const request = new Request(
        "https://source.example.com/app-one/index.html"
      );
      const response = await handleRequest(request, TEST_ENV);
      expect(response?.headers.get("Cache-Control")).toBe("no-cache");
    });

    it("should set default cache control for assets when none exists", async () => {
      globalThis.fetch = async () => {
        const headers = new Headers({
          "content-type": "application/javascript",
        });
        return new Response("Test response", { status: 200, headers });
      };

      const request = new Request(
        "https://source.example.com/app-one/script.js"
      );
      const response = await handleRequest(request, TEST_ENV);
      expect(response?.headers.get("Cache-Control")).toBe(
        "public, max-age=31536000"
      );
    });

    it("should remove host header from forwarded request", async () => {
      let capturedRequest: Request | undefined;
      globalThis.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        if (input instanceof Request) {
          capturedRequest = input;
        } else {
          capturedRequest = new Request(input, init);
        }
        return new Response("Test response");
      };

      const request = new Request("https://source.example.com/app-one/editor", {
        headers: { host: "example.com" },
      });
      await handleRequest(request, TEST_ENV);

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.headers.has("host")).toBe(false);
    });
  });
});

describe("HTML Content Transformation", () => {
  beforeEach(() => {
    globalThis.fetch = async () => {
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
      });
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="icon" href="/icon.png">
            <link rel="manifest" href="/manifest.json">
            <meta property="og:url" content="https://app-one.example.com/page">
            <script src="/script.js"></script>
          </head>
          <body>
            <img src="/image.jpg">
            <a href="/link">Link</a>
          </body>
        </html>
        `,
        { headers }
      );
    };
  });

  it("should rewrite relative URLs in HTML content", async () => {
    const request = new Request("https://source.example.com/app-one/page");
    const response = await handleRequest(request, {
      ROUTES: JSON.stringify({
        "/app-one/*": "proxy:https://app-one.example.com/*",
      }),
    });
    const content = await response?.text();

    expect(content).toContain('href="/app-one/icon.png"');
    expect(content).toContain('href="/app-one/manifest.json"');
    expect(content).toContain('src="/app-one/script.js"');
    expect(content).toContain('src="/app-one/image.jpg"');
    expect(content).toContain('href="/app-one/link"');
  });

  it("should rewrite absolute URLs in meta tags", async () => {
    const request = new Request("https://source.example.com/app-one/page");
    const response = await handleRequest(request, TEST_ENV);
    const content = await response?.text();

    expect(content).toContain(
      'content="https://source.example.com/app-one/page"'
    );
  });
});

describe("HTML Base Tag Injection", () => {
  beforeEach(() => {
    globalThis.fetch = async () => {
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
      });
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="icon" href="./icon.png">
            <link rel="manifest" href="manifest.json">
            <script src="../script.js"></script>
          </head>
          <body>
            <img src="./image.jpg">
            <a href="../link">Link</a>
          </body>
        </html>
        `,
        { headers }
      );
    };
  });

  it("should inject base tag in head", async () => {
    const request = new Request("https://source.example.com/app-one/page");
    const response = await handleRequest(request, TEST_ENV);
    const content = await response?.text();

    expect(content).toContain('<base href="/app-one/">');

    if (content) {
      const basePosition = content.indexOf('<base href="/app-one/">');
      const linkPosition = content.indexOf('<link rel="icon"');
      expect(basePosition).toBeGreaterThan(-1);
      expect(linkPosition).toBeGreaterThan(-1);
      expect(basePosition).toBeLessThan(linkPosition);
    }
  });

  it("should handle paths without trailing slash", async () => {
    const request = new Request("https://source.example.com/app-one");
    const response = await handleRequest(request, TEST_ENV);
    const content = await response?.text();

    expect(content).toContain('<base href="/app-one/">');
  });

  it("should correctly rewrite absolute paths starting with /", async () => {
    globalThis.fetch = async () => {
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
      });
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <img src="/mascot-transparent.png">
            <script src="/assets/app.js"></script>
            <link href="/styles.css" rel="stylesheet">
          </body>
        </html>
        `,
        { headers }
      );
    };

    const request = new Request("https://source.example.com/app-one/page");
    const response = await handleRequest(request, TEST_ENV);
    const content = await response?.text();

    // Absolute paths should be rewritten to include the source path
    expect(content).toContain('src="/app-one/mascot-transparent.png"');
    expect(content).toContain('src="/app-one/assets/app.js"');
    expect(content).toContain('href="/app-one/styles.css"');

    // Base tag should still be injected
    expect(content).toContain('<base href="/app-one/">');
  });
});

describe("Cache Control for Hashed Assets", () => {
  const mockFetchWithCache = (cacheControl?: string, contentType = "application/javascript") => {
    return async () => {
      const headers = new Headers({
        "content-type": contentType,
      });
      if (cacheControl) {
        headers.set("Cache-Control", cacheControl);
      }
      return new Response("console.log('test');", { headers });
    };
  };

  beforeEach(() => {
    globalThis.fetch = mockFetchWithCache();
  });

  afterEach(() => {
    // @ts-expect-error - resetting global fetch
    globalThis.fetch = undefined;
  });

  it("should cache hashed JS files forever when upstream has restrictive caching", async () => {
    globalThis.fetch = mockFetchWithCache("public, max-age=0, must-revalidate");
    
    const request = new Request("https://source.example.com/app-one/index-353f0761.js");
    const response = await handleRequest(request, TEST_ENV);
    
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("should cache hashed CSS files forever when upstream has restrictive caching", async () => {
    globalThis.fetch = mockFetchWithCache("no-cache", "text/css");
    
    const request = new Request("https://source.example.com/app-one/styles-ff860190.css");
    const response = await handleRequest(request, TEST_ENV);
    
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("should detect various hash patterns in filenames", async () => {
    globalThis.fetch = mockFetchWithCache("max-age=0");
    
    const testCases = [
      "app.a1b2c3d4.js",
      "main-12345678.css",
      "vendor.abcdef123456.js",
      "chunk-9f8e7d6c5b4a.css"
    ];

    for (const filename of testCases) {
      const request = new Request(`https://source.example.com/app-one/${filename}`);
      const response = await handleRequest(request, TEST_ENV);
      expect(response?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    }
  });

  it("should not override permissive upstream caching for hashed assets", async () => {
    globalThis.fetch = mockFetchWithCache("public, max-age=604800");
    
    const request = new Request("https://source.example.com/app-one/bundle-abc123.js");
    const response = await handleRequest(request, TEST_ENV);
    
    // Should keep the upstream cache control
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=604800");
  });

  it("should not cache non-hashed JS/CSS files", async () => {
    globalThis.fetch = mockFetchWithCache("max-age=0");
    
    const request = new Request("https://source.example.com/app-one/script.js");
    const response = await handleRequest(request, TEST_ENV);
    
    // Should keep the upstream restrictive caching
    expect(response?.headers.get("Cache-Control")).toBe("max-age=0");
  });
});

describe("Unmatched Routes", () => {
  it("should return null for root-level assets not matching any route", async () => {
    // This simulates a request to /mascot-transparent.png which doesn't match any route
    const request = new Request("https://tools.osteele.com/mascot-transparent.png");
    const response = await handleRequest(request, TEST_ENV);

    // Should return null, which causes the worker to pass through to normal Cloudflare handling
    expect(response).toBeNull();
  });

  it("should only proxy assets under configured paths", async () => {
    globalThis.fetch = async () => {
      return new Response("image data", {
        headers: new Headers({ "content-type": "image/png" })
      });
    };

    // This should work - matches /app-one/*
    const matchingRequest = new Request("https://source.example.com/app-one/mascot-transparent.png");
    const matchingResponse = await handleRequest(matchingRequest, TEST_ENV);
    expect(matchingResponse).not.toBeNull();
    expect(matchingResponse?.status).toBe(200);

    // This should NOT work - doesn't match any route
    const nonMatchingRequest = new Request("https://source.example.com/mascot-transparent.png");
    const nonMatchingResponse = await handleRequest(nonMatchingRequest, TEST_ENV);
    expect(nonMatchingResponse).toBeNull();
  });

  afterEach(() => {
    // @ts-expect-error - resetting global fetch
    globalThis.fetch = undefined;
  });
});

describe("Error Handling", () => {
  it("should detect and prevent routing loops", async () => {
    const request = new Request("https://source.example.com/app-one/test", {
      headers: new Headers({
        "X-Routing-Loop-Detection": "route-subdomain-to-path"
      })
    });

    const response = await handleRequest(request, TEST_ENV);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(508);
    expect(await response?.text()).toBe("Routing loop detected");
  });

  it("should handle connection failures gracefully", async () => {
    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };

    const request = new Request("https://source.example.com/app-one/test");
    const response = await handleRequest(request, TEST_ENV);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(502);
    expect(await response?.text()).toContain("Failed to connect to origin server");
  });

  afterEach(() => {
    // @ts-expect-error - resetting global fetch
    globalThis.fetch = undefined;
  });
});

describe("Direct Asset Requests", () => {
  it("should correctly proxy image requests", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      // Verify the request is being made to the correct URL
      const req = typeof input === 'string' ? new Request(input) : input instanceof URL ? new Request(input.toString()) : input;
      const url = new URL(req.url);
      expect(url.pathname).toBe("/mascot-transparent.png");
      expect(url.origin).toBe("https://app-one.example.com");

      return new Response("image data", {
        headers: new Headers({
          "content-type": "image/png",
        })
      });
    };

    const request = new Request("https://source.example.com/app-one/mascot-transparent.png");
    const response = await handleRequest(request, TEST_ENV);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const content = await response?.text();
    expect(content).toBe("image data");
  });

  it("should handle root-relative image paths after HTML rewriting", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const req = typeof input === 'string' ? new Request(input) : input instanceof URL ? new Request(input.toString()) : input;
      const url = new URL(req.url);

      // For HTML request
      if (url.pathname === "/page") {
        return new Response(
          `<html><body><img src="/mascot-transparent.png"></body></html>`,
          { headers: new Headers({ "content-type": "text/html" }) }
        );
      }

      // For image request - this should never be called if URL rewriting works
      return new Response("", { status: 404 });
    };

    // First, get the HTML page
    const htmlRequest = new Request("https://source.example.com/app-one/page");
    const htmlResponse = await handleRequest(htmlRequest, TEST_ENV);
    const html = await htmlResponse?.text();

    // The HTML should have the rewritten URL
    expect(html).toContain('src="/app-one/mascot-transparent.png"');
  });
});

describe("Image Caching Configuration", () => {
  const TEST_ENV_WITH_IMAGE_CACHE: Env = {
    ROUTES: TEST_ENV.ROUTES,
    CACHE_IMAGES: '["/app-one/*"]'
  };

  const mockFetchImage = (cacheControl?: string) => {
    return async () => {
      const headers = new Headers({
        "content-type": "image/jpeg",
      });
      if (cacheControl) {
        headers.set("Cache-Control", cacheControl);
      }
      return new Response("", { headers });
    };
  };

  beforeEach(() => {
    globalThis.fetch = mockFetchImage();
  });

  afterEach(() => {
    // @ts-expect-error - resetting global fetch
    globalThis.fetch = undefined;
  });

  it("should cache images when enabled for the route and upstream is restrictive", async () => {
    globalThis.fetch = mockFetchImage("no-cache");
    
    const request = new Request("https://source.example.com/app-one/photo.jpg");
    const response = await handleRequest(request, TEST_ENV_WITH_IMAGE_CACHE);
    
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=604800");
  });

  it("should not cache images when not enabled for the route", async () => {
    globalThis.fetch = mockFetchImage("no-cache");
    
    const request = new Request("https://source.example.com/app-two/photo.jpg");
    const response = await handleRequest(request, TEST_ENV_WITH_IMAGE_CACHE);
    
    // Should keep upstream cache control
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("should not override permissive image caching", async () => {
    globalThis.fetch = mockFetchImage("public, max-age=86400");
    
    const request = new Request("https://source.example.com/app-one/photo.jpg");
    const response = await handleRequest(request, TEST_ENV_WITH_IMAGE_CACHE);
    
    // Should keep upstream cache control
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  it("should handle various image formats", async () => {
    globalThis.fetch = mockFetchImage("max-age=0");
    
    const imageFormats = [
      "image.jpg", "photo.jpeg", "icon.png", "animation.gif",
      "modern.webp", "logo.svg", "favicon.ico", "picture.avif"
    ];

    for (const filename of imageFormats) {
      const request = new Request(`https://source.example.com/app-one/${filename}`);
      const response = await handleRequest(request, TEST_ENV_WITH_IMAGE_CACHE);
      expect(response?.headers.get("Cache-Control")).toBe("public, max-age=604800");
    }
  });

  it("should handle global image caching configuration", async () => {
    const envWithGlobalCache: Env = {
      ROUTES: TEST_ENV.ROUTES,
      CACHE_IMAGES: 'true'
    };
    
    globalThis.fetch = mockFetchImage("no-cache");
    
    const request = new Request("https://source.example.com/app-two/image.png");
    const response = await handleRequest(request, envWithGlobalCache);
    
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=604800");
  });
});
