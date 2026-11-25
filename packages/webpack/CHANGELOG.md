# Changelog

<!-- bureaucrate goes here -->

## [v2.0.1] 2026-11-25

### Other changes

- build: Update es-module-lexer

### Dependencies

- Updated `@freshpack/core` to 4.0.1

## [v2.0.0] 2026-11-25

### Breaking changes

- Drop esbuild Builder remains
- Discover islands and styles through the server import graph

### Added features

- Css+preload of route files
- Ignore patterns for route and island crawl
- Discover islands and styles through the server import graph
- Apply server module updates through import.meta.hot

### Bugfixes

- Use the running compiler's webpack classes

### Other changes

- build: Use @deltarocks/raphus from npm
- refactor: Drop esbuild Builder remains
- build: Make webpack a peer dependency

### Dependencies

- Updated `@freshpack/core` to 4.0.0
