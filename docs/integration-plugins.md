# Plugin integration branch

`integration/plugins` is an experimental testing branch that combines the plugin-manager work with the build and development-harness changes submitted in separate upstream pull requests.

It is intended for contributors who want to exercise the complete plugin development path before the individual changes are merged upstream. It is not a release branch and may be rebased, amended, or removed as the upstream pull requests progress.

## What this branch contains

This branch contains the Trilium-side package infrastructure: the native **Plugins**
settings tab, the package manager host, lifecycle coordination, and their tests. It does
not vendor or duplicate package payloads. Packages remain independently versioned in their
own repositories:

- [Wordcount](https://github.com/iansherr/trilium_wordcounter)
- [LanguageTool](https://github.com/iansherr/trilium_languagetool_plugin)
- [Web Server](https://github.com/iansherr/trilium_webserver_plugin)
- [Gmail Ingest](https://github.com/iansherr/trilium_mail)

The follow-up `integration/community-packages` branch additionally bundles the
Community Packages manager source and the registry/schema fixtures used to test it.
It is the integration branch for reviewing the manager as a Trilium feature; it
still does not vendor any plugin payloads.

The normal development flow is therefore: run this Trilium branch, discover a package from
a registry or direct manifest source, and install the package into the running Trilium
instance. Installing a package downloads its manifest and declared artifacts; it does not
copy the package source into this Trilium checkout.

## Run the integrated branch

```bash
git clone --branch integration/plugins https://github.com/iansherr/Trilium.git
cd Trilium
pnpm install
pnpm server:start
```

For the desktop development app, use `pnpm desktop:start` instead. Run `pnpm typecheck` and the relevant test commands before treating a result as an issue with the integrated changes.

For local end-to-end package testing, run the local registry server from the separate
package workspace and set the Plugins source to
`http://127.0.0.1:39125/registry.json`. Direct manifest URLs can also be entered through
the Plugins advanced source controls.

The individual changes remain the source of truth for review:

- Plugin manager and Plugins settings: PR #10824
- Docker/native SQLite build artifacts: PR #10825
- Development and test harness: PR #10826

The Community Packages manager is intentionally held for a separate follow-up
review after the plugin settings/manager host has stabilized.

This branch is for integration testing only. Production users should use an official Trilium release.
