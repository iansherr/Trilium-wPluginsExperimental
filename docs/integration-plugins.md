# Plugin integration branch

`integration/plugins` is an experimental testing branch that combines the plugin-manager work with the build and development-harness changes submitted in separate upstream pull requests.

It is intended for contributors who want to exercise the complete plugin development path before the individual changes are merged upstream. It is not a release branch and may be rebased, amended, or removed as the upstream pull requests progress.

## Run the integrated branch

```bash
git clone --branch integration/plugins https://github.com/iansherr/Trilium.git
cd Trilium
pnpm install
pnpm server:start
```

For the desktop development app, use `pnpm desktop:start` instead. Run `pnpm typecheck` and the relevant test commands before treating a result as an issue with the integrated changes.

The individual changes remain the source of truth for review:

- Plugin manager and Plugins settings: PR #10824
- Docker/native SQLite build artifacts: PR #10825
- Development and test harness: PR #10826

This branch is for integration testing only. Production users should use an official Trilium release.
