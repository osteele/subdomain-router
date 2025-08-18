# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
