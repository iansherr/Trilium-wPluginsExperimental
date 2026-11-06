# Roadmap

## Phase 1 — contracts (complete)

- Package manifest schema.
- Registry index shape.
- Install state and package settings.
- Plugins settings-tab model.

## Phase 2 — thin Trilium runtime (current)

- Render Note manager stores its registry and package-policy settings as note labels.
- Import package artifacts into a visible managed package subtree.
- Add ownership metadata to every managed note.
- Map supported artifact activation to existing Trilium labels and relations.
- Preserve package enabled state while a package is disabled.
- Render package-defined settings in the manager.
- Archive packages and install catalog updates disabled.

## Phase 3 — native Settings UI (in progress)

- Register a first-class `Plugins` tab in Settings. **Complete.**
- Show installed package status and open the full manager. **Complete.**
- Add General settings and registry update summary to the native page. **Complete.**
- Add Available catalog browsing directly to the native page. **Complete.**
- Render package-defined settings directly in the native page. **Complete.**
- Display manifest-declared permissions before installation and in installed package details. **Complete as disclosure only; this does not enforce runtime capabilities.**

## Phase 4 — lifecycle

- Dependency resolution and ordered installation of required dependencies. **Complete.** Optional dependencies remain non-blocking.
- Dependency-safe lifecycle boundaries. **Complete.** Required dependencies must be enabled before their dependents, and an installed dependent prevents disabling or uninstalling the dependency. Version ranges accepted by manifest validation are enforced during these checks.
- Simple version pinning. **Complete.** Lockfile state remains later.
- Transactional update and rollback. **Complete.**
- Health checks and broken-package recovery. **Complete.**
- Server-backed lifecycle operation lease with renewal and restart-safe transaction recovery. **Complete.**
- Opt-in in-app background update checks. **Complete.** Server-side checks remain out of scope until a scheduler boundary is chosen.

## Phase 5 — registry governance

- CI validation against the JSON schema. **Complete.** `pnpm validate:registry -- <registry.json>` validates registry structure, package manifests, duplicates, and dependency consistency.
- Trilium-version compatibility checks. **Complete.**
- Package review and deprecation metadata. **Complete.**
- Security and maintenance reporting. **Complete.** Registry manifests can declare deprecation, maintenance state, security review state, maintainer metadata, and validation time; both package UIs surface warnings and hide deprecated entries by default.
- Explicit lifecycle confirmation and optional source-host allowlisting. **Complete.**
- Artifact integrity verification. **Complete.** SHA-256 SRI hashes are required and verified before downloaded artifacts are written into Trilium notes.

## Phase 6 — selectable app bundles (in progress)

- Bundle manifest and registry validation. **Complete.** Bundles reference package IDs but never become artifact owners.
- Catalog component selection and one-transaction installation. **Complete in source.** The Render Note can select optional components and stage the resulting packages independently.
- Ikmal ownership-transfer migration from the compatibility package. **Source transaction complete.** Keep the staged Ikmal bundle out of the public registry until a cloned-vault rehearsal proves note ownership, settings, enabled state, and rollback are preserved.

## Phase 7 — plugin security boundaries (not complete)

- Correct the UI and docs so they distinguish publisher-declared permissions, install/update policy gates, artifact-download host restrictions, and runtime capabilities.
- Decide the compatibility path for manifest `secret` settings: protected storage is not implemented, and current values are ordinary note labels that may sync in plaintext.
- Make cached manifest behavior inspectable and clearable when a source is removed or unavailable.
- Design and implement runtime capability enforcement at the actual script/API boundary, or retain an explicit trusted-code model and remove wording that implies a sandbox. Installation confirmation alone is not runtime isolation.
- Test denied and allowed install/update flows through the real catalog actions, asserting operation state and network/download side effects. Add runtime boundary tests for each capability the host claims to restrict.
- Verify activation consistency after interrupted enable/disable operations and make partial state recoverable.
- Explain one-way update/repair behavior and avoid implying repair is a version rollback.

Do not describe plugin permissions as enforced until this phase has acceptance evidence. Until then, enabling a plugin means trusting its code with Trilium's available script capabilities.
