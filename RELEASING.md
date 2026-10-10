# Releasing @vulnify/mcp

Publish by pushing a git tag. The [release workflow](.github/workflows/release.yml) installs, tests, builds, checks that the tag matches `package.json`, publishes to npm, and attaches a CycloneDX SBOM to the GitHub release. Do not run `npm publish` from a laptop for later versions, and do not create the GitHub release by hand.

This repository uses **npm trusted publishing** (GitHub Actions OIDC). There is no `NPM_TOKEN` secret. The workflow has `permissions: id-token: write` and runs `npm publish --provenance --access public` on a GitHub-hosted runner. Provenance is requested with `--provenance` and is also generated automatically when the publish authenticates with OIDC from this public repository.

Do not set `registry-url` on `actions/setup-node`. That writes a placeholder `NODE_AUTH_TOKEN` and npm skips the OIDC exchange. The workflow unsets `NODE_AUTH_TOKEN` before publish.

## One-time bootstrap

npm trusted publishing can only be configured on a package that already exists. `@vulnify/mcp` does not exist yet, so the workflow cannot publish `0.1.0` until a maintainer creates the package once.

The cleanest bootstrap is a throwaway `0.0.1`, not a laptop publish of `0.1.0`. That keeps `0.1.0` (the version in this repo) as the first release that goes through the workflow, with provenance and an SBOM.

1. From a maintainer account that can publish `@vulnify`, publish `0.0.1` once with a short-lived granular token, then revoke the token. The tarball can be this same package with `"version": "0.0.1"` published from a temporary checkout. Do not commit that version, do not tag it, and do not add the token to GitHub.
2. Open https://www.npmjs.com/package/@vulnify/mcp/access and add a GitHub Actions trusted publisher. The values are case-sensitive. The workflow filename is only the file name.
   - Organization or user: `vulnify`
   - Repository: `vulnify-mcp`
   - Workflow filename: `release.yml`
   - Environment name: leave empty. The workflow does not set a GitHub environment.
   - Allowed actions: allow direct `npm publish`. Configurations created after 3 September 2026 default to staged publish only, which this workflow does not use.
3. Confirm `repository.url` in `package.json` stays `git+https://github.com/vulnify/vulnify-mcp.git`. Provenance rejects a mismatch.
4. On `main` at `0.1.0`, tag that commit and push the tag. The workflow publishes `0.1.0` with provenance. Do not tag `v0.0.1`.
5. After one successful trusted publish, package settings can require two-factor authentication and disallow tokens. Do that only after the workflow has published once. Deprecate `0.0.1` on npm so installers take `0.1.0`.

No GitHub secret is required for npm. Do not add `NPM_TOKEN`. The package has no private dependencies, so `npm ci` does not need a read token either.

Self-hosted runners cannot use trusted publishing. The workflow uses `ubuntu-latest`.

Publishing `0.1.0` from a laptop instead also works, but then you must not push tag `v0.1.0` (npm will reject the second publish) and `0.1.0` will not have workflow provenance. The `0.0.1` bootstrap avoids that.

## MCP Registry

`server.json` names the server `io.vulnify/mcp`. That namespace needs DNS or HTTP authentication for `vulnify.io`. GitHub OIDC only grants `io.github.vulnify/*`, so the workflow does not use it.

The registry step is skipped, and is `continue-on-error`, until a maintainer sets the `MCP_PRIVATE_KEY` secret to the Ed25519 key from:

```bash
mcp-publisher login dns --domain vulnify.io
```

Place the TXT record on the apex of `vulnify.io`, not on a selector. HTTP domain auth, if you use it instead of DNS, replaces the `login dns` command in the workflow. Until then the step prints a skip message and the npm publish still succeeds.

`package.json` `mcpName` is `io.vulnify/mcp` and must stay equal to `server.json` `name`.

## Cutting a release

1. On `main`, set `package.json` `"version"` to the new version, set the same version in `server.json` (root `version` and `packages[0].version`), and add a `CHANGELOG.md` entry.
2. Tag **that** commit. The tag must be `v` plus the exact `package.json` version. The workflow refuses to publish when they differ.

   ```bash
   git checkout main
   git pull origin main
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

3. Watch the Release workflow. It publishes `@vulnify/mcp@<version>` and opens the GitHub release for that tag with `sbom.cdx.json` attached. The same file is a workflow artifact named `sbom`.
4. Do not push another tag for a version that is already on npm. npm will reject the publish, and the version cannot be reused.

Do not push a `v*` tag until the bootstrap above is done. A tag push publishes.
