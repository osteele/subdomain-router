/// <reference types="@cloudflare/workers-types" />

import { handleRequest, type Env } from './worker';

export interface RouterOptions {
  [path: string]: string;
}

/**
 * Creates a Cloudflare Worker fetch handler with path-based routing
 * 
 * @param routes - Object mapping paths to target URLs
 * @returns Cloudflare Worker fetch handler
 * 
 * @example
 * ```typescript
 * import { createRouter } from 'cf-path-router';
 * 
 * const ROUTES = {
 *   '/app1/*': 'proxy:https://app1.example.com/*',
 *   '/app2/*': 'proxy:https://app2.example.com/*',
 *   '/blog/*': 'proxy:https://blog.example.com/*',
 *   '/': 'https://example.com'  // 302 redirect
 * };
 * 
 * export default createRouter(ROUTES);
 * ```
 */
export function createRouter(routes: RouterOptions) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      // Override the ROUTES env var with the provided routes
      const routerEnv = {
        ...env,
        ROUTES: JSON.stringify(routes)
      };
      
      const response = await handleRequest(request, routerEnv);
      return response || (await fetch(request));
    }
  };
}

// Re-export types and utilities that users might need
export { computeRedirectTarget, handleRequest } from './worker';
export type { Env } from './worker';