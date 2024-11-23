# Path-Based Application Router

This Cloudflare Worker provides a way to serve multiple applications under different paths of a single domain, while maintaining separate deployments. It can route requests based on paths to either different domains or different paths on the same domain.

## Use Cases

1. **Multiple Apps, Single Domain**: Serve multiple independently deployed applications under a single domain:
   - `mydomain.com/app1` → `app1.otherdomain.com`
   - `mydomain.com/app2` → `app2.otherdomain.com`

2. **Path-Based Routing**: Route specific paths to specific locations:
   - `mydomain.com/tools/x` → `tools.otherdomain.com/x`
   - `mydomain.com/app` → `otherdomain.com/app`

3. **Pass-through Routing**: Any paths not explicitly configured pass through to normal Cloudflare handling, allowing you to maintain other subdomains and routes.

## Configuration

The worker uses a simple routing table:

```javascript
const ROUTES = {
  '/tone-curve': 'http://tone-curve.underconstruction.fun',
  '/claude-chat-viewer': 'https://underconstruction.fun/claude-chat-viewer',
  '/dialog-explorer': 'https://dialog-explorer.underconstruction.fun',
  '/shutterspeak': 'https://shutterspeak.underconstruction.fun',
};
```

Each entry maps a path prefix to either:
- A domain (requests will maintain their path after the prefix)
- A full URL (requests will append their remaining path after the target path)

## How It Works

1. **Path Matching**: When a request comes in, the worker checks if the path starts with any of the configured route prefixes.

2. **URL Rewriting**: If a match is found:
   - For domain targets: Strips the prefix and forwards the remaining path
   - For full URL targets: Appends the remaining path after the target path
   - Query parameters are preserved in all cases

3. **Pass-through**: If no match is found, the request is passed through to normal Cloudflare handling

4. **Headers**:
   - The worker manages headers appropriately, removing potentially conflicting ones
   - Adds caching headers based on content type
   - HTML content is set to no-cache
   - Static assets get long-term caching

## Example Behaviors

Given the configuration above:

```text
/tone-curve/editor → http://tone-curve.underconstruction.fun/editor
/claude-chat-viewer/settings → https://underconstruction.fun/claude-chat-viewer/settings
/dialog-explorer/test → https://dialog-explorer.underconstruction.fun/test
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
