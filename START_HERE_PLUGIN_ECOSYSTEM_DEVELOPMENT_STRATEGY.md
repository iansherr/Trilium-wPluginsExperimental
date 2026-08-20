# Plugin Ecosystem Upstream Strategy & Agent Execution Playbook

This document is the **authoritative State of Play, Architectural Blueprint, and Agent Execution Guide** for the Trilium Plugin Ecosystem & Community Packages system. Any AI agent or developer working in this repository MUST read and follow the workflow rules, architectural boundaries, and branch management protocols established below.

---

## 1. Core Directives & Operating Guidelines

When developing features, fixing bugs, or managing git branches in this repository, enforce these rules without exception:

1. **Micro-Sized PR Branches**: Keep PR branches as small, targeted, and self-contained as possible (ranging from 1-line bug fixes to localized test specs). Micro-PRs receive faster review, land smoothly, and minimize conflict risk.
2. **Minimal Code Touch Footprint**: Change as little existing core Trilium code as possible. Prefer non-invasive additive components (`StateBadge`), localized helper utilities, and isolated specs over sweeping refactorings.
3. **Strict PR Scope Isolation**: NEVER bloat an existing open PR with new features, follow-up enhancements, or unrelated refactors. Keep open PRs locked to their original intent.
4. **Targeted Branch Updates**: Update an existing branch ONLY when required to resolve merge conflicts with `upstream/main`, adapt to a changing state of play, or address explicit maintainer review feedback.
5. **No Unapproved Upstream Pushes**: NEVER execute `git push` to `origin` or `upstream` without explicit user permission.
6. **Mandatory Verification**: Never claim a task or feature is complete without running `pnpm typecheck` and `pnpm --filter client test plugins`.

---

## 2. Architecture & Data Model Reference

To understand how the Plugin System operates under the hood:

### A. Package Note Structure & Label Schema
- **Manifest Root Note**: Represents an installed package. Contains labels:
  - `packageOwner`: `<author>/<package-id>`
  - `packageVersion`: `<semver>`
  - `packageEnabled`: `"true"` | `"false"`
  - `packageArtifact`: `"manifest"`
  - `packageManifest`: JSON string of `CatalogPackage` definition
  - `packageSetting:<key>`: Stores user-configured setting values for the package.
- **Child Artifact Notes**: Represent widgets, CSS themes, scripts, or templates owned by the manifest.

### B. Activation Reconciliation (`PACKAGE_ACTIVATION_LABELS`)
- **Active Activation Labels**: `widget`, `appCss`, `appTheme`, `run`, `customRequestHandler`, `launcherType`.
- **Inert Activation Labels**: Prepended with `disabled:` (e.g., `disabled:widget`).
- **Drift Reconciliation**: When a package is `packageEnabled: "true"`, `package_activation.ts` strips any `disabled:` prefixes from artifact notes. When `packageEnabled: "false"`, active labels are converted to `disabled:`.

### C. Operation Coordination & Integrity Validation
- **Operation Lock**: `package_operation_lock` on the server prevents concurrent package installations/updates across tabs or clients.
- **SRI Verification**: SHA-256 integrity hashes are verified before package artifacts are accepted.
- **Network & Host Gates**: Packages requiring `network` permission require `packageAllowNetwork: "true"`. External artifact downloads require the host to be listed in `packageAllowedSourceHosts`.

---

## 3. Current State of Play

### Fork `main` Branch Role
- **Personal TriliumDEV Binary Source**: The `main` branch on this fork (`iansherr/Trilium-wPluginsExperimental`) holds the complete, consolidated working codebase containing all plugin features, UI enhancements, offline metadata fixes, and test suites.
- **Build Executable**: Used to compile custom personal **TriliumDEV binaries** via `pnpm desktop:build-binary`.

### Upstream PR Status (Filed to `TriliumNext/Trilium`)

| Upstream PR # | Branch Name | Scope / Purpose | Status |
| :--- | :--- | :--- | :--- |
| **#10824** | `iansherr:agent/plugin-manager` | Core plugin settings UI, package metadata validation, and operation coordination locking. | Open (Awaiting maintainer review) |
| **#10825** | `iansherr:agent/plugin-build` | Multi-architecture native SQLite binary preservation for cross-platform Docker testing. | Open (Awaiting maintainer review) |
| **#10826** | `iansherr:agent/plugin-dev` | Reproducible developer test harness and script-deployer test overrides. | Open (Awaiting maintainer review) |

---

## 4. Upstream PR Submission Queue & Waiting Plan

### The "Wait for Approval" Directive
Do NOT submit new PRs upstream to `TriliumNext/Trilium` until PRs #10824, #10825, and #10826 have been reviewed, approved, and merged by the upstream maintainers.

### Queue Sequence
Once Phase 1 PRs land upstream, pull `upstream/main`, rebase the following micro-branches, and submit them in strict sequential order:

