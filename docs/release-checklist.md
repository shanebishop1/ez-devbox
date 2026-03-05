# Release Checklist

Run this checklist before publishing a new `ez-devbox` version.

1. Validate guardrails, tests, and build:
   - `npm run check:complexity`
   - `npm run check:style`
   - `npm run test`
   - `npm run build`
   - `npm run e2e:live`
   - (or run all together) `npm run validate`
2. Verify package contents and runtime entrypoints:
   - `npm run pack:check`
   - (optional inspect raw output) `npm pack --dry-run --json`
3. Confirm required artifacts are present in the pack output:
   - `dist/src/cli/index.js`
   - `dist/src/cli/index.d.ts`
   - `scripts/ws-ssh-proxy.mjs`
   - `README.md`, `LICENSE`, `package.json`
4. Publish using your standard npm release flow.
   - verify auth/session: `npm whoami`
   - publish: `npm publish --access public`
   - if npm 2FA is enabled: `npm publish --access public --otp <code>`
