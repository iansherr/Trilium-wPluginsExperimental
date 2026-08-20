# Plugin Ecosystem Upstream Strategy & Agent Execution Playbook

This document serves as the authoritative **State of Play, Upstream Strategy, and Agent Execution Guide** for the Trilium Plugin Ecosystem & Community Packages system. Any AI agent or developer working in this repository MUST follow the directives and workflow rules established below.

---

## 1. Core Principles & Philosophy

When developing features, fixing bugs, or managing git branches in this repository, always enforce the following constraints:

1. **Micro-Sized PR Branches**: Break up work into the smallest reasonable, self-contained units (from 1-line bug fixes up to localized test suites). Smaller PRs land faster and reduce merge conflict risks.
2. **Minimal Code Touch Footprint**: Change as little existing core Trilium code as possible. Prefer non-invasive additive components, localized helper utilities, and isolated specs over wide refactors.
3. **Strict PR Scope Boundaries**: NEVER bloat an existing open PR with new features, follow-up enhancements, or unrelated refactors. Keep open PRs locked to their original intent.
4. **Targeted Branch Updates**: Update existing branches ONLY when required to resolve merge conflicts with `upstream/main`, adjust to a changing state of play, or address explicit maintainer review feedback.
5. **No Unapproved Upstream Pushes**: NEVER execute `git push` to `origin` or `upstream` without explicit approval from the user.

---

## 2. Current State of Play

### Fork `main` Branch Role
- **Personal TriliumDEV Binary Source**: The `main` branch on this fork (`iansherr/Trilium`) holds the complete, consolidated working codebase. It is used directly to build personal **TriliumDEV binaries** (`pnpm desktop:build-binary`).
- **Merged Local State**: `main` is kept synchronized with upstream Trilium releases while incorporating all local plugin enhancements, UI badges, offline manifest fixes, and procedural unit test suites.

### Upstream PR Status (Filed to `TriliumNext/Trilium`)

| Upstream PR # | Branch Name | Scope / Purpose | Status |
| :--- | :--- | :--- | :--- |
| **#10824** | `iansherr:agent/plugin-manager` | Core plugin settings UI, package metadata validation, and operation coordination locking. | Open (Awaiting maintainer approval) |
| **#10825** | `iansherr:agent/plugin-build` | Multi-architecture native SQLite binary preservation for cross-platform Docker testing. | Open (Awaiting maintainer approval) |
| **#10826** | `iansherr:agent/plugin-dev` | Reproducible developer test harness and script-deployer test overrides. | Open (Awaiting maintainer approval) |

---

## 3. Upstream PR Submission Queue & Waiting Plan

### The "Wait for Approval" Directive
Do NOT submit new PRs upstream to `TriliumNext/Trilium` until PRs #10824, #10825, and #10826 have been reviewed, approved, and merged by the upstream maintainers.

### Queue Sequence
Once Phase 1 PRs are merged upstream, pull `upstream/main`, rebase the following micro-branches, and submit them in strict sequential order:

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

* **`fix/plugins-lifecycle-followups`**: Preserves enabled/disabled activations across updates; automatic drift reconciliation on client startup and manager refresh.
* **`fix/plugins-offline-metadata`**: Fallback to `pkg.cachedManifest` when catalog lookup returns `undefined` (fixing "manifest unavailable" for offline/local extensions).
* **`feat/plugins-ui-enhancements`**: Adds `StateBadge.tsx` / `StateBadge.css` status pills and collapsible archived package management.
* **`test/plugins-procedural-matrix`**: Comprehensive unit test suite (`plugins_ui_lifecycle.spec.tsx`) covering every entry box, option box, selector, toggle switch, action button, and failure matrix.

---

## 4. Continual Upstream Synchronization Workflow

To ensure that all plugin feature branches remain compatible with ongoing upstream `TriliumNext/Trilium` releases:

1. **Fetch Upstream**:
   ```bash
   git fetch upstream main
   ```
2. **Merge Upstream into Fork `main`**:
   ```bash
   git checkout main
   git merge upstream/main
   ```
3. **Resolve Conflicts & Verify**:
   - Resolve any merge conflicts cleanly.
   - Run typecheck and test suite verification:
     ```bash
     pnpm typecheck
     pnpm --filter client test plugins
     ```
4. **Rebase Local Topic Branches**:
   - As `main` advances, periodically rebase local micro-branches (`fix/plugins-lifecycle-followups`, etc.) on `main` to verify ongoing compatibility.

---

## 5. TriliumDEV Binary Build Protocol

To compile and package personal desktop binaries from this workspace:

```bash
# Execute dev binary build helper
pnpm desktop:build-binary

# Executable outputs to:
# apps/desktop/out/
```
