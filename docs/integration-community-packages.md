# Community Packages integration branch

`integration/community-packages` is an experimental Trilium fork branch for
reviewing the Community Packages manager as a bundled Trilium feature.

It is based on `integration/plugins` and contains:

- the Community Packages render-note source as a read-only bundled asset;
- deterministic hidden-subtree seeding for the manager render note and its
  JSX code note;
- registry and package manifest schemas;
- an illustrative catalog showing the registry format for validation and
  local integration testing; and
- documentation for the separation between the manager and installed packages.

The branch does not contain plugin payloads as copies or submodules. Packages
remain independently versioned in their own repositories and are discovered
through a registry or direct manifest URL. `trilium_plugins` is only a
development/catalog workspace and is not a runtime dependency.

## Run it locally

```bash
git clone --branch integration/community-packages https://github.com/iansherr/Trilium.git
cd Trilium
pnpm install
pnpm server:start
```

The bundled manager is seeded into the hidden system-note subtree during
startup. Existing installations retain their package notes and settings; the
manager source is refreshed when its bundled asset changes.

For local end-to-end tests, a registry can be run from the separate catalog
workspace. Direct manifest URLs are also supported and are the preferred
development path when no registry service is running.

This is an integration branch, not a release branch. It may be rebased or
replaced while the upstream plugin settings work and the manager follow-up are
reviewed.
