# Plugin Ecosystem & Upstream PR Strategy

## 1. Overview & Architectural Goals

The Trilium Plugin & Community Packages system introduces a first-class, declarative plugin ecosystem into Trilium Notes. It enables developers to package, publish, and maintain custom widgets, themes, background handlers, and scripts as structured note bundles, while giving end users a safe, manageable, and seamless installation and configuration experience.

### Key Capabilities of this Version
- **First-Class Plugin Management**: Built-in Settings → Plugins page and Community Packages catalog interface.
- **Declarative Package Manifests**: Single or multi-artifact package bundles containing JS widgets, CSS themes, server scripts, and custom request handlers.
- **SRI & Security Integrity Validation**: Strict SHA-256 integrity hash verification, HTTPS source enforcement, download host whitelisting, and network permission controls.
- **Operation Locking & Safety**: Process-local operation locking (`package_operation_lock`) to prevent race conditions and transaction corruption during multi-step package installations or updates.
- **Activation Reconciliation & Lifecycle Preservation**: Automatic drift detection and reconciliation of enabled package artifacts (`widget` vs `disabled:widget`) across application restarts and package updates.
- **Offline & Local Metadata Support**: Fallback rendering for uncataloged or local packages using embedded cached manifests (`pkg.cachedManifest`).

---

## 2. Upstream PR Status (Submitted to `TriliumNext/Trilium`)

The initial foundation was split into 3 independent, scoped Pull Requests to facilitate upstream review:

| Upstream PR # | Branch Name | Scope / Purpose | Status |
| :--- | :--- | :--- | :--- |
| **#10824** | `iansherr:agent/plugin-manager` | Core plugin settings UI, package metadata validation, and operation coordination locking. | Open (Awaiting review) |
| **#10825** | `iansherr:agent/plugin-build` | Multi-architecture native SQLite binary preservation for cross-platform Docker testing. | Open (Awaiting review) |
| **#10826** | `iansherr:agent/plugin-dev` | Reproducible developer test harness and script-deployer test overrides. | Open (Awaiting review) |

---

## 3. Sequential Follow-Up PR Queue Plan

To maintain small, easily reviewable pull requests, follow-up features and bug fixes are organized into a strict sequential submission queue. Each PR will be submitted to `TriliumNext/Trilium` after previous foundational PRs are merged.

```
[Phase 1: PRs #10824, #10825, #10826 Merged Upstream]
                         │
                         ▼
[PR 4: fix/plugins-lifecycle-followups]
  ↳ Activation preservation across updates & startup reconciliation.
                         │
                         ▼
[PR 5: fix/plugins-offline-metadata]
  ↳ Cached manifest fallback for offline & uncataloged extensions.
                         │
                         ▼
[PR 6: feat/plugins-ui-enhancements]
  ↳ Status badges (StateBadge), collapsible archived view, bulk cleanup.
                         │
                         ▼
[PR 7: test/plugins-procedural-matrix]
  ↳ 30-case procedural component & failure matrix test suite.
```

### Detailed PR Queue Breakdown

#### PR 4: Activation Preservation & Reconciliation
* **Branch**: `fix/plugins-lifecycle-followups`
* **Changes**:
  - `apps/client/src/services/package_activation.ts`: Startup reconciliation logic.
  - `packages/trilium-core/src/services/hidden_subtree.ts`: Manager seeding and initial activation setup.
  - `tests/packages/community-packages-contract.test.mjs`: Lifecycle contract tests.

#### PR 5: Offline Metadata & Uncataloged Plugin Setting Support
* **Branch**: `fix/plugins-offline-metadata`
* **Changes**:
  - `apps/client/src/widgets/type_widgets/options/plugins.tsx`: Fallback to `pkg.cachedManifest` in `InstalledPackageDetails` (line 614).

#### PR 6: UI Enhancements & State Badges
* **Branch**: `feat/plugins-ui-enhancements`
* **Changes**:
  - `apps/client/src/widgets/type_widgets/options/components/StateBadge.tsx` & `.css`: Status badge indicators (`Enabled`, `Disabled`, `Broken`).
  - `apps/client/src/widgets/type_widgets/options/community_packages.tsx`: Catalog render view refinements.
  - `apps/client/src/translations/en/translation.json`: English translation strings for badge status and archival cleanup.

#### PR 7: Procedural Unit Test Matrix Suite
* **Branch**: `test/plugins-procedural-matrix`
* **Changes**:
  - `apps/client/src/widgets/type_widgets/options/plugins_ui_lifecycle.spec.tsx`: Exhaustive Preact unit test suite testing all entry boxes, option boxes, selectors, toggles, buttons, surfaces, and failure combinations.

---

## 4. Personal TriliumDEV Binary & Local Integration Strategy

To ensure your local **TriliumDEV binary** contains the complete, up-to-date feature set without prematurely pushing unapproved changes to upstream GitHub:

1. **Fork `main` Branch**: Remains clean and aligned with upstream stable releases.
2. **Local Integration Branch (`integration/community-packages`)**:
   - Merges all local topic branches (`fix/plugins-lifecycle-followups`, `fix/plugins-offline-metadata`, `feat/plugins-ui-enhancements`, `test/plugins-procedural-matrix`).
   - Serves as the source branch for compiling local **TriliumDEV** binaries.
3. **No Unrequested Upstream Pushes**: Topic branches are held locally and pushed upstream sequentially as previous PRs land.
