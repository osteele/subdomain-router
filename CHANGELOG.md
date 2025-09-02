# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Smart caching for JavaScript and CSS files with content hashes (e.g., `index-353f0761.js`)
  - Automatically detects files with hash patterns in their names
  - Overrides upstream restrictive cache headers for these immutable assets
  - Sets long-term caching (1 year) with immutable flag
- Configurable image caching per route
  - New `CACHE_IMAGES` environment variable for enabling image caching
  - Supports per-route configuration or global setting
  - Caches images for 1 week when enabled and upstream has restrictive caching

### Changed
- Enhanced cache control logic to intelligently handle upstream cache headers
- Only overrides restrictive upstream caching (max-age=0, no-cache, must-revalidate) for hashed assets

## [0.1.0] - 2025-08-18

### Changed
- **BREAKING**: Renamed package from `subdomain-router` to `cf-path-router` for npm publication
- Improved code quality and error handling throughout codebase
- Updated Wrangler from 3.78.12 to 4.6.0
- Modernized dependencies and toolchain

### Added
- TypeScript support with type declarations
- Comprehensive build system with Bun
- ESLint configuration with Oxlint
- Automated testing with Bun test
- Husky git hooks for pre-commit checks
- CI/CD scripts for linting and testing

### Added Routes
- Added kana-falls route configuration to wrangler.toml

### Removed
- Removed legacy kana-falls route configuration during cleanup

## [Initial publication] - 2024-11-26

### Added
- Initial Cloudflare Worker for path-based application routing
- Core routing functionality for subdomain-based proxying
- Basic configuration and deployment setup
- README documentation

---

**Note**: Version 0.1.0 is the initial public npm release. The initial publication represents the original codebase from Oliver Steele's internal domain infrastructure.
