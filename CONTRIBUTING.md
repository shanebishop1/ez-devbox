# Contributing

Thanks for helping improve ez-devbox.

## Development setup

Requirements are Node.js 20 or newer, npm, and Git. A real E2B account is not needed for the offline suite.

```bash
git clone https://github.com/shanebishop1/ez-devbox.git
cd ez-devbox
npm ci
npm run validate:offline
```

Source is in `src/`, unit tests are in `test/`, and the CLI entrypoint is `src/cli/index.ts`. Use ESM imports with explicit `.js` extensions for relative TypeScript imports and follow the existing strict types and dependency-injection patterns.

## Pull requests

1. Open an issue first for substantial behavior or API changes.
2. Keep changes focused and add regression coverage for changed behavior.
3. Update README, config examples, or reference docs when user-facing behavior changes.
4. Run `npm run validate:offline` and include the result in the pull request.
5. Do not commit generated `dist/`, local agent state, `.env`, auth files, tokens, or tunnel URLs.

Maintainers may run `npm run validate`, which adds the credentialed live E2E check. Contributors should run `npm run e2e:live` only against their own E2B account, expect it to create billable resources, and verify cleanup afterward.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
