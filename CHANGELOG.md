# Changelog

Notable changes are recorded here. This project follows semantic versioning when practical.

## Unreleased

### Changed

- Updated E2B to v2 and refreshed runtime and development dependencies.

## 0.6.0 - 2026-09-04

### Added

- The `ezdb` executable alias (the npm `0.5.5` artifact contains only `ez-devbox`).
- A shipped minimal config/workflow, security policy, contribution guide, and npm-accessible reference docs.
- An offline release-quality command covering complexity, style, tests, build, and package contents.

### Changed
- Added a runnable example config at the repository root.
- Clarified credential forwarding, tunnel exposure, supported hosts, and E2B resource cleanup.
- Hardened CI and npm publishing by pinning actions and running the complete offline validation gate.
- JSON commands now write only machine-readable JSON, required sandbox commands fail on nonzero status, and repo paths are validated before bootstrap.
- Credential sync is mode-scoped, sensitive sandbox files are permission-restricted, and verbose output is redacted.
