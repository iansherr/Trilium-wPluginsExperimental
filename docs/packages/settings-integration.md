# Plugins settings integration

The package manager now appears as a first-class **Plugins** tab in Trilium Settings rather than as a permanent widget. The tab exposes global registry/policy settings, installed and archived package status, update checks, an Available summary, lifecycle controls, and installed package details with manifest-defined settings, permissions, and entry points. Install actions intentionally open the searchable catalog note, which remains responsible for catalog browsing, ordered dependency installation, permission confirmation, and installation. The catalog keeps installed packages in its list for discovery context, marks them as Installed or Update available instead of offering Install, and links to the native Plugins page for management. Selectable bundles are catalog-only groupings: their checked components are installed as independent packages and then managed in the native Plugins page.

The tab should expose five sections:

1. **Installed** — enable/disable, configure, inspect health, archive, or delete.
2. **Archived** — restore a recoverably removed package or delete it from Recent Notes.
3. **Available** — shown as a summary in native Settings and searchable in the catalog. Deprecated entries are hidden by default and can be shown with the opt-in setting.
4. **Updates** — review changelog/source and update or pin versions.
5. **General** — registries, direct manifest URLs, update checks, beta packages, and network-package policy.

The package manager deliberately does not depend on private Trilium UI modules. `src/settings-tab.ts` provides the data contract and tab identity. The native host discovers the deployed manager through its stable script-deployer note ID and keeps the full package UI in the Render Note, avoiding a second implementation of install/update logic.

The runtime persists manager settings in a dedicated settings note and package ownership in package manifest notes. Package-specific settings must remain available while a package is disabled, so disabling a package must never delete its configuration.

The native page is the detailed management surface for discovery, status, health inspection, installed package configuration, entry points, archive/delete lifecycle, source-host trust controls, update pinning, and opt-in in-app update checks without duplicating catalog download and replacement logic. Package replacement remains transaction-backed and recoverable through archived managed notes and interrupted-operation recovery. Configuration backups are stored as versioned JSON notes under the hidden Community Packages root and are inherited by updates or reinstalls after validating the new manifest's setting definitions. Automatic update behavior means low-frequency update checks while the manager or native Plugins page is open; per-package pins are managed in the native page, and updates are never installed silently. Catalog and installed-plugin page actions open in Trilium's popup editor so ordinary plugin use does not hoist the hidden package subtree into the file tree. The Render Note remains the supported searchable catalog integration for browsing and installation.

## Runtime adapter boundary

The adapter produces deterministic note plans rather than mutating a database directly. This keeps install, update, dry-run, and rollback testable. Each plan ensures a single `Community Packages` container, then creates or updates a package root and its managed artifacts. The Trilium-specific executor will apply those plans through the note service, using the existing `readOnly`, `disabled:`, widget, theme, CSS, startup, render-note, and launch-bar conventions.

Event handlers are intentionally not inferred from an artifact's name. They need an explicit target-note binding so installing a package cannot silently attach code to an unintended note.
