# Path-Based Application Router

This Cloudflare Worker provides a way to serve multiple applications under different paths of a single domain, while maintaining separate deployments. It supports both proxy routing and HTTP redirects.

## Use Cases

1. **Multiple Apps, Single Domain**: Serve multiple independently deployed applications under a single domain:
   - `mydomain.com/app1` → `app1.otherdomain.com`
   - `mydomain.com/app2` → `app2.otherdomain.com`

2. **Path-Based Routing**: Route specific paths to specific locations:
   - `mydomain.com/tools/x` → `tools.otherdomain.com/x`
   - `mydomain.com/app` → `otherdomain.com/app`

3. **HTTP Redirects**: Redirect specific paths to external URLs:
   - `mydomain.com/` → `302 redirect to otherdomain.com/tools`

4. **Pass-through Routing**: Any paths not explicitly configured pass through to normal Cloudflare handling.

## Configuration

The worker uses a simple routing table:

```javascript
const ROUTES = {
  // Proxy routes - preserve path segments after the match
  '/tone-curve': 'proxy:https://tone-curve.underconstruction.fun',
  '/dialog-explorer': 'proxy:https://dialog-explorer.underconstruction.fun',

  // HTTP redirect - exact path match only
  '/': '302:https://osteele.com/tools'
};
```

Each entry maps a path to either:
- A proxy route (`proxy:` prefix) - requests will be proxied, preserving additional path segments
- A redirect route (`302:` prefix) - requests will receive a 302 redirect, exact path match only

## How It Works

1. **Path Matching**: When a request comes in, the worker checks the path against configured routes.

2. **URL Handling**:
   - For proxy routes: Forwards the request, preserving additional path segments
   - For redirect routes (prefixed with "302:"): Returns a 302 redirect response
   - Query parameters are preserved in all cases

3. **Pass-through**: If no match is found, the request passes through to normal Cloudflare handling

4. **Headers**:
   - The worker manages headers appropriately for proxied requests
   - Adds caching headers based on content type
   - HTML content is set to no-cache
   - Static assets get long-term caching

## Example Behaviors

Given the configuration above:

```text
# Proxy routes (preserve additional path segments)
/tone-curve/editor → http://tone-curve.underconstruction.fun/editor
/dialog-explorer/test → https://dialog-explorer.underconstruction.fun/test

# Redirect routes (exact match only)
/ → 302 redirect to https://osteele.com/tools

# Pass-through
/unknown-path → [passes through to regular Cloudflare handling]
```

## Client Application Requirements

Applications being served through this worker should:

1. Use relative paths for assets and navigation (e.g., "styles.css" instead of "/styles.css")
2. Be built without a hardcoded base path

For Vite applications, this can be achieved with:
```javascript
// vite.config.js
export default defineConfig({
  base: '', // Empty string forces relative paths
})
```

## Development

This project uses Bun for development and testing. Make sure you have Bun installed:

```bash
curl -fsSL https://bun.sh/install | bash
```

Install dependencies:
```bash
bun install
```

Run development server:
```bash
bun run dev
```

Run tests:
```bash
bun test
```

Type checking:
```bash
bun run type-check
```

## Deployment

1. Install Wrangler CLI:
```bash
bun add -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Deploy:
```bash
bun run deploy
```

## Notes

- The worker preserves query parameters
- Error handling is included for failed requests
- Caching is configured appropriately for different content types
- Host headers are managed to avoid conflicts
