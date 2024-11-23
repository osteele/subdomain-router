# Routing Configuration Design

## Overview

The Path-Based Application Router needs to maintain a mapping of source paths to target URLs. This document explores different strategies for managing this configuration and explains our chosen approach.

## Requirements

1. **Maintainability**: Configuration should be easy to update and version control
2. **Performance**: Route lookups should be fast
3. **Reliability**: Configuration changes should be safe and reversible
4. **Simplicity**: The solution should minimize operational complexity

## Considered Strategies

### 1. Environment Variables

```toml
[vars]
ROUTES = """
{
  "/tone-curve": "http://tone-curve.underconstruction.fun",
  "/claude-chat-viewer": "https://underconstruction.fun/claude-chat-viewer"
}
"""
```

**Pros**:
- Simple to implement
- No additional services required
- Configuration is version controlled
- Zero latency at runtime

**Cons**:
- Requires redeployment to update routes
- Limited size (Cloudflare limits environment variables to 1KB)
- No dynamic updates

### 2. KV Storage

```typescript
interface Env {
  ROUTE_STORE: KVNamespace;
}

async function getRoutes(env: Env): Promise<RouteConfig> {
  const routesJson = await env.ROUTE_STORE.get('routes');
  return routesJson ? JSON.parse(routesJson) : {};
}
```

**Pros**:
- Dynamic updates without redeployment
- No size limitations
- Simple API

**Cons**:
- Additional cost
- Eventual consistency
- Added latency for route lookups
- Requires additional tooling for updates

### 3. D1 Database

```sql
CREATE TABLE routes (
  path TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  active BOOLEAN DEFAULT true
);
```

**Pros**:
- Complex queries possible
- Atomic updates
- Can maintain history
- Can handle complex routing rules

**Cons**:
- Highest complexity
- Additional cost
- Added latency
- Requires database management

### 4. Configuration API

```typescript
async function getRoutes(env: Env): Promise<RouteConfig> {
  const response = await fetch(env.CONFIG_API_URL);
  return response.json();
}
```

**Pros**:
- Most flexible
- Can integrate with existing systems
- Real-time updates

**Cons**:
- External dependency
- Network latency
- Additional point of failure
- Requires API maintenance

### 5. Hybrid Approach

```typescript
const STATIC_ROUTES = {
  '/health': 'https://health.example.com'
};

async function getRoutes(env: Env): Promise<RouteConfig> {
  const dynamic = await env.ROUTE_STORE.get('routes');
  return { ...STATIC_ROUTES, ...JSON.parse(dynamic || '{}') };
}
```

**Pros**:
- Balances reliability and flexibility
- Critical routes always available
- Can update non-critical routes dynamically

**Cons**:
- More complex implementation
- Mixed update mechanisms
- Potential consistency issues

## Chosen Solution: Environment Variables

We chose to implement routing configuration using environment variables for the following reasons:

1. **Simplicity**: The solution requires no additional services or infrastructure.
2. **Performance**: Routes are available immediately at runtime with no latency.
3. **Version Control**: Configuration changes are tracked in source control.
4. **Deployment Safety**: Changes require explicit deployment, reducing risk of accidental modifications.

### Implementation

```typescript
interface Env {
  ROUTES: string;
}

function getRoutes(env: Env): RouteConfig {
  try {
    return JSON.parse(env.ROUTES);
  } catch (e) {
    console.error('Failed to parse ROUTES:', e);
    return {};
  }
}
```

### Configuration

```toml
# wrangler.toml
[vars]
ROUTES = """
{
  "/tone-curve": "http://tone-curve.underconstruction.fun",
  "/claude-chat-viewer": "https://underconstruction.fun/claude-chat-viewer"
}
"""
```

### Future Considerations

If requirements change, we can evolve to a more dynamic solution:

1. If we need dynamic updates: Consider KV storage
2. If we need complex routing rules: Consider D1 database
3. If we need integration with existing systems: Consider Configuration API

The current design is modular enough that switching to a different strategy would only require changing the `getRoutes` function and its associated configuration.
