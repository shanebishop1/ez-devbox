# Changelog

Notable changes are recorded here. This project follows semantic versioning when practical.

## Unreleased

## 0.7.0 - 2026-09-09

### Added

- Added config-driven `ssh-custom` terminal-agent mode with sandbox-local check/install commands, safe whole-argument initial prompt templating, opt-in tmux follow-ups, selected environment forwarding, and explicit regular-file auth/config mappings.

### Fixed

- Hardened custom-agent preflight and reconnect identity checks, rejected shell-program prompt delivery and unsafe destinations, preserved built-in symlink auth compatibility, and protected credential/prompt staging files before transfer.

### Documentation

- Documented compatible template requirements, trusted sandbox commands, prompt and shell-wrapper semantics, create-only file sync, reconnect behavior, and authentication limitations for custom agents.

## 0.6.6 - 2026-09-08

### Changed

- Reduced interactive SSH startup and reconnect latency by batching bridge setup and installing SSH dependencies together with tmux.
- Added a reusable live SSH startup benchmark with automatic sandbox cleanup.

## 0.6.5 - 2026-09-08

### Changed

- Added full-project TypeScript type checking to the offline validation gate used locally and in CI.

## 0.6.4 - 2026-09-08

### Fixed

- Preserved remote command exit codes, stdout, and stderr when the E2B SDK reports a nonzero command result.
- Matched non-interactive command working directories to the active repository saved for the target sandbox.
- Required password authentication before starting a web listener, rejected unsafe existing listeners, and limited failed-startup cleanup to listener processes owned by the current launch.

## 0.6.3 - 2026-09-08

### Fixed

- Fixed redaction of colon-delimited credential assignments whose values contain equals signs.

### Changed

- Updated the packaged documentation and demo instructions.

## 0.6.2 - 2026-09-06

### Fixed

- Fixed the packaged `ez-devbox` and `ezdb` executables producing no output when invoked through npm-created bin symlinks.

## 0.6.1 - 2026-09-06

### Added

- Added detached startup and reconnect flows for SSH agent and shell modes, with lifecycle-aware JSON results and tmux connection details.
- Added initial and follow-up prompt transport through `--prompt-file` and `--prompt-stdin`, plus documented non-PTY inspection, explicit shell execution, and concurrent automation guidance.

### Changed

- Updated the E2B adapter and lifecycle handling for SDK v2, including list pagination and boolean deletion results, and hardened live-test cleanup and failure reporting.
- Refreshed runtime, development, and CI dependencies, including `dotenv`, TypeScript, Vitest, `tsx`, Node types, and the GitHub Actions checkout/setup-node versions; CI continues to cover Linux and macOS on Node 20 and 24.
- Clarified CLI help/version output and isolated OpenCode version checks from host-specific tooling.
- Introduced focused source boundaries for shared command argument/environment resolution, create execution, and host-sandbox sync operations while preserving command compatibility entry points.
- Added compatibility coverage for legacy last-run state, the legacy `--yes-sync` flag, and command-specific environment helpers; offline validation now includes source coverage thresholds.

### Documentation

- Restored the original terminal demo embed and demo flow in the README; release guidance and current-source examples for detached and prompt transport now match the current CLI.
- Expanded the ez-devbox skill and automation docs, and updated package metadata and release instructions.

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
