import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { computeRedirectTarget, handleRequest } from "./worker";

describe("URL Transformation", () => {
  describe("domain-based routing", () => {
    it("should route to a different domain", () => {
      const url = new URL("https://example.com/tone-curve/editor");
      const target = computeRedirectTarget(url);
      expect(target?.toString()).toBe(
        "http://tone-curve.underconstruction.fun/editor"
      );
    });

    it("should handle root path on target domain", () => {
      const url = new URL("https://example.com/shutterspeak");
      const target = computeRedirectTarget(url);
      expect(target?.toString()).toBe(
        "https://shutterspeak.underconstruction.fun/"
      );
    });
  });

  describe("path-based routing", () => {
    it("should route to a path on different domain", () => {
      const url = new URL("https://example.com/claude-chat-viewer/settings");
      const target = computeRedirectTarget(url);
      expect(target?.toString()).toBe(
        "https://underconstruction.fun/claude-chat-viewer/settings"
      );
    });

    it("should preserve multiple path segments", () => {
      const url = new URL(
        "https://example.com/dialog-explorer/test/nested/path"
      );
      const target = computeRedirectTarget(url);
      expect(target?.toString()).toBe(
        "https://dialog-explorer.underconstruction.fun/test/nested/path"
      );
    });
  });

  describe("query parameters", () => {
    it("should preserve simple query parameters", () => {
      const url = new URL("https://example.com/tone-curve/editor?param=value");
      const target = computeRedirectTarget(url);
      expect(target?.toString()).toBe(
        "http://tone-curve.underconstruction.fun/editor?param=value"
      );
    });

    it("should preserve multiple query parameters", () => {
      const url = new URL(
        "https://example.com/tone-curve/editor?param1=value1&param2=value2"
      );
      const target = computeRedirectTarget(url);
      expect(target?.toString()).toBe(
        "http://tone-curve.underconstruction.fun/editor?param1=value1&param2=value2"
      );
    });

    it("should handle special characters in query parameters", () => {
      const url = new URL(
        "https://example.com/tone-curve/editor?q=test%20space&filter=type%3Aimage"
      );
      const target = computeRedirectTarget(url);
      expect(target?.toString()).toBe(
        "http://tone-curve.underconstruction.fun/editor?q=test%20space&filter=type%3Aimage"
      );
    });
  });

  describe("pass-through behavior", () => {
    it("should return null for non-matching routes", () => {
      const url = new URL("https://example.com/unknown-path");
      const target = computeRedirectTarget(url);
      expect(target).toBeNull();
    });

    it("should return null for partial prefix matches", () => {
      const url = new URL("https://example.com/tone-curve-extra");
      const target = computeRedirectTarget(url);
      expect(target).toBeNull();
    });

    it("should not match substrings that aren't subpaths", () => {
      const url = new URL("https://example.com/tone-curve-editor");
      const target = computeRedirectTarget(url);
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
      const request = new Request("https://example.com/tone-curve/editor");
      const response = await handleRequest(request);
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
    });

    it("should return null for non-redirected requests", async () => {
      const request = new Request("https://example.com/unknown-path");
      const response = await handleRequest(request);
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

      const request = new Request("https://example.com/tone-curve/index.html");
      const response = await handleRequest(request);
      expect(response?.headers.get("Cache-Control")).toBe("max-age=3600");
    });

    it("should set default cache control for HTML when none exists", async () => {
      globalThis.fetch = async () => {
        const headers = new Headers({
          "content-type": "text/html; charset=utf-8",
        });
        return new Response("Test response", { status: 200, headers });
      };

      const request = new Request("https://example.com/tone-curve/index.html");
      const response = await handleRequest(request);
      expect(response?.headers.get("Cache-Control")).toBe("no-cache");
    });

    it("should set default cache control for assets when none exists", async () => {
      globalThis.fetch = async () => {
        const headers = new Headers({
          "content-type": "application/javascript",
        });
        return new Response("Test response", { status: 200, headers });
      };

      const request = new Request("https://example.com/tone-curve/script.js");
      const response = await handleRequest(request);
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

      const request = new Request("https://example.com/tone-curve/editor", {
        headers: { host: "example.com" },
      });
      await handleRequest(request);

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.headers.has("host")).toBe(false);
    });
  });
});