```
[Phase 1: PRs #10824, #10825, #10826 Merged Upstream]
                         │
                         ▼
[PR 4: fix/plugins-lifecycle-followups]
  ↳ Background activation state preservation across updates & startup reconciliation.
                         │
                         ▼
[PR 5: fix/plugins-offline-metadata]
  ↳ 1-line fallback to cachedManifest for offline & uncataloged extensions.
                         │
                         ▼
[PR 6: feat/plugins-ui-enhancements]
  ↳ StateBadge status pills (Enabled/Disabled/Broken), collapsible archive card, cleanup.
                         │
                         ▼
[PR 7: test/plugins-procedural-matrix]
  ↳ 30-case procedural UI component & failure matrix Vitest suite.
```

### Modular Topic Branch Index

| Topic Branch Name | Key Files | Scope / Description |
| :--- | :--- | :--- |
| **`fix/plugins-lifecycle-followups`** | `package_activation.ts`, `hidden_subtree.ts`, `community-packages-contract.test.mjs` | Preserves activation state on package updates; automatic startup and manager refresh drift reconciliation. |
| **`fix/plugins-offline-metadata`** | `plugins.tsx` (`|| pkg.cachedManifest` fallback) | Enables detail view, settings, and surfaces for offline/uncataloged extensions. |
| **`feat/plugins-ui-enhancements`** | `StateBadge.tsx`, `StateBadge.css`, `community_packages.tsx`, `translation.json` | Adds status pills (`Enabled`/`Disabled`/`Broken`), collapsible archive card, and bulk cleanup. |
| **`test/plugins-procedural-matrix`** | `plugins_ui_lifecycle.spec.tsx` | Exhaustive 30-case Preact unit test suite testing all entry boxes, option boxes, selectors, toggles, buttons, and failure matrices. |

---

## 5. Continual Upstream Synchronization Workflow

To ensure all plugin features and topic branches remain compatible with ongoing `TriliumNext/Trilium` main releases:

1. **Check Upstream Status**:
   ```bash
   gh pr list --repo TriliumNext/Trilium --author "@me"
   ```
2. **Fetch Upstream**:
   ```bash
   git fetch upstream main
   ```
3. **Merge Upstream into Fork `main`**:
   ```bash
   git checkout main
   git merge upstream/main --no-edit
   ```
4. **Resolve Conflicts & Verify**:
   - Resolve any merge conflicts cleanly.
   - Run typecheck and plugin unit test verification:
     ```bash
     pnpm typecheck
     pnpm --filter client test plugins
     ```
5. **Rebase Topic Branches onto Main**:
   - Rebase each topic branch onto updated `main` to ensure zero merge conflicts before upstream submission:
     ```bash
     git checkout fix/plugins-lifecycle-followups && git rebase main
     git checkout fix/plugins-offline-metadata && git rebase main
     git checkout feat/plugins-ui-enhancements && git rebase main
     git checkout test/plugins-procedural-matrix && git rebase main
     git checkout main
     ```

---

## 6. Personal TriliumDEV Binary Build Protocol

To compile and package personal desktop executables from this workspace:

```bash
# Execute single-command dev binary build helper
pnpm desktop:build-binary

# Executable binary outputs to:
# apps/desktop/out/
```

---

## 7. Verification Command Reference

Always run these commands to verify code integrity before committing changes:

| Target | Command | Expected Result |
| :--- | :--- | :--- |
| **TypeScript Types** | `pnpm typecheck` | `No errors found.` |
| **Client Plugin Tests** | `pnpm --filter client test plugins` | `30 passed (30)` |
| **Manifest Contracts** | `node --test tests/packages/package-manifest.test.mjs` | `10 pass` |
| **Community Contracts** | `node --test tests/packages/community-packages-contract.test.mjs` | `25 pass` |
| **Server Operation Lock** | `pnpm --filter server test package_operation_lock` | `1 passed` |

---

## 8. TriliumDEV Companion & Version Detection Plugin Blueprint

To make managing and updating local TriliumDEV builds effortless, the **TriliumDEV Companion Plugin** can be installed directly into Trilium Notes as a native community package note:

### Plugin Package Manifest Schema (`iansherr/triliumdev-companion`)
- **Manifest ID**: `iansherr/triliumdev-companion`
- **Permissions**: `["network"]`
- **Widget Artifact**: Frontend widget checking GitHub API on startup.
- **Functionality**:
  1. Reads local running version via `window.glob.triliumVersion` and git commit hash.
  2. Queries GitHub API: `https://api.github.com/repos/iansherr/Trilium-wPluginsExperimental/commits/main`.
  3. Displays a non-intrusive notification pill in Trilium when new commits or builds exist on `iansherr/Trilium-wPluginsExperimental`.
  4. Provides a 1-click link to trigger local build (`pnpm desktop:build-binary`) or download latest release artifacts.
