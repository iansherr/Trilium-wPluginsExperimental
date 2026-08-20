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

## 6. Interactive TriliumDEV Management Tool (`trilium-dev.sh`)

To make launching dev mode, testing, binary packaging, and release tagging effortless, an interactive CLI tool is included:

```bash
# Interactive menu
pnpm dev:cli
# OR
./scripts/trilium-dev.sh
```

### Shortcuts:
* **`pnpm dev:hot`**: Launches live Hot-Reload Watch Mode (`pnpm desktop:start`).
* **`pnpm dev:prod`**: Runs local production build (`pnpm desktop:start-prod`).
* **`pnpm dev:binary`**: Packages standalone desktop binary (`apps/desktop/out/`).
* **`pnpm dev:release`**: Prompts for release tag (`v0.104.1-dev.1`) and pushes to GitHub.

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

## 8. TriliumDEV Companion Plugin Blueprint (`iansherr/triliumdev-companion`)

The **TriliumDEV Companion Plugin** runs directly inside Trilium Notes as a native community package note and supports both **Developers** and **End-User Testers**:

### Dual-Mode Architecture:
1. **End-User / Tester Mode (No local codebase required)**:
   - Queries GitHub API (`https://api.github.com/repos/iansherr/Trilium-wPluginsExperimental/releases/latest`).
   - Compares local version (`window.glob.triliumVersion`) against remote release tags (`v0.104.1-dev.X`).
   - Renders a 1-click **"Download Pre-Built Binary Update"** button that downloads and launches the compiled `.dmg` / `.zip` asset directly from GitHub Releases.
2. **Developer Mode (Multi-Machine Custom Directory Binding)**:
   - **Configurable Source Directory Setting**: Includes a `packageSetting:localSourceDirectory` text box in the plugin settings UI (e.g., `/Users/iansherr/Projects/Trilium` or `/home/user/code/Trilium`).
   - **Native Folder Picker**: Provides a **"Select Local Source Folder"** button that opens Electron's native directory picker (`showOpenDialog({ properties: ['openDirectory'] })`) to set the path visually.
   - **Auto-Discovery Fallback**: Automatically checks `process.env.TRILIUM_DEV_DIR` or `process.cwd()` if no path is configured.
   - **Launch Hot-Reload Action**: When a local source folder is connected, clicking **"Launch Dev Watch Server"** spawns Vite HMR for that specific workspace directory, allowing sub-second hot reloading on any computer!

---

## 9. Development Iteration & Release Management Guide

### A. How Code Changes Move into the Live App

1. **Active Live Development (Hot Reloading)**:
   ```bash
   pnpm dev:hot
   ```
   * **Behavior**: Launches Electron in development mode with Vite hot-reloading. Any change to TypeScript, React components, CSS, or backend services instantly updates in the running app without rebuilding binaries.
2. **Local Production Test Run**:
   ```bash
   pnpm dev:prod
   ```
   * **Behavior**: Compiles the production bundle and runs it immediately in Node/Electron to test real production behavior without packaging installer binaries.
3. **Executable Binary Rebuild**:
   ```bash
   pnpm dev:binary
   ```
   * **Behavior**: Re-runs typecheck and Vitest specs, compiles production assets, and packages the standalone executable binary in `apps/desktop/out/`.

### B. Release Tagging Strategy (Avoiding Upstream Version Conflicts)

1. **Custom Tag Namespace**: Always append `-dev.X` to your version tags (e.g. `v0.104.1-dev.1`, `v0.104.1-dev.2`).
2. **Upstream Isolation**: Adding `-dev.X` ensures your fork's releases never collide with upstream `TriliumNext/Trilium` official tags (`v0.104.1`).
3. **Automated Binary Release Upload**:
   ```bash
   pnpm dev:release
   # OR
   git tag v0.104.1-dev.1 && git push origin v0.104.1-dev.1
   ```
   * **Result**: GitHub Actions builds the packaged desktop application (`.dmg`, `.zip`, `.exe`) and attaches the executable binary assets directly to the GitHub Release page.

---

## 10. Resilience, Edge Cases, & Security Audit

The Plugin Ecosystem includes explicit safeguards for edge cases and unexpected runtime failures:

| Scenario / Edge Case | Safeguard Implementation | Status |
| :--- | :--- | :--- |
| **Offline / Network Outage** | Cached manifest fallback (`|| pkg.cachedManifest`) in `plugins.tsx` line 614 enables package details and settings to load when offline. | **Verified** |
| **Interrupted App Shutdown** | Intermediate transaction notes are tagged with `#packageTransaction`. Startup reconciliation (`recoverInterruptedTransactions()`) cleans up orphaned notes. | **Verified** |
| **Settings Reset on Upgrade** | `backupPackageConfiguration()` stores a JSON snapshot (`#packageConfigBackup`). `restorePackageSettings()` re-applies user settings (`packageSetting:*`) on upgrade. | **Verified** |
| **Activation Drift** | `package_activation.ts` detects drift between `packageEnabled: "true"` and artifact notes, stripping inert `disabled:` prefixes automatically on client startup. | **Verified** |
| **Concurrency Collisions** | Process-local lease lock (`package_operation_lock`) on the server prevents multi-tab or concurrent client package modification corruption. | **Verified** |
| **Unsafe Sources / SRI** | Requires HTTPS for non-localhost sources, enforces download host whitelisting (`packageAllowedSourceHosts`), and validates SHA-256 SRI hashes. | **Verified** |
