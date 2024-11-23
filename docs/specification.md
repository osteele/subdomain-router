# URL Router and HTML Transformer Specification

## Overview
This service provides URL routing and HTML content transformation for applications hosted across multiple domains. It operates as a Cloudflare Worker, intercepting requests and either forwarding them to their destination or transforming and redirecting them as needed.

## Configuration
Routes are configured via the `ROUTES` environment variable as a JSON object mapping source paths to target URLs:

```json
json
{
"/app-one": "https://app-one.example.com",
"/app-two": "https://app-two.example.com"
}
```


## Routing Behavior

### Path Matching
- Exact matches: `/app-one` matches exactly `/app-one`
- Prefix matches: `/app-one` matches `/app-one/` and `/app-one/any/path`
- Non-matches:
  - Does not match partial words (e.g., `/app-one` does not match `/app-one-extra`)
  - Returns null for any unmatched routes

### URL Transformation
1. When a match is found:
   - The matching prefix is stripped from the source path
   - The remaining path is appended to the target URL
   - Query parameters are preserved
   - Example: `/app-one/editor?id=123` → `https://app-one.example.com/editor?id=123`

2. When no match is found:
   - The request is passed through unchanged
   - No transformation occurs

## HTML Content Transformation

### Trigger Conditions
HTML transformation occurs when:
- The response Content-Type is `text/html` or `application/xhtml+xml`
- The URL path ends with `.html`

### URL Rewriting Rules

#### Relative URLs
Relative URLs in HTML attributes are prefixed with the source path:
- `/icon.png` → `/app-one/icon.png`
- `/manifest.json` → `/app-one/manifest.json`

Affected attributes:
- `href` attributes (links, stylesheets, icons, manifests)
- `src` attributes (images, scripts, iframes)

#### Absolute URLs
Absolute URLs from the target domain are rewritten to the source domain:
- `https://app-one.example.com/page` → `https://source.example.com/app-one/page`

Affected elements:
- Meta tags with URL content (e.g., `og:url`)
- Any `href` or `src` attributes containing absolute URLs

### Caching Behavior

#### Default Cache Control Headers
When no Cache-Control header is present:
- HTML content: `no-cache`
- Other content: `public, max-age=31536000`

#### Existing Headers
- Existing Cache-Control headers are preserved
- No transformation of other headers occurs

## Request Handling

### Header Modifications

- The `host` header is removed from forwarded requests
- All other headers are preserved

### Error Handling

- Returns 500 status code for processing errors
- Includes error message in response body
- Maintains original status codes for successful transformations

## Security Considerations

- Only transforms URLs for configured routes
- Preserves HTTPS protocol
- Maintains all security headers from origin response
- Does not modify response body content beyond URL transformations

## Performance

- Uses streaming HTML transformation
- Processes content without loading entire response into memory
- Minimal impact on response time for non-HTML content

## System Diagrams

### Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant Worker as Cloudflare Worker
    participant Target as Target Server

    Client->>Worker: Request to /app-one/page

    rect rgb(240, 240, 240)
        Note over Worker: Route Matching
        Worker->>Worker: Check ROUTES config
        Worker->>Worker: Compute redirect target
    end

    Worker->>Target: Forward request to target server
    Target->>Worker: Response

    alt is HTML Content
        rect rgb(240, 240, 240)
            Note over Worker: HTML Transformation
            Worker->>Worker: Rewrite relative URLs
            Worker->>Worker: Rewrite absolute URLs
            Worker->>Worker: Transform meta tags
        end
    else other content
        Note over Worker: Pass through unchanged
    end

    Worker->>Client: Transformed response
```

### URL Transformation Logic

```mermaid
flowchart TD
    A[Incoming URL] --> B{Match in Routes?}
    B -->|Yes| C[Extract matching prefix]
    B -->|No| D[Return null]
    C --> E[Strip prefix from path]
    E --> F[Get target URL from routes]
    F --> G[Combine target URL with remaining path]
    G --> H[Copy query parameters]
    H --> I[Return new URL]
```

### HTML Rewriting Process

```mermaid
flowchart LR
    A[HTML Response] --> B{Is attribute URL?}
    B -->|href| C[Process href]
    B -->|src| D[Process src]
    B -->|meta content| E[Process meta]

    C --> F{Absolute URL?}
    D --> F
    E --> F

    F -->|Yes| G[Rewrite domain to source]
    F -->|No| H[Add source path prefix]

    G --> I[Final HTML]
    H --> I
```
