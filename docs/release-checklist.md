# Release Checklist

Run this checklist before publishing a new `ez-devbox` version.

1. Validate all non-credentialed release gates:
   - `npm ci`
   - `npm run validate:offline`
2. Run the credentialed live check from a trusted maintainer environment, then verify E2B resource cleanup:
   - `npm run e2e:live`
   - (or run offline and live checks together) `npm run validate`
3. Verify package contents and runtime entrypoints (already included in `validate:offline`):
   - `npm run pack:check`
   - (optional inspect raw output) `npm pack --dry-run --json`
4. Confirm required artifacts are present in the pack output:
   - `dist/src/cli/index.js`
   - `dist/src/cli/index.d.ts`
   - `scripts/ws-ssh-proxy.mjs`
   - `docs/`, `examples/minimal/`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `LICENSE`, `package.json`
   - both `ez-devbox` and `ezdb` executable mappings
5. Confirm the version is unclaimed before bumping: `git tag --list vX.Y.Z` and `npm view ez-devbox version`.
6. Move the `CHANGELOG.md` Unreleased entries under the new version/date without changing historical notes.
7. Run `npm run release -- <major|minor|patch>` from a clean, current `main` branch. The command creates the version commit and tag, pushes both, and publishes the GitHub Release.
8. If npm already contains the package version but the GitHub release/tag is missing, do not run the bump script. First confirm `main` contains the matching `package.json` version, then create and publish the matching `vX.Y.Z` GitHub Release.
9. Confirm GitHub Actions `Release` workflow succeeds.

Historical manual release flow (only if the release script is unavailable):

1. Create a GitHub Release from the Releases tab (tag format `vX.Y.Z`).
    - choose `main` as the target
    - create tag if it does not exist yet
    - publish the release
2. Confirm GitHub Actions `Release` workflow succeeds.
   - workflow validates `package.json` version matches release tag
   - workflow runs `npm run validate:offline`
   - workflow publishes to npm via trusted publishing (`npm publish --provenance`)
