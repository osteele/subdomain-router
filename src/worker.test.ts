import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { computeRedirectTarget, handleRequest } from "./worker";

const TEST_ENV = {
  ROUTES: JSON.stringify({
    "/app-one": "https://app-one.example.com",
    "/app-two": "https://app-two.example.com",
    "/app-three": "https://app-three.example.com",
    "/app-four": "https://app-four.example.com",
  }),
};

describe("URL Transformation", () => {
  describe("domain-based routing", () => {
    const testRoutes = JSON.parse(TEST_ENV.ROUTES);

    it("should route to a different domain", () => {
      const url = new URL("https://source.example.com/app-one/editor");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.toString()).toBe("https://app-one.example.com/editor");
    });

    it("should handle root path on target domain", () => {
      const url = new URL("https://source.example.com/app-four");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.toString()).toBe("https://app-four.example.com/");
    });

    it("should handle root path with trailing slash on target domain", () => {
      const url = new URL("https://source.example.com/app-four/");
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.toString()).toBe("https://app-four.example.com/");
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
      expect(target?.toString()).toBe("https://app-two.example.com/settings");
    });

    it("should preserve multiple path segments", () => {
      const url = new URL(
        "https://source.example.com/app-three/test/nested/path"
      );
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.toString()).toBe(
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
      expect(target?.toString()).toBe(
        "https://app-one.example.com/editor?param=value"
      );
    });

    it("should preserve multiple query parameters", () => {
      const url = new URL(
        "https://source.example.com/app-one/editor?param1=value1&param2=value2"
      );
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.toString()).toBe(
        "https://app-one.example.com/editor?param1=value1&param2=value2"
      );
    });

    it("should handle special characters in query parameters", () => {
      const url = new URL(
        "https://source.example.com/app-one/editor?q=test%20space&filter=type%3Aimage"
      );
      const target = computeRedirectTarget(url, testRoutes);
      expect(target?.toString()).toBe(
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
});

describe("Request Handler", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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